import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync, openSync, closeSync, unlinkSync, appendFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { randomBytes } from 'node:crypto';
import { resolve, join, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { parseEnv, processAlive } from './launcher-config.mjs';

let launcherFailureLog;
function logStartup(message) {
  if (launcherFailureLog) try { appendFileSync(launcherFailureLog, `${new Date().toISOString()} ${message}\n`); } catch { /* Console remains available if disk logging fails. */ }
}

async function main() {
const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const args = new Set(process.argv.slice(2));
const offset = Number(process.env.BETWEENLY_PORT_OFFSET ?? 0);
if (!Number.isInteger(offset) || offset < 0 || offset > 50000) throw Error('Invalid port offset');
const runtime = resolve(process.env.BETWEENLY_RUNTIME ?? join(root, '.runtime/mvp'));
const rel = relative(root, runtime);
if (rel.startsWith('..') || isAbsolute(rel)) throw Error('Runtime directory must be inside this workspace');
mkdirSync(join(runtime, 'logs'), { recursive: true });
launcherFailureLog = join(runtime, 'logs', 'launcher.log');
const [nodeMajor, nodeMinor] = process.versions.node.split('.').map(Number);
if (nodeMajor < 22 || nodeMajor === 22 && nodeMinor < 18) throw Error('Node.js 22.18 or newer is required.');
const local = existsSync(join(root, '.env')) ? parseEnv(readFileSync(join(root, '.env'), 'utf8')) : {};
const config = { ...local, ...process.env };
const bundledPython = join(homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe');
const python = config.BETWEENLY_PYTHON || (existsSync(bundledPython) ? bundledPython : process.platform === 'win32' ? 'python' : 'python3');
const childEnv = { ...process.env, DOTNET_CLI_TELEMETRY_OPTOUT: '1', DOTNET_SKIP_FIRST_TIME_EXPERIENCE: '1', DOTNET_NOLOGO: '1',
  DOTNET_CLI_HOME: join(root, '.runtime/dotnet'),
  ASPNETCORE_ENVIRONMENT: 'Development', DOTNET_ENVIRONMENT: 'Development' };
// Even when configured as parent environment variables, provider secrets belong only to Python.
delete childEnv.DEEPSEEK_API_KEY;
delete childEnv.DEEPSEEK_MODEL;
delete childEnv.DEEPSEEK_BASE_URL;
delete childEnv.TYPESAFE_API_KEY;
delete childEnv.JEV_ENABLED;
delete childEnv.JEV_MODEL;
delete childEnv.JEV_BASE_URL;
if (process.platform === 'win32') childEnv.APPDATA = join(root, '.runtime/build-appdata');
const children = [];
let stopping = false, timer;
const manifest = join(runtime, 'run.json');
if (existsSync(manifest)) {
  let previous;
  try { previous = JSON.parse(readFileSync(manifest, 'utf8')); }
  catch { throw Error('The local startup registry is unreadable. Check .runtime/mvp/run.json.'); }
  if (processAlive(previous.launcherPid)) {
    const existingUrl = `http://127.0.0.1:${5080 + offset}`;
    let healthy = false;
    try {
      const response = await fetch(existingUrl + '/healthz', { signal: AbortSignal.timeout(3000), redirect: 'error' });
      const result = await response.json();
      healthy = response.ok && result.service === 'api-gateway' && result.status === 'healthy';
    } catch { /* Report a live but unreachable instance without stopping it. */ }
    if (healthy) {
      console.log(`Betweenly is already running. Open http://127.0.0.1:3000`);
      console.log(`Gateway: ${existingUrl}/api/v1`);
      logStartup('Existing running instance detected; no processes or data changed.');
      return;
    }
    throw Error(`A Betweenly launcher is already active (PID ${previous.launcherPid}), but its Gateway is not reachable yet. Wait briefly or use scripts/stop-mvp.ps1 before restarting. Check ${relative(root, runtime)}/logs.`);
  }
}
if (existsSync(join(runtime, 'stop'))) unlinkSync(join(runtime, 'stop'));
function run(command, arguments_, cwd, extra = {}, label) {
  const log = label ? openSync(join(runtime, 'logs', `${label}.log`), 'a') : null;
  const child = spawn(command, arguments_, { cwd, env: { ...childEnv, ...extra }, windowsHide: true, stdio: log === null ? 'inherit' : ['ignore', log, log] });
  if (log !== null) closeSync(log); return child;
}
async function build(folder, solution) {
  logStartup(`Building ${folder}.`);
  for (const arguments_ of [['restore', solution, '--configfile', 'NuGet.Config'], ['build', solution, '--no-restore', '--nologo']]) {
    const child = run('dotnet', arguments_, join(root, folder));
    await new Promise((yes, no) => { child.once('error', no); child.once('exit', code => code === 0 ? yes() : no(Error(`${folder} build failed (${code})`))); });
  }
}
async function available(port) {
  return new Promise(yes => { const server = createServer(); server.once('error', () => yes(false)); server.listen(port, '127.0.0.1', () => server.close(() => yes(true))); });
}
async function wait(url) {
  for (let i = 0; i < 60; i++) {
    if (stopping) throw Error('Startup interrupted');
    try { if ((await fetch(url, { signal: AbortSignal.timeout(1500) })).ok) return; } catch { }
    await new Promise(r => setTimeout(r, 250));
  }
  throw Error(`Service did not become ready: ${url}. Check ${relative(root, runtime)}/logs`);
}
function launch(command, arguments_, cwd, env, name) {
  const child = run(command, arguments_, cwd, env, name); children.push({ child, name });
  child.once('error', () => { console.error(`${name} could not start; check executable configuration.`); void stop(1); });
  child.once('exit', code => { if (!stopping) { console.error(`${name} exited (${code}); see local service logs.`); void stop(1); } });
  return child;
}
async function stop(code = 0) {
  if (stopping) return;
  stopping = true; clearInterval(timer);
  for (const { child } of [...children].reverse()) if (child.exitCode === null) child.kill();
  await Promise.all(children.map(({ child }) => child.exitCode !== null ? null : new Promise(r => { child.once('exit', r); setTimeout(r, 3000).unref(); })));
  let ownsRegistry = false;
  if (existsSync(manifest)) {
    try { ownsRegistry = JSON.parse(readFileSync(manifest, 'utf8')).launcherPid === process.pid; } catch { /* Preserve a registry whose owner cannot be verified. */ }
    if (ownsRegistry) unlinkSync(manifest);
  }
  if (ownsRegistry && existsSync(join(runtime, 'stop'))) unlinkSync(join(runtime, 'stop'));
  logStartup(`Stopped with exit code ${code}. Local data preserved.`);
  console.log('Betweenly MVP stopped. Local data preserved.'); process.exit(code);
}
process.on('SIGINT', () => void stop()); process.on('SIGTERM', () => void stop());
try {
  for (const port of [5080, 5101, 5102, 5103, 5104].map(p => p + offset)) if (!await available(port)) throw Error(`Port ${port} is already in use. No existing process was stopped.`);
  if (!args.has('--skip-build')) { await build('Backend', 'Backend.sln'); await build('Gateway', 'Gateway.sln'); }
  const names = ['expression-style-service', 'contact-context-service', 'advice-service', 'analysis-service'];
  const keys = Object.fromEntries(names.map(n => [n, randomBytes(24).toString('hex')]));
  const adviceKey = randomBytes(24).toString('hex'), contextKey = randomBytes(24).toString('hex');
  const gatewayUrl = `http://127.0.0.1:${5080 + offset}`;
  const gatewayEnv = { ASPNETCORE_URLS: gatewayUrl, Gateway__RequestTimeoutSeconds: '75', Gateway__ServiceCredentials__AdviceService: adviceKey, Gateway__ServiceCredentials__ContactContextService: contextKey };
  for (let i = 0; i < names.length; i++) {
    gatewayEnv[`Gateway__Services__${names[i]}__BaseUrl`] = `http://127.0.0.1:${5101 + offset + i}`;
    gatewayEnv[`Gateway__Services__${names[i]}__GatewayKey`] = keys[names[i]];
  }
  for (const [project, name, port, credential] of [['ExpressionStyleService', names[0], 5101, ''], ['ContactContextService', names[1], 5102, contextKey], ['AdviceService', names[2], 5103, adviceKey]]) {
    launch('dotnet', [join(root, 'Backend', project, 'bin/Debug/net8.0', `${project}.dll`)], join(root, 'Backend', project),
      { ASPNETCORE_URLS: `http://127.0.0.1:${port + offset}`, GATEWAY_KEY: keys[name], SERVICE_CREDENTIAL: credential, INTERNAL_GATEWAY_URL: gatewayUrl, DATA_DIRECTORY: join(runtime, 'data', name), WECHAT_ASSISTANT_PATH: config.WECHAT_ASSISTANT_PATH || (process.platform === 'win32' ? join(root,'Backend/WeChatAssistant/bin/Debug/net8.0-windows/Betweenly.WeChatAssistant.dll') : '') }, name);
  }
  launch(python, ['-u', 'server.py'], join(root, 'Backend/AnalysisService'), {
    GATEWAY_KEY: keys[names[3]], ANALYSIS_PORT: String(5104 + offset), DEEPSEEK_API_KEY: config.DEEPSEEK_API_KEY || '',
    MODEL_CREDENTIAL_DIRECTORY: join(runtime, 'data', 'model-credentials'),
    DEEPSEEK_MODEL: config.DEEPSEEK_MODEL || 'deepseek-flash', DEEPSEEK_BASE_URL: config.DEEPSEEK_BASE_URL || 'https://api.deepseek.com', BETWEENLY_TEST_PROVIDER: config.BETWEENLY_TEST_PROVIDER || '', MODEL_TIMEOUT_SECONDS: config.MODEL_TIMEOUT_SECONDS || '25',
    TYPESAFE_API_KEY: config.TYPESAFE_API_KEY || '', JEV_ENABLED: config.JEV_ENABLED || 'auto', JEV_MODEL: config.JEV_MODEL || 'jev-1.14.0', JEV_BASE_URL: config.JEV_BASE_URL || 'https://api.typesafe.ai/v1'
  }, names[3]);
  launch('dotnet', [join(root, 'Gateway/bin/Debug/net8.0/SocialAssistant.Gateway.dll'), '--urls', gatewayUrl], join(root, 'Gateway'), gatewayEnv, 'gateway');
  writeFileSync(manifest, JSON.stringify({ launcherPid: process.pid, gatewayUrl, startedAt: new Date().toISOString(), children: children.map(({ child, name }) => ({ pid: child.pid, name })) }, null, 2));
  for (const port of [5101, 5102, 5103, 5104]) await wait(`http://127.0.0.1:${port + offset}/readyz`);
  await wait(gatewayUrl + '/readyz');
  if (!args.has('--no-frontend')) {
    if (await available(3000)) {
      const vite = join(root, 'frontend/node_modules/vite/bin/vite.js'); if (!existsSync(vite)) throw Error('Run npm ci in frontend first.');
      launch(process.execPath, [vite, '--host', '127.0.0.1', '--port', '3000', '--strictPort'], join(root, 'frontend'), {}, 'frontend'); await wait('http://127.0.0.1:3000');
    } else console.log('Port 3000 is already in use; existing frontend left running.');
  }
  timer = setInterval(() => { if (existsSync(join(runtime, 'stop'))) void stop(); }, 500);
  console.log(`MVP_READY ${gatewayUrl}/api/v1`);
  console.log('Frontend: http://127.0.0.1:3000 | Stop: Ctrl+C or scripts/stop-mvp.ps1');
  logStartup(`Ready: ${gatewayUrl}/api/v1`);
} catch (error) { console.error(`Betweenly could not start: ${error.message}`); logStartup(`Startup failed: ${error.message}`); await stop(1); }
}

main().catch(error => {
  console.error(`Betweenly could not start: ${error.message}`);
  logStartup(`Startup failed: ${error.message}`);
  if (launcherFailureLog) console.error(`Startup log: ${launcherFailureLog}`);
  process.exitCode = 1;
});
