import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { DesktopRuntime } from '../runtime.mjs';

test('published desktop services authenticate locally and stop as one process tree', { skip: process.platform !== 'win32' || !existsSync('.runtime/desktop-bundle/manifest.json'), timeout: 150000 }, async t => {
  await mkdir(resolve('.runtime'), { recursive: true });
  const profile = await mkdtemp(resolve('.runtime/desktop-runtime-test-'));
  const runtime = new DesktopRuntime({ bundle: resolve('.runtime/desktop-bundle'), profile });
  t.after(() => runtime.stop());
  await runtime.start();
  const url = runtime.gatewayUrl + '/api/v1/contacts';
  for (const headers of [{}, { 'X-Dev-User-Id': '7bc4918a-9079-4ea2-9e8e-369ad79a9f20' }, { 'X-Desktop-Token': 'invalid' }]) assert.equal((await fetch(url, { headers })).status, 401);
  const response = await fetch(url, { headers: { 'X-Desktop-Token': runtime.token } });
  assert.equal(response.status, 200); assert.deepEqual((await response.json()).data, []);
  const helper = await fetch(runtime.gatewayUrl + '/api/v1/wechat-import/status', { headers: { 'X-Desktop-Token': runtime.token } });
  assert.equal(helper.status, 200, 'self-contained WeChat EXE must launch without an installed dotnet command');
  assert.equal(typeof (await helper.json()).data.available, 'boolean');
  assert.equal(runtime.pids.length, 5);
  const pids = [...runtime.pids, runtime.host.pid];
  await runtime.stop();
  for (const pid of pids) assert.throws(() => process.kill(pid, 0), error => error.code === 'ESRCH');
  const log = await readFile(join(profile, 'logs/desktop.log'), 'utf8');
  assert.ok(!log.includes(runtime.token));
});
