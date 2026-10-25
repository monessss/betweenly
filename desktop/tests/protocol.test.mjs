import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { makeProtocolHandler, trustedUrl } from '../protocol.mjs';
import { cleanEnvironment } from '../runtime.mjs';

await mkdir(resolve('.runtime'), { recursive: true });
const fixture = await mkdtemp(resolve('.runtime/desktop-protocol-'));
const assets = join(fixture, 'assets');
await mkdir(assets);
await writeFile(join(assets, 'index.html'), '<title>Betweenly</title>');
await writeFile(join(fixture, 'private.txt'), 'fixture-private-value');
const runtime = { ready: true, token: 'desktop-test-token', gatewayUrl: 'http://127.0.0.1:32100' };
const handler = transport => makeProtocolHandler({ assets, startup: join(assets, 'index.html'), runtime, transport });

test('only the local application origin can use the desktop protocol', () => {
  assert.ok(trustedUrl('betweenly://app/api/v1/contacts'));
  for (const value of ['https://app/', 'betweenly://other/', 'betweenly://app:90/', 'betweenly://user:password@app/', 'file:///C:/secret', 'invalid']) assert.equal(trustedUrl(value), false);
});
test('bundled files have CSP and cannot access files outside the frontend', async () => {
  const serve = handler();
  const response = await serve(new Request('betweenly://app/'));
  assert.equal(response.status, 200); assert.match(await response.text(), /Betweenly/);
  assert.match(response.headers.get('Content-Security-Policy'), /script-src 'self'/);
  for (const path of ['/..%2fprivate.txt', '/%2e%2e%5cprivate.txt', '/missing.txt', '/internal/v1/analysis']) {
    const result = await serve(new Request('betweenly://app' + path));
    assert.ok([403, 404].includes(result.status)); assert.ok(!(await result.text()).includes('fixture-private-value'));
  }
});
test('API broker supplies its own identity, forwards JSON and strips spoofed identities', async () => {
  let called = false;
  const serve = handler(async (url, init) => {
    called = true; assert.equal(url, runtime.gatewayUrl + '/api/v1/me/model-credentials');
    assert.equal(init.headers.get('X-Desktop-Token'), runtime.token);
    for (const name of ['Authorization', 'X-User-Id', 'X-Dev-User-Id', 'X-Service-Key', 'X-Gateway-Key']) assert.equal(init.headers.get(name), null);
    assert.equal(init.headers.get('If-Match'), '4'); assert.equal(init.redirect, 'manual');
    assert.equal(init.body.toString(), '{"deepseekApiKey":"fake-test-key"}');
    return Response.json({ data: { deepseekConfigured: true }, meta: {}, traceId: 'test' }, { headers: { 'Set-Cookie': 'not-forwarded', 'X-Desktop-Token': 'not-forwarded' } });
  });
  const response = await serve(new Request('betweenly://app/api/v1/me/model-credentials', { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'If-Match': '4', 'X-Desktop-Token': 'spoof', 'X-User-Id': 'spoof', 'Authorization': 'Bearer spoof' }, body: '{"deepseekApiKey":"fake-test-key"}' }));
  assert.ok(called); assert.equal(response.status, 200);
  assert.equal(response.headers.get('Set-Cookie'), null); assert.equal(response.headers.get('X-Desktop-Token'), null);
});
test('untrusted origins and oversized bodies never reach the Gateway', async () => {
  const serve = handler(() => { assert.fail('must not proxy'); });
  assert.equal((await serve(new Request('betweenly://app/api/v1/contacts', { headers: { Origin: 'https://other.example' } }))).status, 403);
  assert.equal((await serve(new Request('betweenly://app/api/v1/contacts', { method: 'POST', body: 'x'.repeat(1024 * 1024 + 1) }))).status, 413);
});
test('a downstream redirect cannot move a desktop credential to another origin', async () => {
  const response = await handler(async () => new Response(null, { status: 302, headers: { Location: 'https://other.example' } }))(new Request('betweenly://app/api/v1/contacts'));
  assert.equal(response.status, 503);
});
test('provider and Electron credentials are not inherited by service processes', () => {
  const environment = cleanEnvironment({ SystemRoot: 'C:\\Windows', PATH: 'system path', DEEPSEEK_API_KEY: 'secret', TYPESAFE_API_KEY: 'secret', ELECTRON_RUN_AS_NODE: '1', NODE_OPTIONS: '--inspect', PYTHONPATH: 'untrusted' });
  assert.deepEqual(environment, { SystemRoot: 'C:\\Windows', PATH: 'system path' });
});
