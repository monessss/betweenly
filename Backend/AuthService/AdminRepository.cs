using Betweenly.Accounts;
using Betweenly.Shared;
using MySqlConnector;
using System.Data;
using System.Text.Json.Nodes;

namespace Betweenly.Auth;

public sealed class AdminRepository(AccountDatabase database)
{
    public async Task<string> Role(string user, CancellationToken token)
    {
        try
        {
            await using var c = await database.Open(token);
            await using var q = AccountDatabase.Command(c, "SELECT 1 FROM auth_administrators a JOIN auth_credentials c ON c.user_id=a.user_id AND c.status='ACTIVE' WHERE a.user_id=@user AND NOT EXISTS(SELECT 1 FROM auth_user_bans b WHERE b.user_id=a.user_id AND (b.expires_at IS NULL OR b.expires_at>UTC_TIMESTAMP(6)))", null, ("@user", user));
            return await q.ExecuteScalarAsync(token) is null ? "USER" : "ADMIN";
        }
        catch (MySqlException e) when (e.Number == 1146) { return "USER"; }
    }

    public async Task Require(string user, CancellationToken token)
    {
        if (await Role(user, token) != "ADMIN") throw new ApiException(403, "FORBIDDEN", "需要管理员权限");
    }

    private const string Columns = """
        SELECT c.user_id,c.email,c.username,
          CASE WHEN EXISTS(SELECT 1 FROM auth_user_bans b WHERE b.user_id=c.user_id AND (b.expires_at IS NULL OR b.expires_at>UTC_TIMESTAMP(6))) THEN 'BANNED' ELSE c.status END,c.created_at,
          EXISTS(SELECT 1 FROM auth_verified_emails v WHERE v.user_id=c.user_id AND v.email=c.email),
          EXISTS(SELECT 1 FROM auth_administrators a WHERE a.user_id=c.user_id),
          (SELECT b.expires_at FROM auth_user_bans b WHERE b.user_id=c.user_id AND (b.expires_at IS NULL OR b.expires_at>UTC_TIMESTAMP(6)))
        FROM auth_credentials c
        """;
    private static JsonObject Row(MySqlDataReader reader) => new()
    {
        ["userId"] = reader.GetString(0), ["email"] = reader.GetString(1), ["username"] = reader.GetString(2),
        ["status"] = reader.GetString(3), ["createdAt"] = DateTime.SpecifyKind(reader.GetDateTime(4), DateTimeKind.Utc).ToString("O"),
        ["emailVerified"] = reader.GetBoolean(5), ["role"] = reader.GetBoolean(6) ? "ADMIN" : "USER",
        ["banExpiresAt"] = reader.IsDBNull(7) ? null : DateTime.SpecifyKind(reader.GetDateTime(7), DateTimeKind.Utc).ToString("O")
    };

    public async Task<JsonObject> List(string search, int page, CancellationToken token)
    {
        await using var c = await database.Open(token);
        const string where = " WHERE c.status<>'DELETED' AND (@query='' OR LOCATE(@name,c.normalized_username)>0 OR LOCATE(@email,c.email)>0)";
        var args = new (string, object?)[] { ("@query", search), ("@name", AccountValidation.NormalizeUsername(search)), ("@email", search.ToLowerInvariant()), ("@offset", (page - 1) * 20) };
        long total;
        await using (var count = AccountDatabase.Command(c, "SELECT COUNT(*) FROM auth_credentials c" + where, null, args)) total = Convert.ToInt64(await count.ExecuteScalarAsync(token));
        var rows = new JsonArray();
        await using (var q = AccountDatabase.Command(c, Columns + where + " ORDER BY c.created_at DESC,c.user_id LIMIT 20 OFFSET @offset", null, args))
        await using (var reader = await q.ExecuteReaderAsync(token)) while (await reader.ReadAsync(token)) rows.Add(Row(reader));
        return new() { ["items"] = rows, ["total"] = total, ["page"] = page, ["pageSize"] = 20 };
    }

    public async Task<JsonObject> Detail(string user, CancellationToken token)
    {
        await using var c = await database.Open(token); JsonObject result;
        await using (var q = AccountDatabase.Command(c, Columns + " WHERE c.user_id=@user AND c.status<>'DELETED'", null, ("@user", user)))
        await using (var reader = await q.ExecuteReaderAsync(token)) result = await reader.ReadAsync(token) ? Row(reader) : throw Api.Missing();
        await using (var q = AccountDatabase.Command(c, "SELECT COUNT(*),MAX(created_at) FROM auth_sessions WHERE user_id=@user AND revoked_at IS NULL AND access_expires_at>UTC_TIMESTAMP(6) AND refresh_expires_at>UTC_TIMESTAMP(6) AND absolute_expires_at>UTC_TIMESTAMP(6)", null, ("@user", user)))
        await using (var reader = await q.ExecuteReaderAsync(token))
        {
            await reader.ReadAsync(token); result["activeSessions"] = reader.GetInt64(0);
            result["lastActiveSessionAt"] = reader.IsDBNull(1) ? null : DateTime.SpecifyKind(reader.GetDateTime(1), DateTimeKind.Utc).ToString("O");
        }
        return result;
    }

    public async Task ResetPassword(string actor, Credential target, string hash, CancellationToken token)
    {
        await using var c = await database.Open(token); await using var tx = await c.BeginTransactionAsync(IsolationLevel.ReadCommitted, token);
        // Lock the authority row for the write; client-supplied role headers are irrelevant.
        await LockAuthority(c, tx, actor, token);
        // Lock in the same order as email recovery: challenge, then credential, then sessions.
        await using (var cancel = AccountDatabase.Command(c, "UPDATE auth_email_challenges SET consumed_at=COALESCE(consumed_at,UTC_TIMESTAMP(6)) WHERE email=@email AND purpose='PASSWORD_RESET'", tx, ("@email", target.Email))) await cancel.ExecuteNonQueryAsync(token);
        await using (var update = AccountDatabase.Command(c, "UPDATE auth_credentials SET password_hash=@hash WHERE user_id=@user AND password_hash=@old AND status IN ('ACTIVE','PROVISIONING')", tx, ("@hash", hash), ("@user", target.UserId), ("@old", target.PasswordHash)))
            if (await update.ExecuteNonQueryAsync(token) != 1) throw new ApiException(409, "STATE_CONFLICT", "账号已变更，请刷新后重试");
        await using (var revoke = AccountDatabase.Command(c, "UPDATE auth_sessions SET revoked_at=COALESCE(revoked_at,UTC_TIMESTAMP(6)) WHERE user_id=@user", tx, ("@user", target.UserId))) await revoke.ExecuteNonQueryAsync(token);
        await using (var audit = AccountDatabase.Command(c, "INSERT INTO auth_admin_audit(event_id,actor_user_id,target_user_id,action,created_at) VALUES(@event,@actor,@target,'PASSWORD_RESET',UTC_TIMESTAMP(6))", tx, ("@event", Api.NewId()), ("@actor", actor), ("@target", target.UserId))) await audit.ExecuteNonQueryAsync(token);
        await tx.CommitAsync(token);
    }

    private static async Task LockAuthority(MySqlConnection c, MySqlTransaction tx, string actor, CancellationToken token)
    {
        await using var role = AccountDatabase.Command(c, "SELECT a.user_id FROM auth_administrators a WHERE a.user_id=@actor AND EXISTS(SELECT 1 FROM auth_credentials c WHERE c.user_id=a.user_id AND c.status='ACTIVE') AND NOT EXISTS(SELECT 1 FROM auth_user_bans b WHERE b.user_id=a.user_id AND (b.expires_at IS NULL OR b.expires_at>UTC_TIMESTAMP(6))) FOR UPDATE", tx, ("@actor", actor));
        if (await role.ExecuteScalarAsync(token) is null) throw new ApiException(403, "FORBIDDEN", "需要管理员权限");
    }

    public async Task ChangeAccess(string actor, string target, string action, int? minutes, CancellationToken token)
    {
        if (actor == target) throw new ApiException(422, "SELF_PROTECTED", "不能删除或封禁当前管理员账号");
        await using var c = await database.Open(token); await using var tx = await c.BeginTransactionAsync(IsolationLevel.ReadCommitted, token);
        await LockAuthority(c, tx, actor, token);
        // Recovery locks challenges before credentials; keep this order for deletion too.
        if (action == "USER_DELETED")
        {
            await using var cancel = AccountDatabase.Command(c, "UPDATE auth_email_challenges SET consumed_at=COALESCE(consumed_at,UTC_TIMESTAMP(6)) WHERE email=(SELECT email FROM auth_credentials WHERE user_id=@target)", tx, ("@target", target));
            await cancel.ExecuteNonQueryAsync(token);
        }
        await using (var check = AccountDatabase.Command(c, "SELECT status FROM auth_credentials WHERE user_id=@target FOR UPDATE", tx, ("@target", target)))
        {
            var status = await check.ExecuteScalarAsync(token) as string;
            if (status is null or "DELETED") throw Api.Missing();
        }
        if (action == "USER_BANNED")
        {
            var now = DateTime.UtcNow;
            await using var ban = AccountDatabase.Command(c, "INSERT INTO auth_user_bans(user_id,actor_user_id,created_at,expires_at) VALUES(@target,@actor,@now,@until) ON DUPLICATE KEY UPDATE actor_user_id=@actor,created_at=@now,expires_at=@until", tx, ("@target", target), ("@actor", actor), ("@now", now), ("@until", minutes is null ? null : now.AddMinutes(minutes.Value)));
            await ban.ExecuteNonQueryAsync(token);
        }
        else if (action == "USER_UNBANNED")
        {
            await using var unban = AccountDatabase.Command(c, "DELETE FROM auth_user_bans WHERE user_id=@target", tx, ("@target", target)); await unban.ExecuteNonQueryAsync(token);
        }
        else if (action == "USER_DELETED")
        {
            await using var remove = AccountDatabase.Command(c, "UPDATE auth_credentials SET status='DELETED' WHERE user_id=@target", tx, ("@target", target)); await remove.ExecuteNonQueryAsync(token);
        }
        else throw Api.Invalid();
        if (action != "USER_UNBANNED")
        {
            await using var revoke = AccountDatabase.Command(c, "UPDATE auth_sessions SET revoked_at=COALESCE(revoked_at,UTC_TIMESTAMP(6)) WHERE user_id=@target", tx, ("@target", target)); await revoke.ExecuteNonQueryAsync(token);
        }
        await using (var audit = AccountDatabase.Command(c, "INSERT INTO auth_admin_audit(event_id,actor_user_id,target_user_id,action,created_at) VALUES(@event,@actor,@target,@action,UTC_TIMESTAMP(6))", tx, ("@event", Api.NewId()), ("@actor", actor), ("@target", target), ("@action", action))) await audit.ExecuteNonQueryAsync(token);
        await tx.CommitAsync(token);
    }
}
