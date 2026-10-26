using Betweenly.Accounts;
using MySqlConnector;

try
{
    var runtime = new MySqlConnectionStringBuilder(Environment.GetEnvironmentVariable("MYSQL_RUNTIME_CONNECTION_STRING") ?? "");
    if (runtime.Server is not ("127.0.0.1" or "localhost") || string.IsNullOrWhiteSpace(runtime.Database)) throw new InvalidOperationException("需要本机现有账号数据库配置");
    if (args.Contains("--check"))
    {
        await using var existing = new MySqlConnection(runtime.ConnectionString); await existing.OpenAsync();
        await using var check = AccountDatabase.Command(existing, "SELECT challenge_id FROM auth_email_challenges LIMIT 0; SELECT user_id FROM auth_verified_emails LIMIT 0");
        await check.ExecuteNonQueryAsync(); Console.WriteLine("Email verification tables are ready."); return 0;
    }
    var administrator = new MySqlConnectionStringBuilder(Environment.GetEnvironmentVariable("MYSQL_ADMIN_CONNECTION_STRING") ?? "");
    if (administrator.Server is not ("127.0.0.1" or "localhost") || administrator.Port != runtime.Port || string.IsNullOrWhiteSpace(administrator.UserID)) throw new InvalidOperationException("管理员连接必须指向同一本机 MySQL");
    administrator.Database = runtime.Database;
    await using var connection = new MySqlConnection(administrator.ConnectionString); await connection.OpenAsync();
    await using (var check = AccountDatabase.Command(connection, "SELECT user_id FROM auth_credentials LIMIT 0; SELECT user_id FROM user_profiles LIMIT 0")) await check.ExecuteNonQueryAsync();
    var assembly = typeof(AccountDatabase).Assembly;
    var resource = assembly.GetManifestResourceNames().Single(name => name.EndsWith(".email-verification.sql", StringComparison.Ordinal));
    await using var stream = assembly.GetManifestResourceStream(resource)!; using var reader = new StreamReader(stream);
    await using var command = AccountDatabase.Command(connection, await reader.ReadToEndAsync()); await command.ExecuteNonQueryAsync();
    Console.WriteLine("Created email verification tables. Existing accounts, passwords and data are unchanged."); return 0;
}
catch (MySqlException error) { Console.Error.WriteLine("Email schema setup failed; MySQL error " + error.Number + ". No credentials are printed."); return 1; }
catch { Console.Error.WriteLine("Email schema setup requires valid local account/admin configuration. No database was reset."); return 1; }
