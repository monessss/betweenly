// No real WeChat is opened. A fixture records each helper invocation so that
// denied requests prove they never reach server-side desktop automation.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { createServer as tcpServer } from 'node:net';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
await mkdir(join(root, '.runtime'), { recursive: true });
const directory = await mkdtemp(join(root, '.runtime/wechat-boundary-'));
const helperLog = join(directory, 'helper.log');
const backend = process.env.BETWEENLY_BACKEND_TEST_OUTPUT || join(root, '.runtime/wechat-fix/backend');
const gateway = process.env.BETWEENLY_GATEWAY_TEST_OUTPUT || join(root, '.runtime/wechat-fix/gateway');
const user = randomUUID(); const serviceKey = randomBytes(32).toString('hex'); const desktopToken = randomBytes(32).toString('hex'); const capability = randomBytes(32).toString('hex');
const processes = [];
async function port() { const server = tcpServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening'); const value = server.address().port; await new Promise(done => server.close(done)); return value; }
function start(dll, env, label) {
  const child = spawn('dotnet', [dll], { cwd: root, env: { ...process.env, ASPNETCORE_ENVIRONMENT: 'Production', DOTNET_ENVIRONMENT: 'Production', Logging__LogLevel__Default: 'Warning', ...env }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  child.logs = ''; child.label = label; child.stdout.on('data', bytes => child.logs += bytes); child.stderr.on('data', bytes => child.logs += bytes); processes.push(child); return child;
}
async function ready(url, child) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null) throw Error(child.label + ' stopped: ' + child.logs);
    try { if ((await fetch(url + '/readyz')).ok) return; } catch { }
    await delay(100);
  }
  throw Error(child.label + ' not ready');
}
const mock = createServer(async (req, res) => { for await (const _ of req) { } res.end('{}'); });
mock.listen(0, '127.0.0.1'); await once(mock, 'listening'); const mockUrl = 'http://127.0.0.1:' + mock.address().port;
try {
  const contextUrl = 'http://127.0.0.1:' + await port();
  const context = start(join(backend, 'ContactContextService.dll'), { ASPNETCORE_URLS: contextUrl, GATEWAY_KEY: serviceKey, DATA_DIRECTORY: join(directory, 'data'), WECHAT_ASSISTANT_PATH: join(root, 'Backend/tests/wechat-fixture.mjs'), WECHAT_IMPORT_TOKEN: capability, WECHAT_FIXTURE_LOG: helperLog }, 'context');
  await ready(contextUrl, context);
  async function makeGateway(desktop) {
    const url = 'http://127.0.0.1:' + await port();
    const env = { ASPNETCORE_URLS: url, Gateway__AccountAuth__Enabled: 'false', Gateway__DevelopmentAuth__Enabled: 'false', Gateway__DesktopAuth__Enabled: String(desktop), Gateway__DesktopAuth__Token: desktopToken, Gateway__DesktopAuth__UserId: user, Gateway__DesktopAuth__WeChatImportToken: capability };
    if (!desktop) { env.ASPNETCORE_ENVIRONMENT = 'Development'; env.DOTNET_ENVIRONMENT = 'Development'; env.Gateway__DevelopmentAuth__Enabled = 'true'; }
    for (const name of ['contact-context-service', 'expression-style-service', 'advice-service', 'analysis-service']) {
      env[`Gateway__Services__${name}__BaseUrl`] = name === 'contact-context-service' ? contextUrl : mockUrl;
      env[`Gateway__Services__${name}__GatewayKey`] = serviceKey;
    }
    const child = start(join(gateway, 'SocialAssistant.Gateway.dll'), env, desktop ? 'desktop-gateway' : 'web-gateway'); await ready(url, child); return url;
  }
  const web = await makeGateway(false); const desktop = await makeGateway(true);
  async function request(base, path, method = 'GET', body, expected = 200, headers = {}) {
    const response = await fetch(base + '/api/v1' + path, { method, headers: { 'Content-Type': 'application/json', ...(base === desktop ? { 'X-Desktop-Token': desktopToken } : { 'X-Dev-User-Id': user }), ...headers }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(5000) });
    const value = response.status === 204 ? null : await response.json(); assert.equal(response.status, expected, path + ': ' + JSON.stringify(value)); return value?.data;
  }
  const contact = await request(web, '/contacts', 'POST', { label: '导入测试对象', relationshipStage: 'ACQUAINTED', connectionContext: null, currentSituation: null }, 201);
  const path = '/contacts/' + contact.contactId + '/wechat-imports';
  assert.equal((await request(web, '/wechat-import/status')).available, false);
  const spoof = { 'X-Forwarded-For': '127.0.0.1', 'X-WeChat-Import-Token': capability, 'X-Desktop-Token': desktopToken };
  await request(web, path + '/preview', 'POST', { count: 50 }, 403, spoof); await request(web, path, 'POST', {}, 403, spoof);
  const directStatus = await fetch(contextUrl + '/api/v1/wechat-import/status', { headers: { 'X-Gateway-Key': serviceKey, 'X-User-Id': user } });
  assert.equal((await directStatus.json()).data.available, false);
  const direct = await fetch(contextUrl + '/api/v1' + path + '/preview', { method: 'POST', headers: { 'X-Gateway-Key': serviceKey, 'X-User-Id': user, 'Content-Type': 'application/json' }, body: JSON.stringify({ count: 50 }) });
  assert.equal(direct.status, 403);
  assert.equal(existsSync(helperLog), false, 'Web/direct requests must not execute even the helper status command');
  console.log('PASS web/loopback-proxy/spoofed headers/direct-service requests never execute the helper');

  assert.equal((await request(desktop, '/wechat-import/status')).available, true);
  for (const count of [0, 101, 1.5, '50', null]) await request(desktop, path + '/preview', 'POST', { count }, 400);
  const one = await request(desktop, path + '/preview', 'POST', { count: 1 }); assert.equal(one.messages.length, 1);
  const preview = await request(desktop, path + '/preview', 'POST', { count: 50 }); assert.equal(preview.messages.length, 4);
  const input = { previewId: preview.previewId, conversationConfirmed: true, messages: preview.messages.slice(0, 3).map(({ clientId, sender, text }) => ({ clientId, sender, text })) };
  await request(desktop, path, 'POST', { ...input, conversationConfirmed: false }, 422);
  await request(desktop, path, 'POST', { ...input, messages: [{ ...input.messages[0], clientId: randomUUID() }] }, 422);
  assert.equal((await request(desktop, path, 'POST', input, 201)).importedCount, 3);
  assert.equal((await request(desktop, path, 'POST', input, 201)).importedCount, 0);
  await request(desktop, path, 'POST', { ...input, messages: [{ ...input.messages[0], text: 'changed' }] }, 409);
  const messages = await request(desktop, '/contacts/' + contact.contactId + '/messages');
  assert.equal(messages.filter(message => message.text === '收到').length, 2);
  assert(messages.every(message => message.sourceType === 'USER_RELAY' && !message.isVerbatim && message.sentAt === null));
  const again = await request(desktop, path + '/preview', 'POST', { count: 50 }); assert.equal(again.messages[0].possibleDuplicate, true);
  assert.equal((await request(desktop, path, 'POST', { ...input, previewId: again.previewId, messages: again.messages.slice(0, 3).map(({ clientId, sender, text }) => ({ clientId, sender, text })) }, 201)).importedCount, 3);
  assert.equal((await readFile(helperLog, 'utf8')).trim().split('\n').length, 4);
  console.log('PASS authenticated desktop preview/confirmation/atomic import/idempotency/repeated messages remain functional');
} finally {
  for (const child of processes) {
    await writeFile(join(directory, child.label + '.log'), child.logs);
    if (child.exitCode === null && child.signalCode === null) { const exit = once(child, 'exit'); child.kill(); await Promise.race([exit, delay(3000)]); }
  }
  mock.closeAllConnections(); await new Promise(done => mock.close(done));
}
