using Betweenly.Accounts;
using Betweenly.Shared;
using MySqlConnector;
using System.Data;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Nodes;

namespace Betweenly.Auth;

public sealed record Credential(string UserId, string Email, string Username, string PasswordHash, string Status);

public sealed class AuthRepository(AccountDatabase database)
{
    public static string Hash(string secret) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(secret))).ToLowerInvariant();
    public static bool ValidToken(string? value) => value is { Length: 43 } && value.All(c => char.IsAsciiLetterOrDigit(c) || c is '-' or '_');
    private static string Token() => Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    public async Task<Credential?> Find(string email, CancellationToken token)
    {
        await using var connection = await database.Open(token);
        await using var command = AccountDatabase.Command(connection, "SELECT user_id,email,username,password_hash,status FROM auth_credentials WHERE email=@email", null, ("@email", email));
        await using var reader = await command.ExecuteReaderAsync(token);
        return await reader.ReadAsync(token) ? new Credential(reader.GetString(0), reader.GetString(1), reader.GetString(2), reader.GetString(3), reader.GetString(4)) : null;
    }

    public async Task<Credential?> FindById(string id, CancellationToken token)
    {
        await using var connection = await database.Open(token);
        await using var command = AccountDatabase.Command(connection, "SELECT user_id,email,username,password_hash,status FROM auth_credentials WHERE user_id=@id", null, ("@id", id));
        await using var reader = await command.ExecuteReaderAsync(token);
        return await reader.ReadAsync(token) ? new Credential(reader.GetString(0), reader.GetString(1), reader.GetString(2), reader.GetString(3), reader.GetString(4)) : null;
    }

    public async Task<Credential?> FindLogin(string identifier, CancellationToken token)
    {
        if (identifier.Contains('@')) return await Find(identifier.ToLowerInvariant(), token);
        await using var connection = await database.Open(token);
        await using var command = AccountDatabase.Command(connection, "SELECT user_id,email,username,password_hash,status FROM auth_credentials WHERE normalized_username=@name", null, ("@name", AccountValidation.NormalizeUsername(identifier)));
        await using var reader = await command.ExecuteReaderAsync(token);
        return await reader.ReadAsync(token) ? new Credential(reader.GetString(0), reader.GetString(1), reader.GetString(2), reader.GetString(3), reader.GetString(4)) : null;
    }

    public async Task<Credential?> Reserve(Credential credential, CancellationToken token)
    {
        await using var connection = await database.Open(token);
        await using var command = AccountDatabase.Command(connection,
            "INSERT INTO auth_credentials(user_id,email,username,normalized_username,password_hash,status,created_at) VALUES(@id,@email,@name,@normalized,@hash,'PROVISIONING',UTC_TIMESTAMP(6))", null,
            ("@id", credential.UserId), ("@email", credential.Email), ("@name", credential.Username), ("@normalized", AccountValidation.NormalizeUsername(credential.Username)), ("@hash", credential.PasswordHash));
        try { await command.ExecuteNonQueryAsync(token); return credential; }
        catch (MySqlException error) when (error.Number == 1062) { return null; }
    }

    public async Task CheckAttempt(string operation, string email, CancellationToken token)
    {
        await using var connection = await database.Open(token);
        var bucket = Hash(operation + ":" + email);
        await using (var increment = AccountDatabase.Command(connection, """
            INSERT INTO auth_login_limits(bucket,attempts,expires_at) VALUES(@bucket,1,DATE_ADD(UTC_TIMESTAMP(6),INTERVAL 15 MINUTE))
            ON DUPLICATE KEY UPDATE attempts=IF(expires_at<=UTC_TIMESTAMP(6),1,attempts+1),
              expires_at=IF(expires_at<=UTC_TIMESTAMP(6),DATE_ADD(UTC_TIMESTAMP(6),INTERVAL 15 MINUTE),expires_at)
            """, null, ("@bucket", bucket))) await increment.ExecuteNonQueryAsync(token);
        await using var command = AccountDatabase.Command(connection, "SELECT attempts FROM auth_login_limits WHERE bucket=@bucket", null, ("@bucket", bucket));
        if (Convert.ToInt32(await command.ExecuteScalarAsync(token)) > 20) throw new ApiException(429, "RATE_LIMITED", "尝试次数过多，请 15 分钟后再试");
    }

    public async Task<JsonObject> CreateSession(Credential credential, string? device, bool activate, CancellationToken token)
    {
        await using var connection = await database.Open(token);
        await using var transaction = await connection.BeginTransactionAsync(IsolationLevel.ReadCommitted, token);
        await using (var check = AccountDatabase.Command(connection, "SELECT password_hash,status FROM auth_credentials WHERE user_id=@id FOR UPDATE", transaction, ("@id", credential.UserId)))
        {
            await using var reader = await check.ExecuteReaderAsync(token);
            if (!await reader.ReadAsync(token) || reader.GetString(0) != credential.PasswordHash || (reader.GetString(1) != "ACTIVE" && !(activate && reader.GetString(1) == "PROVISIONING")))
                throw new ApiException(401, "AUTH_REQUIRED", "邮箱或密码错误");
        }
        await using (var ban = AccountDatabase.Command(connection, "SELECT expires_at FROM auth_user_bans WHERE user_id=@user AND (expires_at IS NULL OR expires_at>UTC_TIMESTAMP(6))", transaction, ("@user", credential.UserId)))
        await using (var reader = await ban.ExecuteReaderAsync(token))
        {
            if (await reader.ReadAsync(token))
            {
                var release = reader.IsDBNull(0) ? "永久" : new DateTimeOffset(DateTime.SpecifyKind(reader.GetDateTime(0), DateTimeKind.Utc))
                    .ToOffset(TimeSpan.FromHours(8)).ToString("yyyy-MM-dd HH:mm:ss", CultureInfo.InvariantCulture);
                throw new ApiException(403, "ACCOUNT_BANNED", "账号已被封禁，预计解封时间：" + release);
            }
        }
        if (activate)
        {
            await using var active = AccountDatabase.Command(connection, "UPDATE auth_credentials SET status='ACTIVE' WHERE user_id=@id AND status='PROVISIONING'", transaction, ("@id", credential.UserId));
            await active.ExecuteNonQueryAsync(token);
        }
        var now = DateTime.UtcNow; var id = Api.NewId(); var access = Token(); var refresh = Token();
        await using var insert = AccountDatabase.Command(connection, """
            INSERT INTO auth_sessions(session_id,user_id,access_hash,refresh_hash,device_name,created_at,access_expires_at,refresh_expires_at,absolute_expires_at)
            VALUES(@session,@user,@access,@refresh,@device,@now,@accessUntil,@refreshUntil,@absoluteUntil)
            """, transaction, ("@session", id), ("@user", credential.UserId), ("@access", Hash(access)), ("@refresh", Hash(refresh)), ("@device", device),
            ("@now", now), ("@accessUntil", now.AddMinutes(15)), ("@refreshUntil", now.AddDays(7)), ("@absoluteUntil", now.AddDays(30)));
        await insert.ExecuteNonQueryAsync(token);
        await transaction.CommitAsync(token);
        return new JsonObject { ["session"] = new JsonObject { ["sessionId"] = id, ["userId"] = credential.UserId, ["createdAt"] = now.ToString("O"), ["expiresAt"] = now.AddDays(7).ToString("O") }, ["tokens"] = Tokens(access, refresh) };
    }

    private static JsonObject Tokens(string access, string refresh) => new() { ["accessToken"] = access, ["refreshToken"] = refresh, ["tokenType"] = "Bearer", ["expiresInSeconds"] = 900 };

    public async Task<JsonObject> Introspect(string? access, CancellationToken token)
    {
        var inactive = new JsonObject { ["active"] = false };
        if (!ValidToken(access)) return inactive;
        await using var connection = await database.Open(token);
        await using var command = AccountDatabase.Command(connection, """
            SELECT s.user_id,s.session_id,s.access_expires_at FROM auth_sessions s
            JOIN auth_credentials c ON c.user_id=s.user_id AND c.status='ACTIVE'
            WHERE s.access_hash=@hash AND s.revoked_at IS NULL AND s.access_expires_at>UTC_TIMESTAMP(6)
              AND s.refresh_expires_at>UTC_TIMESTAMP(6) AND s.absolute_expires_at>UTC_TIMESTAMP(6)
              AND NOT EXISTS(SELECT 1 FROM auth_user_bans b WHERE b.user_id=c.user_id AND (b.expires_at IS NULL OR b.expires_at>UTC_TIMESTAMP(6)))
            """, null, ("@hash", Hash(access!)));
        await using var reader = await command.ExecuteReaderAsync(token);
        if (!await reader.ReadAsync(token)) return inactive;
        return new JsonObject { ["active"] = true, ["userId"] = reader.GetString(0), ["sessionId"] = reader.GetString(1), ["expiresAt"] = DateTime.SpecifyKind(reader.GetDateTime(2), DateTimeKind.Utc).ToString("O") };
    }

    public async Task<JsonObject> Refresh(string? refresh, CancellationToken token)
    {
        if (!ValidToken(refresh)) throw new ApiException(401, "AUTH_REQUIRED", "刷新令牌无效或已失效");
        await using var connection = await database.Open(token);
        await using var transaction = await connection.BeginTransactionAsync(IsolationLevel.ReadCommitted, token);
        string? id = null; DateTime absolute = default; DateTime refreshUntil = default;
        await using (var command = AccountDatabase.Command(connection, """
            SELECT s.session_id,s.absolute_expires_at,s.refresh_expires_at FROM auth_sessions s
            JOIN auth_credentials c ON c.user_id=s.user_id AND c.status='ACTIVE'
            WHERE s.refresh_hash=@hash AND s.revoked_at IS NULL
              AND NOT EXISTS(SELECT 1 FROM auth_user_bans b WHERE b.user_id=c.user_id AND (b.expires_at IS NULL OR b.expires_at>UTC_TIMESTAMP(6))) FOR UPDATE
            """, transaction, ("@hash", Hash(refresh!))))
        {
            await using var reader = await command.ExecuteReaderAsync(token);
            if (await reader.ReadAsync(token)) { id = reader.GetString(0); absolute = reader.GetDateTime(1); refreshUntil = reader.GetDateTime(2); }
        }
        var now = DateTime.UtcNow;
        if (id is null)
        {
            // Reuse of an already rotated refresh token revokes the entire session.
            await using var replay = AccountDatabase.Command(connection, """
                UPDATE auth_sessions s JOIN auth_refresh_history h ON h.session_id=s.session_id
                SET s.revoked_at=COALESCE(s.revoked_at,UTC_TIMESTAMP(6)) WHERE h.token_hash=@hash AND h.expires_at>UTC_TIMESTAMP(6)
                """, transaction, ("@hash", Hash(refresh!)));
            await replay.ExecuteNonQueryAsync(token); await transaction.CommitAsync(token);
            throw new ApiException(401, "AUTH_REQUIRED", "刷新令牌无效或已失效");
        }
        if (absolute <= now || refreshUntil <= now) throw new ApiException(401, "AUTH_REQUIRED", "刷新令牌无效或已失效");
        await using (var history = AccountDatabase.Command(connection, "INSERT INTO auth_refresh_history(token_hash,session_id,expires_at) VALUES(@hash,@id,@expires)", transaction,
            ("@hash", Hash(refresh!)), ("@id", id), ("@expires", absolute))) await history.ExecuteNonQueryAsync(token);
        var access = Token(); var replacement = Token();
        await using var update = AccountDatabase.Command(connection, "UPDATE auth_sessions SET access_hash=@access,refresh_hash=@refresh,access_expires_at=@accessUntil,refresh_expires_at=@refreshUntil WHERE session_id=@id", transaction,
            ("@access", Hash(access)), ("@refresh", Hash(replacement)), ("@accessUntil", now.AddMinutes(15)), ("@refreshUntil", now.AddDays(7) < absolute ? now.AddDays(7) : absolute), ("@id", id));
        await update.ExecuteNonQueryAsync(token); await transaction.CommitAsync(token);
        return Tokens(access, replacement);
    }

    public async Task<JsonArray> Sessions(string user, CancellationToken token)
    {
        await using var connection = await database.Open(token);
        await using var command = AccountDatabase.Command(connection, "SELECT session_id,device_name,created_at,refresh_expires_at,revoked_at FROM auth_sessions WHERE user_id=@user ORDER BY created_at DESC LIMIT 100", null, ("@user", user));
        await using var reader = await command.ExecuteReaderAsync(token); var result = new JsonArray();
        while (await reader.ReadAsync(token)) result.Add(new JsonObject { ["sessionId"] = reader.GetString(0), ["deviceName"] = reader.IsDBNull(1) ? null : reader.GetString(1), ["createdAt"] = DateTime.SpecifyKind(reader.GetDateTime(2), DateTimeKind.Utc).ToString("O"), ["expiresAt"] = DateTime.SpecifyKind(reader.GetDateTime(3), DateTimeKind.Utc).ToString("O"), ["status"] = !reader.IsDBNull(4) ? "REVOKED" : reader.GetDateTime(3) <= DateTime.UtcNow ? "EXPIRED" : "ACTIVE" });
        return result;
    }

    public async Task Revoke(string user, string session, CancellationToken token)
    {
        await using var connection = await database.Open(token);
        await using var command = AccountDatabase.Command(connection, "UPDATE auth_sessions SET revoked_at=COALESCE(revoked_at,UTC_TIMESTAMP(6)) WHERE session_id=@id AND user_id=@user", null, ("@id", session), ("@user", user));
        if (await command.ExecuteNonQueryAsync(token) == 0) throw Api.Missing();
    }

    public async Task ChangePassword(Credential credential, string replacementHash, CancellationToken token)
    {
        await using var connection = await database.Open(token);
        await using var transaction = await connection.BeginTransactionAsync(token);
        await using (var command = AccountDatabase.Command(connection, "UPDATE auth_credentials SET password_hash=@new WHERE user_id=@id AND password_hash=@old AND status='ACTIVE'", transaction,
            ("@new", replacementHash), ("@id", credential.UserId), ("@old", credential.PasswordHash)))
            if (await command.ExecuteNonQueryAsync(token) != 1) throw new ApiException(409, "STATE_CONFLICT", "账号已变更，请重新登录");
        await using var revoke = AccountDatabase.Command(connection, "UPDATE auth_sessions SET revoked_at=COALESCE(revoked_at,UTC_TIMESTAMP(6)) WHERE user_id=@id", transaction, ("@id", credential.UserId));
        await revoke.ExecuteNonQueryAsync(token); await transaction.CommitAsync(token);
    }
}
