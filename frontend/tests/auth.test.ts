import test from 'node:test';
import assert from 'node:assert/strict';
import { AccountClient, validateAuth, validatePasswordReset } from '../src/lib/auth.ts';
import { ApiError, GatewayApi } from '../src/lib/api.ts';

const userId = '6b241530-c820-4e71-ae6e-9b3a0379e995', sessionId = '15c85a6a-c639-45a1-9c41-bdcde743ba79';
const profile = { userId, email: 'test@example.invalid', username: '测试用户', emailVerified: false, role: 'USER' as const };
const values = { username: profile.username, email: profile.email, password: 'abc123', challengeId: sessionId, verificationCode: '123456' };
const tokens = (letter: string) => ({ accessToken: letter.repeat(43), refreshToken: letter.toUpperCase().repeat(43), tokenType: 'Bearer', expiresInSeconds: 900 });
const session = { session: { sessionId, userId, createdAt: '2026-10-26T00:00:00Z', expiresAt: '2026-11-02T00:00:00Z' }, tokens: tokens('a') };
function response(data: unknown, status = 200) { return new Response(JSON.stringify({ data, meta: {}, traceId: 'test' }), { status }); }

test('registration accepts 6–128 characters; login remains compatible with existing passwords', () => {
  assert.deepEqual(validateAuth('login', { ...values, email: 'admin', password: 'admin' }), {});
  assert.deepEqual(validateAuth('login', { ...values, email: ' ＵＳＥＲＢ ' }), {});
  assert.ok(validateAuth('login', { ...values, email: 'bad name' }).email);
  assert.deepEqual(validateAuth('register', values), {});
  assert.deepEqual(validateAuth('login', { ...values, username: '', password: 'old' }), {});
  assert.ok(validateAuth('register', { ...values, password: '12345' }).password);
  assert.ok(validateAuth('register', { ...values, password: '' }).password);
  assert.deepEqual(validateAuth('register', { ...values, password: '1234567' }), {});
  assert.deepEqual(validateAuth('register', { ...values, password: 'a'.repeat(128) }), {});
  assert.ok(validateAuth('register', { ...values, password: 'a'.repeat(129) }).password);
  assert.deepEqual(validateAuth('login', { ...values, password: 'existing-longer-password' }), {});
  assert.ok(validateAuth('register', { ...values, username: 'bad name' }).username);
  assert.ok(validateAuth('register', { ...values, email: 'bad email' }).email);
  assert.deepEqual(validateAuth('register', { ...values, username: ' ＡＢＣ ' }), {});
});

test('only anonymous auth POSTs omit identity; other endpoints cannot opt out of authentication', async t => {
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    assert.equal(headers.get('Authorization'), null); assert.equal(headers.get('X-Dev-User-Id'), null);
    return response(session, 201);
  });
  const api = new GatewayApi({ baseUrl: 'https://example.invalid/api/v1', devUserId: '', token: 'must-not-send' });
  await api.request('/auth/sessions', { method: 'POST', body: {}, anonymous: true });
  await assert.rejects(api.request('/contacts', { method: 'POST', anonymous: true }), ApiError);
});

test('registration requires a six-digit code and a server challenge; login needs neither', () => {
  for (const verificationCode of ['', '12345', '1234567', 'abcdef']) assert.ok(validateAuth('register', { ...values, verificationCode }).verificationCode);
  assert.ok(validateAuth('register', { ...values, challengeId: '' }).verificationCode);
  assert.deepEqual(validateAuth('login', { ...values, challengeId: '', verificationCode: '' }), {});
});

test('requesting registration codes is anonymous and rejects malformed or failed delivery responses', async t => {
  const receipt = { challengeId: sessionId, expiresAt: '2026-10-26T10:10:00Z', retryAfterSeconds: 60 };
  let mode = 0;
  t.mock.method(globalThis, 'fetch', async (url: unknown, init?: RequestInit) => {
    assert.ok(String(url).endsWith('/auth/registration-codes'));
    assert.equal(new Headers(init?.headers).get('Authorization'), null);
    assert.deepEqual(JSON.parse(String(init?.body)), { email: values.email });
    if (mode === 2) return new Response(JSON.stringify({ data: null, error: { code: 'EMAIL_DELIVERY_FAILED', message: '发送失败' } }), { status: 503 });
    return response(mode === 1 ? { ...receipt, retryAfterSeconds: 'bad' } : receipt, 202);
  });
  const client = new AccountClient('https://example.invalid/api/v1');
  assert.deepEqual(await client.sendRegistrationCode(' ' + values.email + ' '), receipt);
  mode = 1; await assert.rejects(client.sendRegistrationCode(values.email), (error: unknown) => error instanceof ApiError && error.code === 'RESPONSE_INVALID');
  mode = 2; await assert.rejects(client.sendRegistrationCode(values.email), (error: unknown) => error instanceof ApiError && error.code === 'EMAIL_DELIVERY_FAILED');
  assert.equal(client.userId, '');
});

test('sign-in uses the exact backend fields, then sends Bearer without the development identity', async t => {
  const sent: { path: string; body: unknown }[] = [];
  t.mock.method(globalThis, 'fetch', async (url: unknown, init?: RequestInit) => {
    const path = new URL(String(url)).pathname;
    sent.push({ path, body: init?.body ? JSON.parse(String(init.body)) : null });
    const headers = new Headers(init?.headers);
    assert.equal(headers.get('X-Dev-User-Id'), null);
    if (path.endsWith('/registrations')) { assert.equal(headers.get('Authorization'), null); return response(session, 201); }
    assert.equal(headers.get('Authorization'), 'Bearer ' + session.tokens.accessToken);
    return response(profile);
  });
  const client = new AccountClient('https://example.invalid/api/v1');
  assert.deepEqual(await client.signIn('register', { ...values, email: ' test@example.invalid ' }), profile);
  assert.deepEqual(sent[0].body, { username: values.username, email: values.email, password: values.password, deviceName: 'Betweenly Web', challengeId: values.challengeId, verificationCode: values.verificationCode });
  assert.equal(client.userId, userId);
});

test('concurrent expiry requests rotate the refresh token only once and use the flat response contract', async t => {
  let time = Date.now(), refreshes = 0;
  t.mock.method(Date, 'now', () => time);
  t.mock.method(globalThis, 'fetch', async (url: unknown, init?: RequestInit) => {
    const path = String(url);
    if (path.endsWith('/auth/sessions')) return response(session, 201);
    if (path.endsWith('/auth/account')) return response(profile);
    if (path.endsWith('/auth/tokens')) {
      refreshes++; assert.equal(JSON.parse(String(init?.body)).refreshToken, session.tokens.refreshToken);
      await new Promise(resolve => setTimeout(resolve, 10)); return response(tokens('b'));
    }
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer ' + tokens('b').accessToken);
    return response([]);
  });
  const client = new AccountClient('https://example.invalid/api/v1'); await client.signIn('login', values);
  time += 880000;
  await Promise.all([client.request('/contacts'), client.request('/contacts'), client.request('/me/expression-style')]);
  assert.equal(refreshes, 1);
});

test('ambiguous refresh failure clears the session without replaying a consumed refresh token', async t => {
  let time = Date.now(), expired = 0, refreshes = 0;
  t.mock.method(Date, 'now', () => time);
  t.mock.method(globalThis, 'fetch', async (url: unknown) => {
    if (String(url).endsWith('/auth/sessions')) return response(session, 201);
    if (String(url).endsWith('/auth/account')) return response(profile);
    refreshes++; throw new TypeError('network');
  });
  const client = new AccountClient('https://example.invalid/api/v1', () => expired++); await client.signIn('login', values); time += 880000;
  await assert.rejects(client.request('/contacts')); await assert.rejects(client.request('/contacts'));
  assert.equal(refreshes, 1); assert.equal(expired, 1); assert.equal(client.userId, '');
});

test('logout clears memory even when the server is unreachable', async t => {
  t.mock.method(globalThis, 'fetch', async (url: unknown) => {
    if (String(url).endsWith('/auth/sessions')) return response(session, 201);
    if (String(url).endsWith('/auth/account')) return response(profile);
    throw new TypeError('network');
  });
  const client = new AccountClient('https://example.invalid/api/v1'); await client.signIn('login', values);
  await assert.rejects(client.logout()); assert.equal(client.userId, '');
  await assert.rejects(client.request('/contacts'));
});

test('rejected registration never creates a session or falls back to the development identity', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    return new Response(JSON.stringify({ data: null, error: { code: 'ACCOUNT_EXISTS', message: '用户名或邮箱已被使用' }, traceId: 'test' }), { status: 409 });
  });
  const client = new AccountClient('https://example.invalid/api/v1');
  await assert.rejects(client.signIn('register', values), (error: unknown) => error instanceof ApiError && error.code === 'ACCOUNT_EXISTS');
  assert.equal(client.userId, '');
  await assert.rejects(client.request('/contacts'));
  assert.equal(calls, 1);
});

test('a profile for another user cannot complete sign-in', async t => {
  t.mock.method(globalThis, 'fetch', async (url: unknown) => String(url).endsWith('/auth/sessions') ? response(session, 201) : response({ ...profile, userId: sessionId }));
  const client = new AccountClient('https://example.invalid/api/v1');
  await assert.rejects(client.signIn('login', values), (error: unknown) => error instanceof ApiError && error.code === 'RESPONSE_INVALID');
  assert.equal(client.userId, '');
});

test('password recovery validates the existing 6–128 policy and requires an email-bound code challenge', () => {
  const reset = { email: values.email, challengeId: values.challengeId, verificationCode: values.verificationCode, newPassword: '123456' };
  assert.deepEqual(validatePasswordReset(reset), {});
  assert.deepEqual(validatePasswordReset({ ...reset, newPassword: 'a'.repeat(128) }), {});
  for (const newPassword of ['', '12345', 'a'.repeat(129), 'abc\n123']) assert.ok(validatePasswordReset({ ...reset, newPassword }).newPassword);
  assert.ok(validatePasswordReset({ ...reset, email: 'bad' }).email);
  assert.ok(validatePasswordReset({ ...reset, challengeId: '' }).verificationCode);
  assert.ok(validatePasswordReset({ ...reset, verificationCode: '12a456' }).verificationCode);
});

test('password recovery calls anonymous Gateway routes, preserves the password and does not sign in', async t => {
  const sent: { path: string; body: unknown }[] = [];
  const receipt = { challengeId: sessionId, expiresAt: '2026-10-26T10:10:00Z', retryAfterSeconds: 60 };
  const reset = { email: ' ' + values.email + ' ', challengeId: sessionId, verificationCode: '123456', newPassword: ' 123456 ' };
  t.mock.method(globalThis, 'fetch', async (url: unknown, init?: RequestInit) => {
    const path = new URL(String(url)).pathname; sent.push({ path, body: JSON.parse(String(init?.body)) });
    assert.equal(new Headers(init?.headers).get('Authorization'), null);
    assert.equal(new Headers(init?.headers).get('X-Dev-User-Id'), null);
    assert.equal(init?.credentials, 'omit');
    return path.endsWith('/password-reset-codes') ? response(receipt, 202) : new Response(null, { status: 204 });
  });
  const client = new AccountClient('https://example.invalid/api/v1');
  assert.deepEqual(await client.sendPasswordResetCode(reset.email), receipt);
  await client.resetPassword(reset);
  assert.deepEqual(sent, [{ path: '/api/v1/auth/password-reset-codes', body: { email: values.email } }, { path: '/api/v1/auth/password-resets', body: { ...reset, email: values.email } }]);
  assert.equal(client.userId, '');
});

test('failed password recovery keeps the backend error and never reports completion', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return new Response(JSON.stringify({ data: null, error: { code: 'EMAIL_CODE_INVALID', message: '验证码已失效' } }), { status: 422 }); });
  const client = new AccountClient('https://example.invalid/api/v1');
  await assert.rejects(client.resetPassword({ email: values.email, challengeId: sessionId, verificationCode: '123456', newPassword: 'abc123' }), (error: unknown) => error instanceof ApiError && error.code === 'EMAIL_CODE_INVALID');
  await assert.rejects(client.resetPassword({ email: values.email, challengeId: sessionId, verificationCode: '123456', newPassword: '12345' }));
  assert.equal(calls, 1); assert.equal(client.userId, '');
});
