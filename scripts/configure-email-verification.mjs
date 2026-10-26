import { spawn } from 'node:child_process';
import { readFileSync, existsSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { parseEnv } from './launcher-config.mjs';
const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const account = parseEnv(readFileSync(join(root, '.env.accounts'), 'utf8'));
const adminFile = join(root, '.env.mysql-admin');
const admin = existsSync(adminFile) ? parseEnv(readFileSync(adminFile, 'utf8')) : {};
const check = process.argv.includes('--check');
const administrator = process.env.MYSQL_ADMIN_CONNECTION_STRING || admin.MYSQL_ADMIN_CONNECTION_STRING;
if (!check && !administrator) throw Error('Fill MYSQL_ADMIN_CONNECTION_STRING in .env.mysql-admin first. Existing databases will not be reset.');
const environment = { ...process.env, APPDATA: join(root, '.runtime/build-appdata'), DOTNET_CLI_HOME: join(root, '.runtime/dotnet'), NUGET_PACKAGES: join(root, '.runtime/nuget-packages'), MYSQL_RUNTIME_CONNECTION_STRING: account.MYSQL_CONNECTION_STRING, MYSQL_ADMIN_CONNECTION_STRING: administrator || '' };
const project = 'tools/ConfigureEmailVerification/ConfigureEmailVerification.csproj', output = join(root, '.runtime/email-db-setup');
const commands = process.argv.includes('--skip-build') ? [] : [['restore', project, '--configfile', 'NuGet.Config'], ['build', project, '--no-restore', '--nologo', '-o', output]];
commands.push([join(output, 'ConfigureEmailVerification.dll'), ...(check ? ['--check'] : [])]);
for (const args of commands) {
  const child = spawn('dotnet', args, { cwd: join(root, 'Backend'), env: environment, windowsHide: true, stdio: 'inherit' });
  const [code] = await once(child, 'exit'); if (code !== 0) process.exit(code || 1);
}
if (!check && existsSync(adminFile) && Object.keys(admin).length === 1 && admin.MYSQL_ADMIN_CONNECTION_STRING) { unlinkSync(adminFile); console.log('Removed the temporary administrator credential input file.'); }
