import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, appendFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

export const LOCAL_USER = '7bc4918a-9079-4ea2-9e8e-369ad79a9f20';
const names = ['expression-style-service', 'contact-context-service', 'advice-service', 'analysis-service'];

export function cleanEnvironment(source = process.env) {
  const allowed = new Set(['SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'PATH', 'COMSPEC', 'OS', 'HOMEDRIVE', 'HOMEPATH', 'PROGRAMDATA', 'PROGRAMFILES', 'PROGRAMFILES(X86)', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY', 'SSL_CERT_FILE', 'SSL_CERT_DIR']);
  return Object.fromEntries(Object.entries(source).filter(([key, value]) => allowed.has(key.toUpperCase()) && typeof value === 'string'));
}

async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

export class DesktopRuntime extends EventEmitter {
  constructor({ bundle, profile, provider = {} }) {
    super(); this.bundle = bundle; this.profile = profile; this.provider = provider;
    this.controller = new AbortController(); this.stopping = false; this.ready = false; this.pids = [];
    this.logDirectory = join(profile, 'logs');
    mkdirSync(this.logDirectory, { recursive: true });
  }
  log(message) { appendFileSync(join(this.logDirectory, 'desktop.log'), `${new Date().toISOString()} ${message}\n`); }
  async start() {
    const ports = new Set(); while (ports.size < 5) ports.add(await freePort());
    const [gatewayPort, ...servicePorts] = [...ports];
    this.gatewayUrl = `http://127.0.0.1:${gatewayPort}`;
    this.token = randomBytes(32).toString('hex');
    const serviceKeys = names.map(() => randomBytes(24).toString('hex'));
    const adviceKey = randomBytes(24).toString('hex'), contextKey = randomBytes(24).toString('hex');
    const environment = { ...cleanEnvironment(), DOTNET_ENVIRONMENT: 'Production', ASPNETCORE_ENVIRONMENT: 'Production', DOTNET_NOLOGO: '1', DOTNET_CLI_TELEMETRY_OPTOUT: '1' };
    const python = join(this.bundle, 'python', 'python.exe');
    const services = [];
    for (const [index, project] of ['ExpressionStyleService', 'ContactContextService', 'AdviceService'].entries()) {
      const cwd = join(this.bundle, 'services', project);
      services.push({ name: names[index], executable: join(cwd, project + '.exe'), arguments: [], cwd, environment: {
        ...environment, ASPNETCORE_URLS: `http://127.0.0.1:${servicePorts[index]}`, GATEWAY_KEY: serviceKeys[index],
        SERVICE_CREDENTIAL: index === 1 ? contextKey : index === 2 ? adviceKey : '', INTERNAL_GATEWAY_URL: this.gatewayUrl,
        DATA_DIRECTORY: join(this.profile, 'data', names[index]), WECHAT_ASSISTANT_PATH: join(this.bundle, 'services', 'WeChatAssistant', 'Betweenly.WeChatAssistant.exe')
      } });
    }
    services.push({ name: names[3], executable: python, arguments: ['-u', join(this.bundle, 'analysis', 'server.py')], cwd: join(this.bundle, 'analysis'), environment: {
      ...environment, PYTHONDONTWRITEBYTECODE: '1', GATEWAY_KEY: serviceKeys[3], ANALYSIS_PORT: String(servicePorts[3]), MODEL_CREDENTIAL_DIRECTORY: join(this.profile, 'data', 'model-credentials'),
      DEEPSEEK_API_KEY: '', DEEPSEEK_MODEL: 'deepseek-flash', DEEPSEEK_BASE_URL: 'https://api.deepseek.com', TYPESAFE_API_KEY: '', JEV_ENABLED: 'auto', JEV_MODEL: 'jev-1.14.0', JEV_BASE_URL: 'https://api.typesafe.ai/v1', ...this.provider
    } });
    const gatewayEnvironment = {
      ...environment, Gateway__RequestTimeoutSeconds: '75', Gateway__DevelopmentAuth__Enabled: 'false',
      Gateway__DesktopAuth__Enabled: 'true', Gateway__DesktopAuth__Token: this.token, Gateway__DesktopAuth__UserId: LOCAL_USER,
      Gateway__ServiceCredentials__AdviceService: adviceKey, Gateway__ServiceCredentials__ContactContextService: contextKey
    };
    for (let index = 0; index < names.length; index++) {
      gatewayEnvironment[`Gateway__Services__${names[index]}__BaseUrl`] = `http://127.0.0.1:${servicePorts[index]}`;
      gatewayEnvironment[`Gateway__Services__${names[index]}__GatewayKey`] = serviceKeys[index];
    }
    const gatewayCwd = join(this.bundle, 'services', 'Gateway');
    services.push({ name: 'gateway', executable: join(gatewayCwd, 'SocialAssistant.Gateway.exe'), arguments: ['--urls', this.gatewayUrl], cwd: gatewayCwd, environment: gatewayEnvironment });
    for (const file of [python, join(this.bundle, 'runtime-host.py'), ...services.map(item => item.executable)]) {
      if (!existsSync(file)) throw new Error('桌面运行文件不完整，请重新构建或安装 Betweenly。');
    }
    this.host = spawn(python, ['-u', join(this.bundle, 'runtime-host.py')], { cwd: this.bundle, env: cleanEnvironment(), windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '';
    this.host.stdout.on('data', chunk => {
      output += chunk;
      let newline;
      while ((newline = output.indexOf('\n')) >= 0) {
        const line = output.slice(0, newline); output = output.slice(newline + 1);
        try { const item = JSON.parse(line); if (item.state === 'started') this.pids = item.pids; if (item.state === 'spawned') this.pids.push(item.pid); this.log('Runtime: ' + item.state + (item.service ? ' ' + item.service : '') + (item.kind ? ` (${item.kind}, code=${item.systemCode})` : '')); } catch { this.log('Runtime returned an invalid status.'); }
      }
    });
    this.host.stderr.on('data', () => this.log('Runtime host reported an error.'));
    this.host.once('error', () => { this.hostFailed = true; this.log('Could not launch runtime host.'); });
    this.host.once('exit', code => { this.hostFailed = true; this.log('Runtime stopped: ' + code); if (this.ready && !this.stopping) this.emit('failure', new Error('本地服务已停止，请重新打开 Betweenly。')); });
    this.host.stdin.on('error', () => { this.hostFailed = true; });
    this.host.stdin.write(JSON.stringify({ services, logDirectory: this.logDirectory }) + '\n');
    try {
      await Promise.all([...servicePorts.map(port => `http://127.0.0.1:${port}/readyz`), this.gatewayUrl + '/readyz'].map(url => this.waitReady(url)));
      this.ready = true; this.log('All local services ready.');
    } catch (error) { await this.stop(); throw error; }
    return this;
  }
  async waitReady(url) {
    for (let attempt = 0; attempt < 450; attempt++) {
      if (this.stopping || this.hostFailed) throw new Error('本地服务未能启动，请查看用户数据目录中的 logs。');
      try { if ((await fetch(url, { signal: AbortSignal.any([this.controller.signal, AbortSignal.timeout(1200)]), redirect: 'error' })).ok) return; } catch { /* Allow services to finish initializing. */ }
      await delay(200, undefined, { signal: this.controller.signal });
    }
    throw new Error('本地服务启动超时，请查看用户数据目录中的 logs。');
  }
  async stop() {
    if (this.stopPromise) return this.stopPromise;
    this.stopping = true; this.controller.abort();
    this.ready = false;
    this.stopPromise = (async () => {
      if (!this.host || this.host.exitCode !== null) return;
      this.host.stdin.end();
      const exited = new Promise(resolve => this.host.once('exit', resolve));
      await Promise.race([exited, delay(5000, undefined, { ref: false })]);
      if (this.host.exitCode === null) { this.host.kill(); await Promise.race([exited, delay(2000, undefined, { ref: false })]); }
      this.log('Desktop services cleaned up.');
    })();
    return this.stopPromise;
  }
}
