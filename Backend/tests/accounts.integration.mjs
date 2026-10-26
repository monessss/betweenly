// Real MySQL + AuthService + UserService + Gateway. No existing database/data
// is accessed: mysqld gets a new workspace datadir and dynamically allocated port.
import assert from 'node:assert/strict';
import { smtpFixture } from './smtp-fixture.mjs';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { createServer as tcpServer } from 'node:net';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const mysqlHome = process.env.BETWEENLY_TEST_MYSQL_BIN || 'D:/IDE/mysql-8.4.4/bin';
const mysqld = join(mysqlHome, process.platform === 'win32' ? 'mysqld.exe' : 'mysqld');
const mysql = join(mysqlHome, process.platform === 'win32' ? 'mysql.exe' : 'mysql');
if (!existsSync(mysqld) || !existsSync(mysql)) throw Error('Set BETWEENLY_TEST_MYSQL_BIN to a MySQL 8.4 bin directory.');
await mkdir(join(root, '.runtime'), { recursive: true });
const directory = await mkdtemp(join(root, '.runtime/accounts-test-'));
const processes = [];
const failures = [];
let assertions = 0;
function start(executable, args, env = {}, label = 'process') {
  const child = spawn(executable, args, { cwd: root, env: { ...process.env, ...env }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  child.logs = ''; child.label = label;
  child.stdout.on('data', chunk => { child.logs += chunk; }); child.stderr.on('data', chunk => { child.logs += chunk; });
  child.on('error', error => { child.logs += error.message; });
  processes.push(child); return child;
}
async function finish(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exit = once(child, 'exit'); child.kill(); await Promise.race([exit, delay(5000)]);
}
async function run(executable, args) {
  const child = start(executable, args); const [code] = await once(child, 'exit');
  if (code !== 0) throw Error('Test setup command failed: ' + child.logs.slice(-1800));
  return child.logs.trim();
}
async function freePort(requestedPort = 0) { const server = tcpServer(); server.listen(requestedPort, '127.0.0.1'); await once(server, 'listening'); const port = server.address().port; await new Promise(done => server.close(done)); return port; }
async function freeAppPort() {
  // Windows ephemeral ports can exceed the launcher's accepted range (<65000).
  for (let attempt = 0; attempt < 30; attempt++) {
    try { return await freePort(10000 + randomBytes(2).readUInt16BE(0) % 40000); } catch { }
  }
  throw Error('No free application port');
}
async function wait(url, child) {
  for (let attempt = 0; attempt < 150; attempt++) {
    if (child?.exitCode !== null && child?.exitCode !== undefined) throw Error(child.label + ' stopped: ' + child.logs.slice(-1800));
    try { if ((await fetch(url, { signal: AbortSignal.timeout(500) })).ok) return; } catch { }
    await delay(100);
  }
  throw Error('Not ready: ' + url + '; ' + (child?.logs.slice(-1800) || ''));
}
async function check(name, action) { try { await action(); assertions++; console.log('PASS ' + name); } catch (error) { failures.push(name); console.error('FAIL ' + name + ': ' + error.message); } }
const key = () => randomBytes(32).toString('hex');
const keys = { auth: key(), user: key(), context: key(), internal: key(), advice: key(), contextInternal: key() };
const backendOutput = process.env.BETWEENLY_BACKEND_TEST_OUTPUT || join(root, '.runtime/accounts-build/backend');
const gatewayOutput = process.env.BETWEENLY_GATEWAY_TEST_OUTPUT || join(root, '.runtime/accounts-build/gateway');
const database = 'betweenly_accounts_test';
let mock;
const smtp = await smtpFixture();
const smtpEnv = { Email__SmtpHost: '127.0.0.1', Email__SmtpPort: String(smtp.port), Email__TestMode: 'true', Email__FromAddress: 'betweenly@example.invalid', Email__VerificationSecret: key() };
let databaseShutdown;
try {
  const dbPort = await freePort(); const gatewayPort = await freePort(); const authPort = await freePort(); const userPort = await freePort(); const contextPort = await freePort();
  const base = 'http://127.0.0.1:' + gatewayPort;
  const authBase = 'http://127.0.0.1:' + authPort; const userBase = 'http://127.0.0.1:' + userPort;
  const data = join(directory, 'mysql'); await mkdir(data);
  await run(mysqld, ['--no-defaults', '--initialize-insecure', '--datadir=' + data, '--console']);
  const dbProcess = start(mysqld, ['--no-defaults', '--datadir=' + data, '--port=' + dbPort, '--bind-address=127.0.0.1', '--mysqlx=OFF', '--innodb-buffer-pool-size=32M', '--console'], {}, 'mysql');
  const sqlArgs = ['--no-defaults', '--protocol=tcp', '--host=127.0.0.1', '--port=' + dbPort, '--user=root', '--batch', '--skip-column-names'];
  databaseShutdown = () => run(join(mysqlHome, process.platform === 'win32' ? 'mysqladmin.exe' : 'mysqladmin'), ['--no-defaults', '--protocol=tcp', '--host=127.0.0.1', '--port=' + dbPort, '--user=root', '--connect-timeout=3', 'shutdown']);
  let dbReady = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    try { await run(mysql, [...sqlArgs, '--execute=SELECT 1']); dbReady = true; break; } catch { await delay(150); }
  }
  assert(dbReady, 'isolated MySQL not ready: ' + dbProcess.logs.slice(-1200));
  await run(mysql, [...sqlArgs, '--execute=CREATE DATABASE ' + database + ' CHARACTER SET utf8mb4 COLLATE utf8mb4_bin']);
  const sql = query => run(mysql, [...sqlArgs, '--database=' + database, '--execute=' + query]);
  const connection = `Server=127.0.0.1;Port=${dbPort};User ID=root;Database=${database};SslMode=Disabled;ConnectionTimeout=3`;
  const environment = { ASPNETCORE_ENVIRONMENT: 'Production', DOTNET_ENVIRONMENT: 'Production', Accounts__InitializeSchema: 'true', ConnectionStrings__Accounts: connection, DOTNET_NOLOGO: '1', INTERNAL_GATEWAY_URL: base };
  function startUser() { return start('dotnet', [join(backendOutput, 'UserService.dll')], { ...environment, GATEWAY_KEY: keys.user, ASPNETCORE_URLS: userBase }, 'user-service'); }
  let userProcess = startUser();
  const authProcess = start('dotnet', [join(backendOutput, 'AuthService.dll')], { ...environment, ...smtpEnv, GATEWAY_KEY: keys.auth, SERVICE_CREDENTIAL: keys.internal, ASPNETCORE_URLS: authBase }, 'auth-service');
  const contextProcess = start('dotnet', [join(backendOutput, 'ContactContextService.dll')], { ...environment, GATEWAY_KEY: keys.context, SERVICE_CREDENTIAL: keys.contextInternal, ASPNETCORE_URLS: 'http://127.0.0.1:' + contextPort, DATA_DIRECTORY: join(directory, 'context') }, 'context-service');
  await Promise.all([wait(authBase + '/readyz', authProcess), wait(userBase + '/readyz', userProcess), wait('http://127.0.0.1:' + contextPort + '/readyz', contextProcess)]);
  mock = createServer(async (req, res) => { for await (const _ of req) { } res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ data: [], meta: {}, traceId: 'fixture' })); });
  mock.listen(0, '127.0.0.1'); await once(mock, 'listening'); const mockUrl = 'http://127.0.0.1:' + mock.address().port;
  const gatewayEnv = { ...environment, Gateway__EmailCodeRequestsPerMinute: '200', Gateway__AccountRequestsPerMinute: '500', ASPNETCORE_URLS: base, Gateway__AccountAuth__Enabled: 'true', Gateway__DevelopmentAuth__Enabled: 'false', Gateway__DesktopAuth__Enabled: 'false', Gateway__ServiceCredentials__AuthService: keys.internal, Gateway__ServiceCredentials__ContactContextService: keys.contextInternal };
  for (const [name, url, serviceKey] of [['auth-service', authBase, keys.auth], ['user-service', userBase, keys.user], ['contact-context-service', 'http://127.0.0.1:' + contextPort, keys.context], ['expression-style-service', mockUrl, key()], ['advice-service', mockUrl, keys.advice], ['analysis-service', mockUrl, key()]]) {
    gatewayEnv[`Gateway__Services__${name}__BaseUrl`] = url; gatewayEnv[`Gateway__Services__${name}__GatewayKey`] = serviceKey;
  }
  const gatewayProcess = start('dotnet', [join(gatewayOutput, 'SocialAssistant.Gateway.dll')], gatewayEnv, 'gateway');
  await wait(base + '/readyz', gatewayProcess);
  for (let setup = 0; setup < 2; setup++) {
    const seed = start('dotnet', [join(root, '.runtime/admin-db-setup/ConfigureAdministrator.dll')], { MYSQL_RUNTIME_CONNECTION_STRING: connection, MYSQL_ADMIN_CONNECTION_STRING: connection, BETWEENLY_ADMIN_PASSWORD: 'admin' }, 'admin-setup');
    const [code] = await once(seed, 'exit'); assert.equal(code, 0, seed.logs);
  }
  async function api(path, { method = 'GET', body, access, headers = {}, expected = 200 } = {}) {
    const response = await fetch(base + path, { method, headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(access ? { Authorization: 'Bearer ' + access } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(10000) });
    const raw = response.status === 204 ? '' : await response.text();
    let value = null;
    if (response.status !== 204) { try { value = JSON.parse(raw); } catch { throw Error(path + ': status=' + response.status + ', invalid JSON, bytes=' + raw.length); } }
    assert.equal(response.status, expected, path + ': ' + JSON.stringify(value));
    assert.equal(response.headers.get('cache-control'), 'no-store');
    return value;
  }
  const password = 'abc123';
  const proofs = new Map();
  const registration = (username, email, pass = password) => ({ username, email, password: pass, ...proofs.get(email.toLowerCase()) });
  async function requestCode(email, origin = base) {
    const response = await fetch(origin + '/api/v1/auth/registration-codes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({email}) });
    const envelope = await response.json(); assert.equal(response.status, 202, JSON.stringify(envelope));
    assert.equal(envelope.data.verificationCode, undefined); assert.equal(envelope.data.code, undefined);
    const code = smtp.messages.get(email.toLowerCase())?.code; assert.match(code || '', /^\d{6}$/);
    const proof = { challengeId: envelope.data.challengeId, verificationCode: code }; proofs.set(email.toLowerCase(), proof); return proof;
  }
  const login = email => api('/api/v1/auth/sessions', { method: 'POST', body: { email, password }, expected: 201 });
  let a, b;
  await check('verified registration provisions profile and session', async () => {
    await requestCode('alice@example.invalid'); await requestCode('bob@example.invalid');
    a = (await api('/api/v1/auth/registrations', { method: 'POST', body: registration('测试用户A', 'Alice@example.invalid'), expected: 201 })).data;
    b = (await api('/api/v1/auth/registrations', { method: 'POST', body: registration('UserB', 'bob@example.invalid'), expected: 201 })).data;
    assert.equal(a.tokens.tokenType, 'Bearer'); assert.notEqual(a.session.userId, b.session.userId);
    const account = (await api('/api/v1/auth/account', { access: a.tokens.accessToken })).data;
    assert.equal(account.email, 'alice@example.invalid'); assert.equal(account.emailVerified, true);
    const profile = (await api('/api/v1/users/me', { access: a.tokens.accessToken })).data;
    assert.equal(profile.username, '测试用户A'); assert.equal(profile.version, 1);
  });
  assert(a && b, 'Registration is a prerequisite for remaining tests');
  let admin;
  await check('administrator uses the ordinary login endpoint; username login and bootstrap are durable', async () => {
    admin = (await api('/api/v1/auth/sessions', { method: 'POST', body: { email: 'admin', password: 'admin' }, expected: 201 })).data;
    const account = (await api('/api/v1/auth/account', { access: admin.tokens.accessToken })).data;
    assert.equal(account.username, 'admin'); assert.equal(account.role, 'ADMIN');
    assert.equal((await api('/api/v1/auth/account', { access: a.tokens.accessToken })).data.role, 'USER');
    await api('/api/v1/auth/sessions', { method: 'POST', body: { email: 'USERB', password }, expected: 201 });
    assert.equal(await sql("SELECT COUNT(*) FROM auth_admin_audit WHERE action='BOOTSTRAP'"), '1');
    for (const username of ['admin', 'ＡＤＭＩＮ']) await api('/api/v1/auth/registrations', { method: 'POST', body: registration(username, 'reserved@example.invalid'), expected: 409 });
    await api('/api/v1/auth/sessions', { method: 'POST', body: { email: 'admin', password: 'wrong' }, expected: 401 });
  });
  assert(admin, 'Administrator login is required for admin tests');
  await check('admin endpoints reject anonymous users and ordinary users despite forged identities or roles', async () => {
    await api('/api/v1/admin/users', { expected: 401 });
    const forged = { 'X-User-Id': admin.session.userId, 'X-Role': 'ADMIN', 'X-Admin': 'true', 'X-Dev-User-Id': admin.session.userId };
    for (const path of ['/api/v1/admin/users', '/api/v1/admin/users/' + b.session.userId]) await api(path, { access: a.tokens.accessToken, headers: forged, expected: 403 });
    await api('/api/v1/admin/users/' + b.session.userId + '/password', { method: 'PUT', access: a.tokens.accessToken, headers: forged, body: { newPassword: 'hijack123' }, expected: 403 });
    const direct = await fetch(authBase + '/api/v1/admin/users', { headers: forged }); assert.equal(direct.status, 403);
    await login('bob@example.invalid');
    await sql("DELETE FROM auth_administrators WHERE user_id='" + admin.session.userId + "'");
    await api('/api/v1/admin/users', { access: admin.tokens.accessToken, headers: forged, expected: 403 });
    await sql("INSERT INTO auth_administrators(user_id,created_at) VALUES('" + admin.session.userId + "',UTC_TIMESTAMP(6))");
  });
  await check('administrator lists every account with bounded pagination, literal search and no credential data', async () => {
    for (let index = 0; index < 25; index++) {
      const suffix = String(index).padStart(3, '0');
      await sql("INSERT INTO auth_credentials(user_id,email,username,normalized_username,password_hash,status,created_at) SELECT '" + randomUUID() + "','page" + suffix + "@example.invalid','Page" + suffix + "','PAGE" + suffix + "',password_hash,'ACTIVE',UTC_TIMESTAMP(6) FROM auth_credentials WHERE email='alice@example.invalid'");
    }
    const first = (await api('/api/v1/admin/users?q=page&page=1', { access: admin.tokens.accessToken })).data;
    const second = (await api('/api/v1/admin/users?q=page&page=2', { access: admin.tokens.accessToken })).data;
    assert.equal(first.total, 25); assert.equal(first.items.length, 20); assert.equal(second.items.length, 5);
    assert.equal(new Set([...first.items, ...second.items].map(item => item.userId)).size, 25);
    const text = JSON.stringify(first); for (const field of ['password_hash', 'passwordHash', 'accessToken', 'refreshToken']) assert(!text.includes(field));
    const literal = (await api('/api/v1/admin/users?q=' + encodeURIComponent("' OR 1=1 --"), { access: admin.tokens.accessToken })).data; assert.equal(literal.total, 0);
    const detail = (await api('/api/v1/admin/users/' + b.session.userId, { access: admin.tokens.accessToken })).data;
    assert.equal(detail.username, 'UserB'); assert(Number.isInteger(detail.activeSessions)); assert.equal(detail.password, undefined);
    await api('/api/v1/admin/users?page=0', { access: admin.tokens.accessToken, expected: 400 });
    await api('/api/v1/admin/users?role=ADMIN', { access: admin.tokens.accessToken, expected: 400 });
    await api('/api/v1/admin/users/' + randomUUID(), { access: admin.tokens.accessToken, expected: 404 });
  });
  await check('admin password reset is atomic, audited, invalidates recovery proof and revokes every target session', async () => {
    const email = 'managed@example.invalid'; await requestCode(email);
    const target = (await api('/api/v1/auth/registrations', { method: 'POST', body: registration('ManagedUser', email), expected: 201 })).data;
    const another = (await login(email)).data;
    const receipt = (await api('/api/v1/auth/password-reset-codes', { method: 'POST', body: { email }, expected: 202 })).data;
    const proof = { email, challengeId: receipt.challengeId, verificationCode: smtp.messages.get(email).code, newPassword: 'stale123' };
    const path = '/api/v1/admin/users/' + target.session.userId + '/password';
    for (const newPassword of ['12345', 'a'.repeat(129)]) await api(path, { method: 'PUT', access: admin.tokens.accessToken, body: { newPassword }, expected: 400 });
    await api(path, { method: 'PUT', access: admin.tokens.accessToken, body: { newPassword: 'set123', role: 'ADMIN' }, expected: 400 });
    await api(path, { method: 'PUT', access: admin.tokens.accessToken, body: { newPassword: 'set123' }, expected: 204 });
    for (const old of [target, another]) {
      await api('/api/v1/auth/account', { access: old.tokens.accessToken, expected: 401 });
      await api('/api/v1/auth/tokens', { method: 'POST', body: { refreshToken: old.tokens.refreshToken }, expected: 401 });
    }
    await api('/api/v1/auth/password-resets', { method: 'POST', body: proof, expected: 422 });
    await api('/api/v1/auth/sessions', { method: 'POST', body: { email, password }, expected: 401 });
    const fresh = (await api('/api/v1/auth/sessions', { method: 'POST', body: { email, password: 'set123' }, expected: 201 })).data;
    assert.equal(fresh.session.userId, target.session.userId);
    const audit = await sql("SELECT actor_user_id,target_user_id,action FROM auth_admin_audit WHERE action='PASSWORD_RESET'");
    assert(audit.includes(admin.session.userId)); assert(audit.includes(target.session.userId)); assert(!audit.includes('set123'));
    const hash = await sql("SELECT password_hash FROM auth_credentials WHERE email='managed@example.invalid'"); assert(!hash.includes('set123'));
    await api('/api/v1/admin/users/' + randomUUID() + '/password', { method: 'PUT', access: admin.tokens.accessToken, body: { newPassword: 'set123' }, expected: 404 });
  });
  await check('timed/permanent bans revoke sessions, block both logins, expire automatically and support manual unban', async () => {
    const email = 'ban-user@example.invalid'; await requestCode(email);
    const target = (await api('/api/v1/auth/registrations', { method: 'POST', body: registration('BanTarget', email), expected: 201 })).data;
    const path = '/api/v1/admin/users/' + target.session.userId;
    for (const durationMinutes of [0, -1, 1.5, '60', 525601]) await api(path + '/ban', { method: 'PUT', access: admin.tokens.accessToken, body: { durationMinutes }, expected: 400 });
    await api(path + '/ban', { method: 'PUT', access: admin.tokens.accessToken, body: {}, expected: 400 });
    await api(path + '/ban', { method: 'PUT', access: admin.tokens.accessToken, body: { durationMinutes: 60 }, expected: 204 });
    let detail = (await api(path, { access: admin.tokens.accessToken })).data;
    assert.equal(detail.status, 'BANNED'); assert.equal(detail.activeSessions, 0);
    assert(Date.parse(detail.banExpiresAt) > Date.now() + 59 * 60000);
    await api('/api/v1/auth/account', { access: target.tokens.accessToken, expected: 401 });
    await api('/api/v1/auth/tokens', { method: 'POST', body: { refreshToken: target.tokens.refreshToken }, expected: 401 });
    for (const identity of [email, 'BanTarget']) {
      const response = await api('/api/v1/auth/sessions', { method: 'POST', body: { email: identity, password }, expected: 403 }); assert.equal(response.error.code, 'ACCOUNT_BANNED');
      const release = new Date(Date.parse(detail.banExpiresAt) + 8 * 3600000).toISOString().slice(0, 19).replace('T', ' ');
      assert.equal(response.error.message, '账号已被封禁，预计解封时间：' + release);
    }
    await api(path + '/password', { method: 'PUT', access: admin.tokens.accessToken, body: { newPassword: 'blocked123' }, expected: 204 });
    await api('/api/v1/auth/sessions', { method: 'POST', body: { email, password: 'blocked123' }, expected: 403 });
    await sql("UPDATE auth_user_bans SET expires_at=UTC_TIMESTAMP(6)-INTERVAL 1 SECOND WHERE user_id='" + target.session.userId + "'");
    detail = (await api(path, { access: admin.tokens.accessToken })).data; assert.equal(detail.status, 'ACTIVE');
    const fresh = (await api('/api/v1/auth/sessions', { method: 'POST', body: { email, password: 'blocked123' }, expected: 201 })).data;
    await api('/api/v1/auth/account', { access: target.tokens.accessToken, expected: 401 });
    await api(path + '/ban', { method: 'PUT', access: admin.tokens.accessToken, body: { durationMinutes: null }, expected: 204 });
    detail = (await api(path, { access: admin.tokens.accessToken })).data; assert.equal(detail.status, 'BANNED'); assert.equal(detail.banExpiresAt, null);
    const permanent = await api('/api/v1/auth/sessions', { method: 'POST', body: { email, password: 'blocked123' }, expected: 403 });
    assert.equal(permanent.error.message, '账号已被封禁，预计解封时间：永久');
    await api('/api/v1/auth/account', { access: fresh.tokens.accessToken, expected: 401 });
    await api(path + '/ban', { method: 'DELETE', access: admin.tokens.accessToken, expected: 204 });
    await api('/api/v1/auth/sessions', { method: 'POST', body: { email, password: 'blocked123' }, expected: 201 });
    assert.equal((await api(path, { access: admin.tokens.accessToken })).data.status, 'ACTIVE');
    const audit = await sql("SELECT action FROM auth_admin_audit WHERE target_user_id='" + target.session.userId + "'"); assert(audit.includes('USER_BANNED')); assert(audit.includes('USER_UNBANNED'));
  });
  await check('deleting a user hides the account, invalidates all access/recovery and preserves its audit/history', async () => {
    const email = 'delete-user@example.invalid'; await requestCode(email);
    const target = (await api('/api/v1/auth/registrations', { method: 'POST', body: registration('DeleteTarget', email), expected: 201 })).data;
    const receipt = (await api('/api/v1/auth/password-reset-codes', { method: 'POST', body: { email }, expected: 202 })).data;
    const proof = { email, challengeId: receipt.challengeId, verificationCode: smtp.messages.get(email).code, newPassword: 'revive123' };
    const path = '/api/v1/admin/users/' + target.session.userId;
    for (const [method, suffix, body] of [['PUT', '/ban', { durationMinutes: 60 }], ['DELETE', '/ban', undefined], ['DELETE', '', undefined]]) {
      await api(path + suffix, { method, body, access: a.tokens.accessToken, headers: { 'X-Role': 'ADMIN', 'X-User-Id': admin.session.userId }, expected: 403 });
      await api(path + suffix, { method, body, expected: 401 });
    }
    for (const [method, suffix, body] of [['PUT', '/ban', { durationMinutes: 60 }], ['DELETE', '', undefined]]) {
      const response = await api('/api/v1/admin/users/' + admin.session.userId + suffix, { method, body, access: admin.tokens.accessToken, expected: 422 }); assert.equal(response.error.code, 'SELF_PROTECTED');
    }
    await api(path, { method: 'DELETE', access: admin.tokens.accessToken, expected: 204 });
    assert.equal((await api('/api/v1/admin/users?q=delete-user', { access: admin.tokens.accessToken })).data.total, 0);
    await api(path, { access: admin.tokens.accessToken, expected: 404 });
    await api(path, { method: 'DELETE', access: admin.tokens.accessToken, expected: 404 });
    await api(path + '/ban', { method: 'DELETE', access: admin.tokens.accessToken, expected: 404 });
    await api(path + '/password', { method: 'PUT', access: admin.tokens.accessToken, body: { newPassword: 'revive123' }, expected: 404 });
    await api('/api/v1/auth/account', { access: target.tokens.accessToken, expected: 401 });
    await api('/api/v1/auth/tokens', { method: 'POST', body: { refreshToken: target.tokens.refreshToken }, expected: 401 });
    await api('/api/v1/auth/sessions', { method: 'POST', body: { email, password }, expected: 401 });
    await api('/api/v1/auth/password-resets', { method: 'POST', body: proof, expected: 422 });
    assert.equal(await sql("SELECT status FROM auth_credentials WHERE user_id='" + target.session.userId + "'"), 'DELETED');
    assert.equal(await sql("SELECT COUNT(*) FROM auth_admin_audit WHERE target_user_id='" + target.session.userId + "' AND action='USER_DELETED'"), '1');
  });
  await check('concurrent first sends enforce one cooldown and concurrent signups reserve only one account', async () => {
    const responses = await Promise.all([1, 2].map(() => fetch(base + '/api/v1/auth/registration-codes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'race@example.invalid' }) })));
    assert.deepEqual(responses.map(response => response.status).sort(), [202, 429]);
    const receipt = (await responses.find(response => response.status === 202).json()).data;
    const body = { username: 'Race', email: 'race@example.invalid', password, challengeId: receipt.challengeId, verificationCode: smtp.messages.get('race@example.invalid').code };
    const signups = await Promise.all([1, 2].map(() => fetch(base + '/api/v1/auth/registrations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })));
    assert(signups.some(response => response.status === 201));
    assert(signups.every(response => [201, 409, 422].includes(response.status)));
    assert.equal(await sql("SELECT COUNT(*) FROM auth_credentials WHERE email='race@example.invalid'"), '1');
    assert.equal(await sql("SELECT COUNT(*) FROM auth_email_challenges WHERE email='race@example.invalid' AND consumed_at IS NOT NULL"), '1');
  });
  await check('registration requires proof bound to the email and locks after five incorrect guesses', async () => {
    await api('/api/v1/auth/registrations', { method: 'POST', body: registration('MissingProof', 'missing@example.invalid'), expected: 400 });
    const proof = await requestCode('locked@example.invalid');
    await api('/api/v1/auth/registrations', { method: 'POST', body: { ...registration('Mismatch', 'mismatch@example.invalid'), ...proof }, expected: 422 });
    const wrong = proof.verificationCode === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) await api('/api/v1/auth/registrations', { method: 'POST', body: { ...registration('Locked', 'locked@example.invalid'), verificationCode: wrong }, expected: 422 });
    await api('/api/v1/auth/registrations', { method: 'POST', body: registration('Locked', 'locked@example.invalid'), expected: 422 });
    assert.equal(await sql("SELECT attempts FROM auth_email_challenges WHERE email='locked@example.invalid'"), '5');
  });
  await check('resending invalidates old challenges; expired codes and SMTP failures cannot register', async () => {
    const old = await requestCode('resend@example.invalid');
    const cooldown = await fetch(base + '/api/v1/auth/registration-codes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'resend@example.invalid' }) });
    assert.equal(cooldown.status, 429); assert.equal(cooldown.headers.get('retry-after'), '60');
    await sql("UPDATE auth_email_challenges SET resend_after=UTC_TIMESTAMP(6)-INTERVAL 1 SECOND WHERE email='resend@example.invalid'");
    const current = await requestCode('resend@example.invalid'); assert.notEqual(current.challengeId, old.challengeId);
    await api('/api/v1/auth/registrations', { method: 'POST', body: { ...registration('Resend', 'resend@example.invalid'), ...old }, expected: 422 });
    await sql("UPDATE auth_email_challenges SET expires_at=UTC_TIMESTAMP(6)-INTERVAL 1 SECOND WHERE email='resend@example.invalid'");
    await api('/api/v1/auth/registrations', { method: 'POST', body: registration('Resend', 'resend@example.invalid'), expected: 422 });
    smtp.reject(true);
    try { const result = await api('/api/v1/auth/registration-codes', { method: 'POST', body: { email: 'failure@example.invalid' }, expected: 503 }); assert.equal(result.error.code, 'EMAIL_DELIVERY_FAILED'); }
    finally { smtp.reject(false); }
    assert.equal(await sql("SELECT delivery_state FROM auth_email_challenges WHERE email='failure@example.invalid'"), 'FAILED');
    const stored = await sql("SELECT code_hash FROM auth_email_challenges WHERE email='resend@example.invalid'");
    assert.match(stored, /^[a-f0-9]{64}$/); assert.notEqual(stored, current.verificationCode);
  });
  await check('existing accounts can verify their own email; challenges cannot be transferred or replayed', async () => {
    await sql("DELETE FROM auth_verified_emails WHERE email='bob@example.invalid'");
    assert.equal((await api('/api/v1/auth/account', { access: b.tokens.accessToken })).data.emailVerified, false);
    await api('/api/v1/auth/email-verification-requests', { method: 'POST', body: {}, expected: 401 });
    const receipt = (await api('/api/v1/auth/email-verification-requests', { method: 'POST', access: b.tokens.accessToken, body: {}, expected: 202 })).data;
    const proof = { challengeId: receipt.challengeId, verificationCode: smtp.messages.get('bob@example.invalid').code };
    await api('/api/v1/auth/email-verifications', { method: 'POST', access: a.tokens.accessToken, body: proof, expected: 422 });
    await api('/api/v1/auth/registrations', { method: 'POST', body: { ...registration('Purpose', 'purpose@example.invalid'), ...proof }, expected: 422 });
    await api('/api/v1/auth/email-verifications', { method: 'POST', access: b.tokens.accessToken, body: proof });
    await api('/api/v1/auth/email-verifications', { method: 'POST', access: b.tokens.accessToken, body: proof, expected: 422 });
    assert.equal((await api('/api/v1/auth/account', { access: b.tokens.accessToken })).data.emailVerified, true);
  });
  await check('password recovery requires its own proof and atomically revokes every old session', async () => {
    const email = 'reset@example.invalid'; await requestCode(email);
    const old = (await api('/api/v1/auth/registrations', { method: 'POST', body: registration('ResetUser', email), expected: 201 })).data;
    const another = (await login(email)).data;
    const baseReset = { email, ...proofs.get(email), newPassword: 'new123' };
    await api('/api/v1/auth/password-resets', { method: 'POST', body: baseReset, expected: 422 });
    const receipt = (await api('/api/v1/auth/password-reset-codes', { method: 'POST', body: { email: email.toUpperCase() }, expected: 202 })).data;
    assert.equal(receipt.code, undefined); assert.equal(receipt.verificationCode, undefined);
    const body = { ...baseReset, challengeId: receipt.challengeId, verificationCode: smtp.messages.get(email).code };
    const wrong = body.verificationCode === '000000' ? '111111' : '000000';
    await api('/api/v1/auth/password-resets', { method: 'POST', body: { ...body, verificationCode: wrong }, expected: 422 });
    await api('/api/v1/auth/password-resets', { method: 'POST', body: { ...body, email: 'bob@example.invalid' }, expected: 422 });
    await api('/api/v1/auth/email-verifications', { method: 'POST', access: old.tokens.accessToken, body: { challengeId: body.challengeId, verificationCode: body.verificationCode }, expected: 422 });
    for (const newPassword of ['12345', 'a'.repeat(129)]) await api('/api/v1/auth/password-resets', { method: 'POST', body: { ...body, newPassword }, expected: 400 });
    await api('/api/v1/auth/password-resets', { method: 'POST', body: { ...body, email: email.toUpperCase() }, expected: 204 });
    for (const session of [old, another]) {
      await api('/api/v1/users/me', { access: session.tokens.accessToken, expected: 401 });
      await api('/api/v1/auth/tokens', { method: 'POST', body: { refreshToken: session.tokens.refreshToken }, expected: 401 });
    }
    await api('/api/v1/auth/password-resets', { method: 'POST', body, expected: 422 });
    await api('/api/v1/auth/sessions', { method: 'POST', body: { email, password }, expected: 401 });
    const fresh = (await api('/api/v1/auth/sessions', { method: 'POST', body: { email, password: body.newPassword }, expected: 201 })).data;
    assert.equal((await api('/api/v1/auth/account', { access: fresh.tokens.accessToken })).data.username, 'ResetUser');
    assert.equal(await sql("SELECT COUNT(*) FROM auth_email_challenges WHERE email='reset@example.invalid' AND purpose='PASSWORD_RESET' AND consumed_at IS NOT NULL"), '1');
  });
  await check('recovery treats unknown and unverified emails alike and does not send claimable codes', async () => {
    await sql("DELETE FROM auth_verified_emails WHERE email='length7@example.invalid'");
    // Use a dedicated legacy-style account without touching any real database.
    await requestCode('unverified@example.invalid');
    await api('/api/v1/auth/registrations', { method: 'POST', body: registration('Unverified', 'unverified@example.invalid'), expected: 201 });
    await sql("DELETE FROM auth_verified_emails WHERE email='unverified@example.invalid'");
    for (const email of ['unknown-reset@example.invalid', 'unverified@example.invalid']) {
      const receipt = (await api('/api/v1/auth/password-reset-codes', { method: 'POST', body: { email }, expected: 202 })).data;
      assert.deepEqual(Object.keys(receipt).sort(), ['challengeId', 'expiresAt', 'retryAfterSeconds']);
      assert.equal(await sql("SELECT delivery_state FROM auth_email_challenges WHERE email='" + email + "' AND purpose='PASSWORD_RESET'"), 'FAILED');
      const response = await fetch(base + '/api/v1/auth/password-reset-codes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) });
      assert.equal(response.status, 429); assert.equal(response.headers.get('retry-after'), '60');
      await api('/api/v1/auth/password-resets', { method: 'POST', body: { email, challengeId: receipt.challengeId, verificationCode: '123456', newPassword: 'new123' }, expected: 422 });
    }
    assert.equal(smtp.messages.has('unknown-reset@example.invalid'), false);
    await login('unverified@example.invalid');
  });
  await check('recovery codes expire, lock, invalidate on resend and cannot be consumed twice concurrently', async () => {
    const email = 'reset@example.invalid';
    async function resend() {
      await sql("UPDATE auth_email_challenges SET resend_after=UTC_TIMESTAMP(6)-INTERVAL 1 SECOND WHERE email='reset@example.invalid' AND purpose='PASSWORD_RESET'");
      const receipt = (await api('/api/v1/auth/password-reset-codes', { method: 'POST', body: { email }, expected: 202 })).data;
      return { email, challengeId: receipt.challengeId, verificationCode: smtp.messages.get(email).code, newPassword: 'final123' };
    }
    const expired = await resend();
    await sql("UPDATE auth_email_challenges SET expires_at=UTC_TIMESTAMP(6)-INTERVAL 1 SECOND WHERE email='reset@example.invalid' AND purpose='PASSWORD_RESET'");
    await api('/api/v1/auth/password-resets', { method: 'POST', body: expired, expected: 422 });
    const locked = await resend(), wrong = locked.verificationCode === '000000' ? '111111' : '000000';
    await api('/api/v1/auth/password-resets', { method: 'POST', body: expired, expected: 422 });
    for (let i = 0; i < 5; i++) await api('/api/v1/auth/password-resets', { method: 'POST', body: { ...locked, verificationCode: wrong }, expected: 422 });
    await api('/api/v1/auth/password-resets', { method: 'POST', body: locked, expected: 422 });
    const current = await resend();
    const results = await Promise.all([1, 2].map(() => fetch(base + '/api/v1/auth/password-resets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(current) })));
    assert.deepEqual(results.map(result => result.status).sort(), [204, 422]);
    await api('/api/v1/auth/sessions', { method: 'POST', body: { email, password: 'final123' }, expected: 201 });
    smtp.reject(true);
    try { await sql("UPDATE auth_email_challenges SET resend_after=UTC_TIMESTAMP(6)-INTERVAL 1 SECOND WHERE email='reset@example.invalid' AND purpose='PASSWORD_RESET'"); const failed = await api('/api/v1/auth/password-reset-codes', { method: 'POST', body: { email }, expected: 503 }); assert.equal(failed.error.code, 'EMAIL_DELIVERY_FAILED'); }
    finally { smtp.reject(false); }
  });
  await check('required fields, out-of-range passwords, unknown fields and normalized duplicates rejected', async () => {
    for (const body of [{ email: 'bad@example.invalid', password }, registration('Empty', 'empty@example.invalid', ''), registration('Short', 'short@example.invalid', '12345'), registration('Long', 'long@example.invalid', 'a'.repeat(129)), { ...registration('Role', 'role@example.invalid'), role: 'admin' }, registration('Mail', 'not-email')])
      await api('/api/v1/auth/registrations', { method: 'POST', body, expected: 400 });
    await api('/api/v1/auth/registrations', { method: 'POST', body: registration('OtherName', 'ALICE@EXAMPLE.INVALID'), expected: 409 });
    await requestCode('other@example.invalid');
    await api('/api/v1/auth/registrations', { method: 'POST', body: registration('userb', 'other@example.invalid'), expected: 409 });
  });
  await check('passwords longer than six characters register and log in successfully', async () => {
    for (const length of [7, 128]) {
      const email = 'length' + length + '@example.invalid', longerPassword = 'a'.repeat(length);
      await requestCode(email);
      await api('/api/v1/auth/registrations', { method: 'POST', body: registration('Length' + length, email, longerPassword), expected: 201 });
      await api('/api/v1/auth/sessions', { method: 'POST', body: { email, password: longerPassword }, expected: 201 });
    }
  });
  await check('login is email and password; invalid identity headers cannot bypass authentication', async () => {
    await login('ALICE@EXAMPLE.INVALID');
    for (const email of ['alice@example.invalid', 'unknown@example.invalid']) await api('/api/v1/auth/sessions', { method: 'POST', body: { email, password: 'wrong password' }, expected: 401 });
    await api('/api/v1/users/me', { headers: { 'X-Dev-User-Id': a.session.userId, 'X-User-Id': a.session.userId }, expected: 401 });
    await api('/api/v1/users/me', { headers: { Authorization: 'Basic abc', 'X-Dev-User-Id': a.session.userId }, expected: 401 });
    const profile = (await api('/api/v1/users/me', { access: a.tokens.accessToken, headers: { 'X-User-Id': b.session.userId, 'X-Caller-Service': 'AuthService', 'X-Session-Id': b.session.sessionId } })).data;
    assert.equal(profile.userId, a.session.userId);
  });
  await check('profile updates enforce field allowlist and optimistic concurrency', async () => {
    const profile = (await api('/api/v1/users/me', { method: 'PATCH', access: a.tokens.accessToken, headers: { 'If-Match': '"1"' }, body: { displayName: 'New name' } })).data;
    assert.equal(profile.version, 2); assert.equal(profile.username, '测试用户A');
    await api('/api/v1/users/me', { method: 'PATCH', access: a.tokens.accessToken, headers: { 'If-Match': '1' }, body: { bio: 'stale' }, expected: 409 });
    await api('/api/v1/users/me', { method: 'PATCH', access: a.tokens.accessToken, headers: { 'If-Match': '2' }, body: { userId: b.session.userId }, expected: 400 });
  });
  await check('existing business endpoints receive verified ownership and isolate users', async () => {
    const contact = (await api('/api/v1/contacts', { method: 'POST', access: a.tokens.accessToken, body: { label: 'Only A', relationshipStage: 'JUST_CONNECTED', connectionContext: null, currentSituation: null }, expected: 201 })).data;
    await api('/api/v1/contacts/' + contact.contactId, { access: b.tokens.accessToken, expected: 404 });
    assert.equal((await api('/api/v1/contacts', { access: b.tokens.accessToken })).data.length, 0);
    assert.equal((await api('/api/v1/contacts', { access: a.tokens.accessToken })).data.length, 1);
  });
  await check('session ownership, rotation and refresh replay revocation', async () => {
    await api('/api/v1/auth/sessions/' + b.session.sessionId, { method: 'DELETE', access: a.tokens.accessToken, expected: 404 });
    const tokens = (await api('/api/v1/auth/tokens', { method: 'POST', body: { refreshToken: b.tokens.refreshToken } })).data;
    await api('/api/v1/users/me', { access: b.tokens.accessToken, expected: 401 });
    await api('/api/v1/users/me', { access: tokens.accessToken });
    await api('/api/v1/auth/tokens', { method: 'POST', body: { refreshToken: b.tokens.refreshToken }, expected: 401 });
    await api('/api/v1/users/me', { access: tokens.accessToken, expected: 401 });
    const raw = JSON.stringify((await api('/api/v1/auth/sessions', { access: a.tokens.accessToken })).data);
    assert(!raw.includes('accessToken')); assert(!raw.includes('refreshToken')); assert(!raw.includes('hash'));
  });
  await check('concurrent refresh consumes one token once and revokes a replayed session', async () => {
    const session = (await login('bob@example.invalid')).data;
    const responses = await Promise.all([1, 2].map(() => fetch(base + '/api/v1/auth/tokens', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refreshToken: session.tokens.refreshToken }), signal: AbortSignal.timeout(10000) })));
    assert.deepEqual(responses.map(response => response.status).sort(), [200, 401]);
    const success = await responses.find(response => response.status === 200).json();
    await api('/api/v1/users/me', { access: success.data.accessToken, expected: 401 });
  });
  await check('logout revokes access immediately and does not trust a spoofed session header', async () => {
    const session = (await login('bob@example.invalid')).data;
    await api('/api/v1/auth/logout', { method: 'POST', access: session.tokens.accessToken, headers: { 'X-Session-Id': a.session.sessionId }, expected: 204 });
    await api('/api/v1/users/me', { access: session.tokens.accessToken, expected: 401 });
    await api('/api/v1/users/me', { access: a.tokens.accessToken });
  });
  await check('password change verifies current password and revokes every session', async () => {
    for (const newPassword of ['', '12345', 'a'.repeat(129)]) await api('/api/v1/auth/password', { method: 'PUT', access: a.tokens.accessToken, body: { currentPassword: password, newPassword }, expected: 400 });
    await api('/api/v1/auth/password', { method: 'PUT', access: a.tokens.accessToken, body: { currentPassword: 'wrong', newPassword: 'xyz7890' }, expected: 401 });
    await api('/api/v1/auth/password', { method: 'PUT', access: a.tokens.accessToken, body: { currentPassword: password, newPassword: 'xyz7890' }, expected: 204 });
    await api('/api/v1/users/me', { access: a.tokens.accessToken, expected: 401 });
    await api('/api/v1/auth/sessions', { method: 'POST', body: { email: 'alice@example.invalid', password }, expected: 401 });
    await api('/api/v1/auth/sessions', { method: 'POST', body: { email: 'alice@example.invalid', password: 'xyz7890' }, expected: 201 });
  });
  await check('registration interruption remains recoverable without orphaning active credentials', async () => {
    await requestCode('recover@example.invalid');
    await finish(userProcess);
    await api('/api/v1/auth/registrations', { method: 'POST', body: registration('Recover', 'recover@example.invalid'), expected: 503 });
    assert.equal(await sql("SELECT status FROM auth_credentials WHERE email='recover@example.invalid'"), 'PROVISIONING');
    userProcess = startUser(); await wait(userBase + '/readyz', userProcess);
    const repaired = (await login('recover@example.invalid')).data;
    assert.equal((await api('/api/v1/users/me', { access: repaired.tokens.accessToken })).data.username, 'Recover');
    assert.equal(await sql("SELECT status FROM auth_credentials WHERE email='recover@example.invalid'"), 'ACTIVE');
  });
  await check('database stores password/token hashes and survives service restarts', async () => {
    const stored = await sql('SELECT password_hash FROM auth_credentials');
    assert(!stored.includes(password)); assert(stored.includes('AQAAAA'));
    const hashes = await sql('SELECT access_hash,refresh_hash FROM auth_sessions');
    assert(!hashes.includes(a.tokens.accessToken)); assert(!hashes.includes(a.tokens.refreshToken));
    const fresh = (await login('bob@example.invalid')).data;
    await finish(userProcess); userProcess = startUser(); await wait(userBase + '/readyz', userProcess);
    await api('/api/v1/users/me', { access: fresh.tokens.accessToken });
  });
  await check('internal endpoints and downstream services reject direct identity spoofing', async () => {
    await api('/internal/v1/users', { method: 'POST', body: { userId: a.session.userId, username: 'spoof' }, headers: { 'X-User-Id': a.session.userId }, expected: 403 });
    await api('/internal/v1/auth/introspections', { method: 'POST', body: { token: a.tokens.accessToken }, expected: 404 });
    for (const url of [authBase + '/internal/v1/auth/introspections', userBase + '/api/v1/users/me']) {
      const response = await fetch(url, { headers: { 'X-User-Id': a.session.userId } }); assert.equal(response.status, 403);
    }
  });
  await check('administrator can change its own password; rerunning bootstrap never restores the initial password', async () => {
    await api('/api/v1/admin/users/' + admin.session.userId + '/password', { method: 'PUT', access: admin.tokens.accessToken, body: { newPassword: 'admin-updated' }, expected: 204 });
    await api('/api/v1/auth/account', { access: admin.tokens.accessToken, expected: 401 });
    const seed = start('dotnet', [join(root, '.runtime/admin-db-setup/ConfigureAdministrator.dll')], { MYSQL_RUNTIME_CONNECTION_STRING: connection, MYSQL_ADMIN_CONNECTION_STRING: connection, BETWEENLY_ADMIN_PASSWORD: 'admin' }, 'admin-setup');
    const [code] = await once(seed, 'exit'); assert.equal(code, 0, seed.logs);
    await api('/api/v1/auth/sessions', { method: 'POST', body: { email: 'admin', password: 'admin' }, expected: 401 });
    const fresh = (await api('/api/v1/auth/sessions', { method: 'POST', body: { email: 'ADMIN', password: 'admin-updated' }, expected: 201 })).data;
    assert.equal((await api('/api/v1/auth/account', { access: fresh.tokens.accessToken })).data.role, 'ADMIN');
  });
  await check('authentication outage fails closed with 503 rather than a false 401 or dev identity', async () => {
    const session = (await login('bob@example.invalid')).data;
    await finish(authProcess);
    await api('/api/v1/users/me', { access: session.tokens.accessToken, headers: { 'X-Dev-User-Id': a.session.userId }, expected: 503 });
  });
  await check('backend-only launcher starts all services with account auth and stops cleanly', async () => {
    let first;
    for (let attempt = 0; attempt < 30; attempt++) {
      const candidate = await freeAppPort();
      const reservations = [];
      try {
        for (let index = 0; index < 6; index++) { const server = tcpServer(); reservations.push(server); server.listen(candidate + index, '127.0.0.1'); await once(server, 'listening'); }
        first = candidate;
      } catch { } finally { for (const server of reservations) if (server.listening) await new Promise(done => server.close(done)); }
      if (first) break;
    }
    assert(first, 'No free service port range');
    let launchPort = await freeAppPort(); while (launchPort >= first && launchPort <= first + 5) launchPort = await freeAppPort();
    const launchRuntime = join(directory, 'launcher');
    const launcher = start(process.execPath, ['scripts/accounts.mjs', '--skip-build'], { MYSQL_CONNECTION_STRING: connection, ACCOUNTS_INITIALIZE_SCHEMA: 'true', BETWEENLY_WEB_SERVICE_PORT: String(first), BETWEENLY_WEB_GATEWAY_PORT: String(launchPort), BETWEENLY_WEB_RUNTIME: launchRuntime, BETWEENLY_ACCOUNTS_BUILD: dirname(backendOutput), EMAIL_SMTP_HOST: '127.0.0.1', EMAIL_SMTP_PORT: String(smtp.port), EMAIL_TEST_MODE: 'true', EMAIL_USERNAME: '', EMAIL_PASSWORD: '', EMAIL_FROM_ADDRESS: 'betweenly@example.invalid', EMAIL_VERIFICATION_SECRET: smtpEnv.Email__VerificationSecret }, 'launcher');
    try {
      await wait('http://127.0.0.1:' + launchPort + '/readyz', launcher);
      await requestCode('launcher@example.invalid', 'http://127.0.0.1:' + launchPort);
      const registered = await fetch('http://127.0.0.1:' + launchPort + '/api/v1/auth/registrations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(registration('Launcher', 'launcher@example.invalid')) });
      assert.equal(registered.status, 201);
      const manifest = JSON.parse(await readFile(join(launchRuntime, 'run.json'), 'utf8'));
      assert.equal(manifest.children.length, 7);
      const duplicate = start(process.execPath, ['scripts/accounts.mjs', '--skip-build'], { MYSQL_CONNECTION_STRING: connection, ACCOUNTS_INITIALIZE_SCHEMA: 'true', BETWEENLY_WEB_SERVICE_PORT: String(first), BETWEENLY_WEB_GATEWAY_PORT: String(launchPort), BETWEENLY_WEB_RUNTIME: launchRuntime }, 'duplicate-launcher');
      const [duplicateCode] = await once(duplicate, 'exit'); assert.notEqual(duplicateCode, 0);
      assert.equal(JSON.parse(await readFile(join(launchRuntime, 'run.json'), 'utf8')).launcherPid, launcher.pid);
      assert((await fetch('http://127.0.0.1:' + launchPort + '/readyz')).ok);
    } finally {
      await mkdir(launchRuntime, { recursive: true }); await writeFile(join(launchRuntime, 'stop'), 'stop');
      await Promise.race([once(launcher, 'exit'), delay(10000)]);
    }
    assert.equal(launcher.exitCode, 0, launcher.logs.slice(-1200));
  });
  await writeFile(join(directory, 'result.json'), JSON.stringify({ assertions, failures }, null, 2));
} finally {
  await smtp.close();
  for (const child of processes.filter(child => ['auth-service', 'user-service', 'context-service', 'gateway', 'mysql'].includes(child.label))) await writeFile(join(directory, child.label + '.log'), child.logs);
  if (databaseShutdown) { try { await databaseShutdown(); } catch { } }
  for (const child of [...processes].reverse()) await finish(child);
  if (mock) { mock.closeAllConnections(); await new Promise(done => mock.close(done)); }
}
console.log(`Accounts integration: ${assertions} passed, ${failures.length} failed. Isolated test data: ${directory}`);
process.exitCode = failures.length ? 1 : 0;
