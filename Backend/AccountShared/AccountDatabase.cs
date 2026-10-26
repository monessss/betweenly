using MySqlConnector;

namespace Betweenly.Accounts;

public sealed class AccountDatabase(string connectionString)
{
    // IDs are strings in the existing contract. The connector otherwise maps
    // CHAR(36) columns to Guid values, which breaks string-based readers.
    private readonly string configuredConnection = new MySqlConnectionStringBuilder(connectionString) { GuidFormat = MySqlGuidFormat.None }.ConnectionString;
    public async Task<MySqlConnection> Open(CancellationToken token = default)
    {
        var connection = new MySqlConnection(configuredConnection);
        try { await connection.OpenAsync(token); return connection; }
        catch { await connection.DisposeAsync(); throw; }
    }

    public async Task Initialize(string schema, bool create, CancellationToken token = default)
    {
        await using var connection = await Open(token);
        if (create)
        {
            var assembly = typeof(AccountDatabase).Assembly;
            var resource = assembly.GetManifestResourceNames().Single(name => name.EndsWith("." + schema + ".sql", StringComparison.Ordinal));
            await using var stream = assembly.GetManifestResourceStream(resource)!;
            using var reader = new StreamReader(stream);
            await using var command = Command(connection, await reader.ReadToEndAsync(token));
            await command.ExecuteNonQueryAsync(token);
            if (schema == "auth")
            {
                var emailResource = assembly.GetManifestResourceNames().Single(name => name.EndsWith(".email-verification.sql", StringComparison.Ordinal));
                await using var emailStream = assembly.GetManifestResourceStream(emailResource)!;
                using var emailReader = new StreamReader(emailStream);
                await using var emailCommand = Command(connection, await emailReader.ReadToEndAsync(token));
                await emailCommand.ExecuteNonQueryAsync(token);
                var adminResource = assembly.GetManifestResourceNames().Single(name => name.EndsWith(".admin.sql", StringComparison.Ordinal));
                await using var adminStream = assembly.GetManifestResourceStream(adminResource)!;
                using var adminReader = new StreamReader(adminStream);
                await using var adminCommand = Command(connection, await adminReader.ReadToEndAsync(token));
                await adminCommand.ExecuteNonQueryAsync(token);
            }
        }
        await using var check = Command(connection, schema == "auth" ? "SELECT user_id FROM auth_credentials LIMIT 0" : "SELECT user_id FROM user_profiles LIMIT 0");
        await check.ExecuteNonQueryAsync(token);
    }

    public static MySqlCommand Command(MySqlConnection connection, string sql, MySqlTransaction? transaction = null, params (string Name, object? Value)[] parameters)
    {
        var command = new MySqlCommand(sql, connection, transaction) { CommandTimeout = 10 };
        foreach (var parameter in parameters) command.Parameters.AddWithValue(parameter.Name, parameter.Value ?? DBNull.Value);
        return command;
    }
}
