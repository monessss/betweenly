using Betweenly.Accounts;
using Betweenly.Shared;
using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.Options;
using MySqlConnector;

try
{
    var runtime = new MySqlConnectionStringBuilder(Environment.GetEnvironmentVariable("MYSQL_RUNTIME_CONNECTION_STRING") ?? "") { GuidFormat = MySqlGuidFormat.None };
    if (runtime.Server is not ("127.0.0.1" or "localhost") || string.IsNullOrWhiteSpace(runtime.Database)) throw new InvalidOperationException();
    if (args.Contains("--check"))
    {
        await using var c = new MySqlConnection(runtime.ConnectionString); await c.OpenAsync();
        await using var q = AccountDatabase.Command(c, "SELECT COUNT(*) FROM auth_administrators a JOIN auth_credentials c ON c.user_id=a.user_id WHERE c.normalized_username='ADMIN' AND c.status='ACTIVE'; SELECT event_id FROM auth_admin_audit LIMIT 0; SELECT user_id FROM auth_user_bans LIMIT 0");
        if (Convert.ToInt32(await q.ExecuteScalarAsync()) != 1) throw new InvalidOperationException();
        Console.WriteLine("Administrator and audit tables are ready."); return 0;
    }
    var password = Environment.GetEnvironmentVariable("BETWEENLY_ADMIN_PASSWORD") ?? "";
    if (password.Length is < 1 or > 128 || password.Any(char.IsControl)) throw new InvalidOperationException();
    var admin = new MySqlConnectionStringBuilder(Environment.GetEnvironmentVariable("MYSQL_ADMIN_CONNECTION_STRING") ?? "") { GuidFormat = MySqlGuidFormat.None };
    if (admin.Server is not ("127.0.0.1" or "localhost") || admin.Port != runtime.Port || string.IsNullOrWhiteSpace(admin.UserID)) throw new InvalidOperationException();
    admin.Database = runtime.Database;
    await using var connection = new MySqlConnection(admin.ConnectionString); await connection.OpenAsync();
    await using (var check = AccountDatabase.Command(connection, "SELECT user_id FROM auth_credentials LIMIT 0; SELECT user_id FROM user_profiles LIMIT 0")) await check.ExecuteNonQueryAsync();
    var assembly = typeof(AccountDatabase).Assembly;
    await using (var stream = assembly.GetManifestResourceStream(assembly.GetManifestResourceNames().Single(name => name.EndsWith(".admin.sql", StringComparison.Ordinal)))!)
    using (var reader = new StreamReader(stream))
    await using (var schema = AccountDatabase.Command(connection, await reader.ReadToEndAsync())) await schema.ExecuteNonQueryAsync();
    await using var tx = await connection.BeginTransactionAsync();
    const string email = "admin@betweenly.invalid";
    string? existingId = null;
    await using (var existing = AccountDatabase.Command(connection, "SELECT user_id,username,email,status FROM auth_credentials WHERE normalized_username='ADMIN' OR email=@email FOR UPDATE", tx, ("@email", email)))
    await using (var reader = await existing.ExecuteReaderAsync())
    {
        if (await reader.ReadAsync())
        {
            if (reader.GetString(1) != "admin" || reader.GetString(2) != email || reader.GetString(3) != "ACTIVE") throw new InvalidOperationException();
            existingId = reader.GetString(0);
        }
    }
    if (existingId is not null)
    {
        await using var role = AccountDatabase.Command(connection, "SELECT 1 FROM auth_administrators WHERE user_id=@user", tx, ("@user", existingId));
        if (await role.ExecuteScalarAsync() is null) throw new InvalidOperationException();
        await tx.CommitAsync(); Console.WriteLine("Administrator already exists; its password was not changed."); return 0;
    }
    var user = Api.NewId();
    var hasher = new PasswordHasher<string>(Options.Create(new PasswordHasherOptions { IterationCount = 210_000 }));
    await using (var insert = AccountDatabase.Command(connection, "INSERT INTO auth_credentials(user_id,email,username,normalized_username,password_hash,status,created_at) VALUES(@user,@email,'admin','ADMIN',@hash,'ACTIVE',UTC_TIMESTAMP(6))", tx, ("@user", user), ("@email", email), ("@hash", hasher.HashPassword(user, password)))) await insert.ExecuteNonQueryAsync();
    await using (var profile = AccountDatabase.Command(connection, "INSERT INTO user_profiles(user_id,username,normalized_username,display_name,bio,version,created_at,updated_at) VALUES(@user,'admin','ADMIN','管理员','',1,UTC_TIMESTAMP(6),UTC_TIMESTAMP(6))", tx, ("@user", user))) await profile.ExecuteNonQueryAsync();
    await using (var role = AccountDatabase.Command(connection, "INSERT INTO auth_administrators(user_id,created_at) VALUES(@user,UTC_TIMESTAMP(6))", tx, ("@user", user))) await role.ExecuteNonQueryAsync();
    await using (var audit = AccountDatabase.Command(connection, "INSERT INTO auth_admin_audit(event_id,actor_user_id,target_user_id,action,created_at) VALUES(@event,@user,@user,'BOOTSTRAP',UTC_TIMESTAMP(6))", tx, ("@event", Api.NewId()), ("@user", user))) await audit.ExecuteNonQueryAsync();
    await tx.CommitAsync(); Console.WriteLine("Administrator created. Existing users and passwords were preserved."); return 0;
}
catch (MySqlException e) { Console.Error.WriteLine("Administrator setup failed; MySQL error " + e.Number + ". No credentials are printed."); return 1; }
catch { Console.Error.WriteLine("Administrator setup requires local database configuration and an unused admin account name. No existing account was overwritten."); return 1; }
