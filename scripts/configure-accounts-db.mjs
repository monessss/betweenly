// Reads the user's local administrator input without echoing passwords. The
// administrator credential is passed through the environment, never argv/SQL logs.
import { spawn } from 'node:child_process';
import { readFileSync, existsSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { parseEnv } from './launcher-config.mjs';
const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const file = join(root, '.env.mysql-admin');
const settings = existsSync(file) ? parseEnv(readFileSync(file, 'utf8')) : {};
const secret = process.env.MYSQL_ADMIN_CONNECTION_STRING || settings.MYSQL_ADMIN_CONNECTION_STRING;
if (!secret) throw Error('Fill MYSQL_ADMIN_CONNECTION_STRING in .env.mysql-admin first.');
const output = join(root, '.runtime/accounts-db-setup');
const environment = { ...process.env, APPDATA: join(root, '.runtime/build-appdata'), DOTNET_CLI_HOME: join(root, '.runtime/dotnet'), NUGET_PACKAGES: join(root, '.runtime/nuget-packages'), MYSQL_ADMIN_CONNECTION_STRING: secret };
const project = 'tools/ConfigureAccountsDatabase/ConfigureAccountsDatabase.csproj';
const commands = process.argv.includes('--skip-build') ? [] : [['restore', project, '--configfile', 'NuGet.Config'], ['build', project, '--no-restore', '--nologo', '-o', output]];
commands.push([join(output, 'ConfigureAccountsDatabase.dll'), root]);
for (const args of commands) {
  const child = spawn('dotnet', args, { cwd: join(root, 'Backend'), env: environment, windowsHide: true, stdio: 'inherit' });
  const [code] = await once(child, 'exit'); if (code !== 0) process.exit(code || 1);
}
if (existsSync(file) && Object.keys(settings).length === 1 && settings.MYSQL_ADMIN_CONNECTION_STRING) {
  unlinkSync(file);
  console.log('Removed the temporary administrator credential input file.');
}
