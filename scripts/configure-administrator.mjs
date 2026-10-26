import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from './launcher-config.mjs';
const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const read = name => existsSync(join(root, name)) ? parseEnv(readFileSync(join(root, name), 'utf8')) : {};
const account = read('.env.accounts'), admin = read('.env.mysql-admin'), initial = read('.env.admin');
const check = process.argv.includes('--check');
const environment = { ...process.env, APPDATA: join(root, '.runtime/build-appdata'), DOTNET_CLI_HOME: join(root, '.runtime/dotnet'), NUGET_PACKAGES: join(root, '.runtime/nuget-packages'), MYSQL_RUNTIME_CONNECTION_STRING: process.env.MYSQL_RUNTIME_CONNECTION_STRING || account.MYSQL_CONNECTION_STRING, MYSQL_ADMIN_CONNECTION_STRING: process.env.MYSQL_ADMIN_CONNECTION_STRING || admin.MYSQL_ADMIN_CONNECTION_STRING || '', BETWEENLY_ADMIN_PASSWORD: process.env.BETWEENLY_ADMIN_PASSWORD || initial.BETWEENLY_ADMIN_PASSWORD || '' };
if (!environment.MYSQL_RUNTIME_CONNECTION_STRING || !check && (!environment.MYSQL_ADMIN_CONNECTION_STRING || !environment.BETWEENLY_ADMIN_PASSWORD)) throw Error('Configure local account/admin database connections and BETWEENLY_ADMIN_PASSWORD in .env.admin first.');
const project = 'tools/ConfigureAdministrator/ConfigureAdministrator.csproj', output = join(root, '.runtime/admin-db-setup');
const commands = process.argv.includes('--skip-build') ? [] : [['restore', project, '--configfile', 'NuGet.Config'], ['build', project, '--no-restore', '--nologo', '-o', output]];
commands.push([join(output, 'ConfigureAdministrator.dll'), ...(check ? ['--check'] : [])]);
for (const args of commands) {
  const child = spawn('dotnet', args, { cwd: join(root, 'Backend'), env: environment, windowsHide: true, stdio: 'inherit' });
  const [code] = await once(child, 'exit'); if (code !== 0) process.exit(code || 1);
}
if (!check) for (const [name, data, key] of [['.env.mysql-admin', admin, 'MYSQL_ADMIN_CONNECTION_STRING'], ['.env.admin', initial, 'BETWEENLY_ADMIN_PASSWORD']]) {
  if (existsSync(join(root, name)) && Object.keys(data).length === 1 && data[key]) unlinkSync(join(root, name));
}
if (!check) console.log('Removed one-time local administrator input files when present.');
