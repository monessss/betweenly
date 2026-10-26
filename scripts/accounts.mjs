// Backend-only web profile. Keeps existing MVP/desktop files and data untouched.
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, readFileSync, mkdirSync, openSync, closeSync, unlinkSync, writeFileSync } from 'node:fs';
import { resolve, join, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { parseEnv, processAlive } from './launcher-config.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const local = existsSync(join(root, '.env.accounts')) ? parseEnv(readFileSync(join(root, '.env.accounts'), 'utf8')) : {};
const mail = existsSync(join(root, '.env.mail')) ? parseEnv(readFileSync(join(root, '.env.mail'), 'utf8')) : {};
const config = { ...local, ...mail, ...process.env };
if (!config.MYSQL_CONNECTION_STRING) throw Error('Copy .env.accounts.example to .env.accounts and configure a new MySQL database first.');
const gatewayPort = Number(config.BETWEENLY_WEB_GATEWAY_PORT || 5088);
const firstPort = Number(config.BETWEENLY_WEB_SERVICE_PORT || 5141);
if (![gatewayPort, firstPort].every(p => Number.isInteger(p) && p > 1024 && p < 65000) || gatewayPort >= firstPort && gatewayPort <= firstPort + 5) throw Error('Invalid or overlapping backend ports.');
const runtime = resolve(config.BETWEENLY_WEB_RUNTIME || join(root, '.runtime/web'));
const runtimeRelative = relative(join(root, '.runtime'), runtime);
if (!runtimeRelative || runtimeRelative.startsWith('..') || isAbsolute(runtimeRelative)) throw Error('Web runtime must be a subdirectory of this workspace .runtime directory.');
const output = resolve(config.BETWEENLY_ACCOUNTS_BUILD || join(root, '.runtime/accounts-build'));
const outputRelative = relative(join(root, '.runtime'), output);
if (!outputRelative || outputRelative.startsWith('..') || isAbsolute(outputRelative)) throw Error('Build output must be a subdirectory of this workspace .runtime directory.');
mkdirSync(join(runtime, 'logs'), { recursive: true });
const environment = { ...process.env, APPDATA: join(root, '.runtime/build-appdata'), DOTNET_CLI_HOME: join(root, '.runtime/dotnet'), NUGET_PACKAGES: join(root, '.runtime/nuget-packages'), DOTNET_NOLOGO: '1', DOTNET_CLI_TELEMETRY_OPTOUT: '1', ASPNETCORE_ENVIRONMENT: 'Production', DOTNET_ENVIRONMENT: 'Production' };
for (const name of ['MYSQL_CONNECTION_STRING', 'ConnectionStrings__Accounts', 'DEEPSEEK_API_KEY', 'TYPESAFE_API_KEY']) delete environment[name];
for (const name of Object.keys(environment)) if (name.startsWith('EMAIL_') || name.startsWith('Email__')) delete environment[name];
const children = [];
function start(command, args, cwd, env = {}, label) {
  const log = label ? openSync(join(runtime, 'logs', label + '.log'), 'a') : null;
  const child = spawn(command, args, { cwd, env: { ...environment, ...env }, windowsHide: true, stdio: log === null ? 'inherit' : ['ignore', log, log] });
  if (log !== null) { closeSync(log); children.push(child); child.on('error', () => { console.error(label + ' could not start.'); void stop(1); }); }
  return child;
}
async function build(folder, solution, buildOutput) {
  for (const args of [['restore', solution, '--configfile', 'NuGet.Config'], ['build', solution, '--no-restore', '--nologo', '-p:OutputPath=' + buildOutput + '/']]) {
    const child = start('dotnet', args, join(root, folder)); const [code] = await once(child, 'exit'); if (code) throw Error(folder + ' build failed.');
  }
}
let stopping = false;
let stopTimer;
let ownsRegistry = false;
const registry = join(runtime, 'run.json');
if (existsSync(registry)) {
  const previous = JSON.parse(readFileSync(registry, 'utf8'));
  if (processAlive(previous.launcherPid)) throw Error('Web backend is already running. Stop it with scripts/stop-accounts.ps1.');
}
const stopFile = join(runtime, 'stop');
async function stop(code = 0) {
  if (stopping) return; stopping = true; clearInterval(stopTimer);
  for (const child of [...children].reverse()) if (child.exitCode === null) child.kill();
  await Promise.all(children.filter(child => child.exitCode === null).map(child => Promise.race([once(child, 'exit'), delay(3000)])));
  if (ownsRegistry && existsSync(registry) && JSON.parse(readFileSync(registry, 'utf8')).launcherPid === process.pid) {
    if (existsSync(stopFile)) unlinkSync(stopFile);
    unlinkSync(registry);
  }
  process.exit(code);
}
process.on('SIGINT', () => void stop()); process.on('SIGTERM', () => void stop());
async function wait(url) {
  for (let attempt = 0; attempt < 150; attempt++) {
    if (children.some(child => child.exitCode !== null)) throw Error('A backend stopped. See .runtime/web/logs.');
    try { if ((await fetch(url, { signal: AbortSignal.timeout(800) })).ok) return; } catch { }
    await delay(200);
  }
  throw Error('Backend readiness failed. See .runtime/web/logs.');
}
try {
  for (const port of [gatewayPort, ...Array.from({ length: 6 }, (_, index) => firstPort + index)]) {
    const server = createServer(); server.listen(port, '127.0.0.1'); await once(server, 'listening'); await new Promise(done => server.close(done));
  }
  if (existsSync(stopFile)) unlinkSync(stopFile);
  if (!process.argv.includes('--skip-build')) { await build('Backend', 'Backend.sln', join(output, 'backend')); await build('Gateway', 'Gateway.sln', join(output, 'gateway')); }
  const names = ['expression-style-service', 'contact-context-service', 'advice-service', 'analysis-service', 'auth-service', 'user-service'];
  const keys = Object.fromEntries(names.map(name => [name, randomBytes(32).toString('hex')]));
  const serviceKeys = Object.fromEntries(['AdviceService', 'ContactContextService', 'AuthService'].map(name => [name, randomBytes(32).toString('hex')]));
  const gatewayUrl = 'http://127.0.0.1:' + gatewayPort;
  const gatewayEnv = { Gateway__AccountAuth__Enabled: 'true', Gateway__DevelopmentAuth__Enabled: 'false', Gateway__DesktopAuth__Enabled: 'false', Gateway__RequestTimeoutSeconds: '75', ASPNETCORE_URLS: gatewayUrl };
  for (const [name, key] of Object.entries(serviceKeys)) gatewayEnv['Gateway__ServiceCredentials__' + name] = key;
  names.forEach((name, index) => { gatewayEnv[`Gateway__Services__${name}__BaseUrl`] = 'http://127.0.0.1:' + (firstPort + index); gatewayEnv[`Gateway__Services__${name}__GatewayKey`] = keys[name]; });
  for (const [project, index] of [['ExpressionStyleService', 0], ['ContactContextService', 1], ['AdviceService', 2], ['AuthService', 4], ['UserService', 5]]) {
    const account = index >= 4;
    start('dotnet', [join(output, 'backend', project + '.dll')], root, {
      GATEWAY_KEY: keys[names[index]], SERVICE_CREDENTIAL: serviceKeys[project] || '', INTERNAL_GATEWAY_URL: gatewayUrl,
      ASPNETCORE_URLS: 'http://127.0.0.1:' + (firstPort + index), DATA_DIRECTORY: join(runtime, 'data', names[index]),
      ...(account ? { ConnectionStrings__Accounts: config.MYSQL_CONNECTION_STRING, Accounts__InitializeSchema: config.ACCOUNTS_INITIALIZE_SCHEMA || 'false' } : {}),
      ...(project === 'AuthService' ? {
        Email__SmtpHost: config.EMAIL_SMTP_HOST || '', Email__SmtpPort: config.EMAIL_SMTP_PORT || '465',
        Email__Username: config.EMAIL_USERNAME || '', Email__Password: config.EMAIL_PASSWORD || '',
        Email__FromAddress: config.EMAIL_FROM_ADDRESS || config.EMAIL_USERNAME || '', Email__Security: config.EMAIL_SECURITY || 'SslOnConnect',
        Email__VerificationSecret: config.EMAIL_VERIFICATION_SECRET || '', Email__TestMode: config.EMAIL_TEST_MODE || 'false'
      } : {})
    }, names[index]);
  }
  const bundledPython = join(homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe');
  const python = config.BETWEENLY_PYTHON || (existsSync(bundledPython) ? bundledPython : process.platform === 'win32' ? 'python' : 'python3');
  start(python, ['-u', 'server.py'], join(root, 'Backend/AnalysisService'), {
    GATEWAY_KEY: keys[names[3]], ANALYSIS_PORT: String(firstPort + 3), MODEL_CREDENTIAL_DIRECTORY: join(runtime, 'data/model-credentials'), DEEPSEEK_API_KEY: '', TYPESAFE_API_KEY: '', JEV_ENABLED: 'auto'
  }, names[3]);
  start('dotnet', [join(output, 'gateway/SocialAssistant.Gateway.dll')], join(root, 'Gateway'), gatewayEnv, 'gateway');
  await wait(gatewayUrl + '/readyz');
  writeFileSync(registry, JSON.stringify({ launcherPid: process.pid, gatewayUrl, children: children.map(child => child.pid) }, null, 2));
  ownsRegistry = true;
  stopTimer = setInterval(() => { if (existsSync(stopFile)) void stop(); }, 400);
  console.log('ACCOUNTS_READY ' + gatewayUrl + '/api/v1');
  console.log('Backend only. Auth/User use MySQL; existing social services use fresh .runtime/web/data JSON stores. No old data imported.');
  console.log('Stop with Ctrl+C. Logs: .runtime/web/logs.');
  for (const child of children) child.once('exit', () => { if (!stopping) { console.error('A backend stopped. See .runtime/web/logs.'); void stop(1); } });
} catch (error) { console.error(error.message); await stop(1); }
