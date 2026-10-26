using Betweenly.Accounts;
using Betweenly.Shared;
using MySqlConnector;
using System.Text.Json.Nodes;

namespace Betweenly.Users;

public sealed class UserRepository(AccountDatabase database)
{
    public async Task<JsonObject> Get(string userId, CancellationToken token)
    {
        await using var connection = await database.Open(token);
        await using var command = AccountDatabase.Command(connection, "SELECT username,display_name,bio,version,created_at,updated_at FROM user_profiles WHERE user_id=@id", null, ("@id", userId));
        await using var reader = await command.ExecuteReaderAsync(token);
        if (!await reader.ReadAsync(token)) throw Api.Missing();
        return new JsonObject { ["userId"] = userId, ["username"] = reader.GetString(0), ["displayName"] = reader.GetString(1), ["bio"] = reader.GetString(2), ["version"] = reader.GetInt32(3), ["createdAt"] = DateTime.SpecifyKind(reader.GetDateTime(4), DateTimeKind.Utc).ToString("O"), ["updatedAt"] = DateTime.SpecifyKind(reader.GetDateTime(5), DateTimeKind.Utc).ToString("O") };
    }

    public async Task<JsonObject> Create(string id, string username, CancellationToken token)
    {
        await using var connection = await database.Open(token);
        await using var command = AccountDatabase.Command(connection, "INSERT INTO user_profiles(user_id,username,normalized_username,display_name,created_at,updated_at) VALUES(@id,@name,@normalized,@name,UTC_TIMESTAMP(6),UTC_TIMESTAMP(6))", null,
            ("@id", id), ("@name", username), ("@normalized", AccountValidation.NormalizeUsername(username)));
        try { await command.ExecuteNonQueryAsync(token); }
        catch (MySqlException error) when (error.Number == 1062)
        {
            // AuthService can retry provisioning after a timeout or process crash.
            var existing = await Get(id, token);
            if (existing["username"]!.GetValue<string>() != username) throw new ApiException(409, "STATE_CONFLICT", "用户资料与注册信息不一致");
            return existing;
        }
        return await Get(id, token);
    }

    public async Task Update(string id, int version, string? displayName, string? bio, CancellationToken token)
    {
        await using var connection = await database.Open(token);
        await using var command = AccountDatabase.Command(connection,
            "UPDATE user_profiles SET display_name=COALESCE(@name,display_name),bio=COALESCE(@bio,bio),version=version+1,updated_at=UTC_TIMESTAMP(6) WHERE user_id=@id AND version=@version", null,
            ("@id", id), ("@version", version), ("@name", displayName), ("@bio", bio));
        if (await command.ExecuteNonQueryAsync(token) != 1) { await Get(id, token); throw new ApiException(409, "VERSION_CONFLICT", "资料已变更，请刷新后重试"); }
    }
}
