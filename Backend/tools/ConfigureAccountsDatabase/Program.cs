using Betweenly.Accounts;
using MySqlConnector;
using System.Security.Cryptography;

var root = Path.GetFullPath(args.Single());
var target = Path.Combine(root, ".env.accounts");
if (File.Exists(target)) throw new InvalidOperationException(".env.accounts already exists; no database or credentials were changed.");
var raw = Environment.GetEnvironmentVariable("MYSQL_ADMIN_CONNECTION_STRING");
if (string.IsNullOrWhiteSpace(raw)) throw new InvalidOperationException("MYSQL_ADMIN_CONNECTION_STRING is required.");
var admin = new MySqlConnectionStringBuilder(raw) { Database = "", ConnectionTimeout = 5 };
if (admin.Server is not ("127.0.0.1" or "localhost")) throw new InvalidOperationException("This setup command only configures the local MySQL server.");
await using var connection = new MySqlConnection(admin.ConnectionString);
try { await connection.OpenAsync(); }
catch (MySqlException error) { Console.Error.WriteLine("Administrator connection failed; MySQL error " + error.Number + ". No passwords are printed."); return 1; }

var database = "betweenly_accounts";
await using (var exists = AccountDatabase.Command(connection, "SELECT COUNT(*) FROM information_schema.schemata WHERE schema_name=@name", null, ("@name", database)))
    if (Convert.ToInt32(await exists.ExecuteScalarAsync()) > 0) database += "_" + DateTime.UtcNow.ToString("yyyyMMddHHmmss") + "_" + Convert.ToHexString(RandomNumberGenerator.GetBytes(2)).ToLowerInvariant();
var username = "betweenly_app_" + Convert.ToHexString(RandomNumberGenerator.GetBytes(4)).ToLowerInvariant();
var password = Convert.ToHexString(RandomNumberGenerator.GetBytes(32)).ToLowerInvariant();
await using (var create = AccountDatabase.Command(connection, $"CREATE DATABASE `{database}` CHARACTER SET utf8mb4 COLLATE utf8mb4_bin")) await create.ExecuteNonQueryAsync();
admin.Database = database;
var schema = new AccountDatabase(admin.ConnectionString);
await schema.Initialize("auth", true); await schema.Initialize("users", true);
foreach (var host in new[] { "localhost", "127.0.0.1" })
{
    await using (var create = AccountDatabase.Command(connection, $"CREATE USER '{username}'@'{host}' IDENTIFIED BY @password", null, ("@password", password))) await create.ExecuteNonQueryAsync();
    await using var grant = AccountDatabase.Command(connection, $"GRANT SELECT,INSERT,UPDATE,DELETE ON `{database}`.* TO '{username}'@'{host}'");
    await grant.ExecuteNonQueryAsync();
}
var application = new MySqlConnectionStringBuilder(admin.ConnectionString) { UserID = username, Password = password };
var verify = new AccountDatabase(application.ConnectionString);
await verify.Initialize("auth", false); await verify.Initialize("users", false);
await using (var check = await verify.Open())
{
    await using var command = AccountDatabase.Command(check, "SELECT (SELECT COUNT(*) FROM auth_credentials)+(SELECT COUNT(*) FROM auth_sessions)+(SELECT COUNT(*) FROM user_profiles)");
    if (Convert.ToInt32(await command.ExecuteScalarAsync()) != 0) throw new InvalidOperationException("New database is not empty; configuration was not written.");
}
var contents = "# Local database credentials; ignored by Git. Never share this file.\nMYSQL_CONNECTION_STRING=" + application.ConnectionString + "\nACCOUNTS_INITIALIZE_SCHEMA=false\nBETWEENLY_WEB_GATEWAY_PORT=5088\nBETWEENLY_WEB_SERVICE_PORT=5141\nBETWEENLY_PYTHON=\n";
await using (var file = new FileStream(target, FileMode.CreateNew, FileAccess.Write, FileShare.None))
await using (var writer = new StreamWriter(file)) await writer.WriteAsync(contents);
Console.WriteLine("Configured database: " + database);
Console.WriteLine("Application account: " + username + " (localhost/127.0.0.1 only; SELECT/INSERT/UPDATE/DELETE)");
Console.WriteLine("Created 5 tables and verified empty account/profile data. Configuration: .env.accounts (password hidden).");
return 0;
