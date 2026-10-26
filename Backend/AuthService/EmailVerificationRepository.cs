using Betweenly.Accounts;
using Betweenly.Shared;
using MySqlConnector;
using System.Data;
using System.Security.Cryptography;
using System.Text;

namespace Betweenly.Auth;

public sealed record EmailChallenge(string Id, string Email, string Purpose, string? UserId, string Hash, int Attempts, string State, DateTime Expires, DateTime ResendAfter, bool Consumed);
public sealed class EmailVerificationRepository(AccountDatabase database, string secret)
{
    public string Digest(string id, string email, string purpose, string code)
        => Convert.ToHexString(HMACSHA256.HashData(Encoding.UTF8.GetBytes(secret), Encoding.UTF8.GetBytes(id + "\n" + email + "\n" + purpose + "\n" + code))).ToLowerInvariant();
    public async Task RequireSchema(CancellationToken token)
    {
        try { await using var c = await database.Open(token); await using var q = AccountDatabase.Command(c, "SELECT challenge_id FROM auth_email_challenges LIMIT 0; SELECT user_id FROM auth_verified_emails LIMIT 0"); await q.ExecuteNonQueryAsync(token); }
        catch (MySqlException e) when (e.Number == 1146) { throw new ApiException(503, "EMAIL_SCHEMA_NOT_READY", "邮箱验证数据表尚未初始化，请联系管理员"); }
    }
    public async Task<bool> IsVerified(string user, string email, CancellationToken token)
    {
        try { await using var c = await database.Open(token); await using var q = AccountDatabase.Command(c, "SELECT 1 FROM auth_verified_emails WHERE user_id=@user AND email=@email", null, ("@user", user), ("@email", email)); return await q.ExecuteScalarAsync(token) is not null; }
        catch (MySqlException e) when (e.Number == 1146) { return false; }
    }
    public async Task<EmailChallenge> BeginSend(string email, string purpose, string? user, string code, CancellationToken token)
    {
        await RequireSchema(token);
        await using var c = await database.Open(token); await using var tx = await c.BeginTransactionAsync(IsolationLevel.ReadCommitted, token);
        // Insert a scope row before locking it: two first sends cannot bypass the cooldown.
        await using (var seed = AccountDatabase.Command(c, "INSERT IGNORE INTO auth_email_challenges(challenge_id,email,purpose,user_id,code_hash,attempts,delivery_state,created_at,expires_at,resend_after) VALUES(@id,@email,@purpose,@user,'',0,'FAILED',UTC_TIMESTAMP(6),UTC_TIMESTAMP(6),UTC_TIMESTAMP(6))", tx, ("@id", Api.NewId()), ("@email", email), ("@purpose", purpose), ("@user", user))) await seed.ExecuteNonQueryAsync(token);
        var old = await Read(c, tx, "email=@email AND purpose=@purpose", token, ("@email", email), ("@purpose", purpose));
        if (old!.ResendAfter > DateTime.UtcNow) throw new ApiException(429, "EMAIL_RESEND_TOO_SOON", "请等待 60 秒后重新发送验证码");
        var now = DateTime.UtcNow; var id = Api.NewId(); var hash = Digest(id, email, purpose, code);
        await using var update = AccountDatabase.Command(c, "UPDATE auth_email_challenges SET challenge_id=@id,user_id=@user,code_hash=@hash,attempts=0,delivery_state='SENDING',created_at=@now,expires_at=@until,resend_after=@resend,consumed_at=NULL WHERE email=@email AND purpose=@purpose", tx,
            ("@id", id), ("@user", user), ("@hash", hash), ("@now", now), ("@until", now.AddMinutes(10)), ("@resend", now.AddSeconds(60)), ("@email", email), ("@purpose", purpose));
        await update.ExecuteNonQueryAsync(token); await tx.CommitAsync(token);
        return new(id, email, purpose, user, hash, 0, "SENDING", now.AddMinutes(10), now.AddSeconds(60), false);
    }
    public async Task Delivery(string id, bool success, CancellationToken token)
    {
        await using var c = await database.Open(token); await using var q = AccountDatabase.Command(c, "UPDATE auth_email_challenges SET delivery_state=@state WHERE challenge_id=@id AND delivery_state='SENDING'", null, ("@state", success ? "SENT" : "FAILED"), ("@id", id)); await q.ExecuteNonQueryAsync(token);
    }
    private async Task<EmailChallenge?> Read(MySqlConnection c, MySqlTransaction tx, string where, CancellationToken token, params (string, object?)[] args)
    {
        await using var q = AccountDatabase.Command(c, "SELECT challenge_id,email,purpose,user_id,code_hash,attempts,delivery_state,expires_at,resend_after,consumed_at FROM auth_email_challenges WHERE " + where + " FOR UPDATE", tx, args);
        await using var reader = await q.ExecuteReaderAsync(token);
        return await reader.ReadAsync(token) ? new(reader.GetString(0), reader.GetString(1), reader.GetString(2), reader.IsDBNull(3) ? null : reader.GetString(3), reader.GetString(4), reader.GetInt32(5), reader.GetString(6), DateTime.SpecifyKind(reader.GetDateTime(7), DateTimeKind.Utc), DateTime.SpecifyKind(reader.GetDateTime(8), DateTimeKind.Utc), !reader.IsDBNull(9)) : null;
    }
    private async Task<EmailChallenge> Check(MySqlConnection c, MySqlTransaction tx, string id, string email, string purpose, string? user, string code, CancellationToken token)
    {
        var row = await Read(c, tx, "challenge_id=@id", token, ("@id", id));
        var eligible = row is not null && row.Email == email && row.Purpose == purpose && row.UserId == user && row.State == "SENT" && !row.Consumed && row.Expires > DateTime.UtcNow && row.Attempts < 5;
        if (eligible && CryptographicOperations.FixedTimeEquals(Encoding.ASCII.GetBytes(row!.Hash), Encoding.ASCII.GetBytes(Digest(id, email, purpose, code)))) return row;
        if (eligible)
        {
            await using var attempts = AccountDatabase.Command(c, "UPDATE auth_email_challenges SET attempts=attempts+1 WHERE challenge_id=@id", tx, ("@id", id)); await attempts.ExecuteNonQueryAsync(token);
            await tx.CommitAsync(token); // Failed guesses must survive transaction disposal.
        }
        throw new ApiException(422, "EMAIL_CODE_INVALID", "验证码无效、已使用或已过期，请重新获取");
    }
    private static async Task MarkVerified(MySqlConnection c, MySqlTransaction tx, string user, string email, string challenge, CancellationToken token)
    {
        await using (var verified = AccountDatabase.Command(c, "INSERT INTO auth_verified_emails(user_id,email,verified_at) VALUES(@user,@email,UTC_TIMESTAMP(6)) ON DUPLICATE KEY UPDATE email=@email,verified_at=UTC_TIMESTAMP(6)", tx, ("@user", user), ("@email", email))) await verified.ExecuteNonQueryAsync(token);
        await using var consume = AccountDatabase.Command(c, "UPDATE auth_email_challenges SET consumed_at=UTC_TIMESTAMP(6) WHERE challenge_id=@id", tx, ("@id", challenge)); await consume.ExecuteNonQueryAsync(token);
    }
    public async Task<Credential?> ReserveRegistration(Credential candidate, string challenge, string code, CancellationToken token)
    {
        await RequireSchema(token);
        await using var c = await database.Open(token); await using var tx = await c.BeginTransactionAsync(IsolationLevel.ReadCommitted, token);
        await Check(c, tx, challenge, candidate.Email, "REGISTER", null, code, token);
        await using var insert = AccountDatabase.Command(c, "INSERT INTO auth_credentials(user_id,email,username,normalized_username,password_hash,status,created_at) VALUES(@id,@email,@name,@normalized,@hash,'PROVISIONING',UTC_TIMESTAMP(6))", tx,
            ("@id", candidate.UserId), ("@email", candidate.Email), ("@name", candidate.Username), ("@normalized", AccountValidation.NormalizeUsername(candidate.Username)), ("@hash", candidate.PasswordHash));
        try { await insert.ExecuteNonQueryAsync(token); }
        catch (MySqlException e) when (e.Number == 1062) { return null; }
        await MarkVerified(c, tx, candidate.UserId, candidate.Email, challenge, token); await tx.CommitAsync(token); return candidate;
    }
    public async Task VerifyAccount(string user, string email, string challenge, string code, CancellationToken token)
    {
        await using var c = await database.Open(token); await using var tx = await c.BeginTransactionAsync(IsolationLevel.ReadCommitted, token);
        await Check(c, tx, challenge, email, "ACCOUNT", user, code, token);
        await MarkVerified(c, tx, user, email, challenge, token); await tx.CommitAsync(token);
    }
    public async Task ResetPassword(Credential credential, string challenge, string code, string replacementHash, CancellationToken token)
    {
        await RequireSchema(token);
        await using var c = await database.Open(token); await using var tx = await c.BeginTransactionAsync(IsolationLevel.ReadCommitted, token);
        await Check(c, tx, challenge, credential.Email, "PASSWORD_RESET", credential.UserId, code, token);
        // Password replacement, proof consumption and session revocation succeed together.
        await using (var update = AccountDatabase.Command(c, """
            UPDATE auth_credentials c SET password_hash=@hash WHERE c.user_id=@user AND c.password_hash=@old AND c.status='ACTIVE'
              AND EXISTS(SELECT 1 FROM auth_verified_emails v WHERE v.user_id=c.user_id AND v.email=c.email)
            """, tx, ("@hash", replacementHash), ("@old", credential.PasswordHash), ("@user", credential.UserId)))
            if (await update.ExecuteNonQueryAsync(token) != 1) throw new ApiException(422, "EMAIL_CODE_INVALID", "验证码无效、已使用或已过期，请重新获取");
        await using (var consume = AccountDatabase.Command(c, "UPDATE auth_email_challenges SET consumed_at=UTC_TIMESTAMP(6) WHERE challenge_id=@id", tx, ("@id", challenge))) await consume.ExecuteNonQueryAsync(token);
        await using (var revoke = AccountDatabase.Command(c, "UPDATE auth_sessions SET revoked_at=COALESCE(revoked_at,UTC_TIMESTAMP(6)) WHERE user_id=@user", tx, ("@user", credential.UserId))) await revoke.ExecuteNonQueryAsync(token);
        await tx.CommitAsync(token);
    }
}
