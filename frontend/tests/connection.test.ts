import test from 'node:test';
import assert from 'node:assert/strict';
import { GatewayApi, ApiError, validBaseUrl } from '../src/lib/api.ts';
import { checkGatewayConnection } from '../src/lib/connection.ts';
import { defaultSettings, restoreSettings } from '../src/lib/settings.ts';

test('old demo settings migrate to Gateway settings without reviving stored credentials', () => {
  const restored = restoreSettings(JSON.stringify({ mode: 'demo', baseUrl: defaultSettings.baseUrl, devUserId: defaultSettings.devUserId, token: 'old-secret', extra: 'ignored' }));
  assert.deepEqual(restored, defaultSettings);
  for (const raw of [null, 'invalid json', 'null', '[]', '{"baseUrl":12,"devUserId":false}']) assert.deepEqual(restoreSettings(raw), defaultSettings);
});

test('desktop API uses only the fixed local application authority', () => {
  assert.equal(validBaseUrl('betweenly://app/api/v1'), true);
  for (const value of ['betweenly://other/api/v1', 'betweenly://app:99/api/v1', 'betweenly://user:secret@app/api/v1', 'betweenly://app/internal/v1', 'betweenly://app/api/v1?url=https://other.example']) assert.equal(validBaseUrl(value), false);
});

test('Gateway probe requires a usable authenticated response and recovers after failure', async () => {
  const original = globalThis.fetch; const controller = new AbortController(); const api = new GatewayApi(defaultSettings);
  try {
    globalThis.fetch = async (url, init) => {
      assert.equal(url, defaultSettings.baseUrl + '/contacts?limit=1');
      assert.equal((init!.headers as Record<string, string>)['X-Dev-User-Id'], defaultSettings.devUserId);
      assert.equal(init!.body, undefined); assert.ok(init!.signal);
      return Response.json({ data: [], meta: {}, traceId: 'probe' });
    };
    await checkGatewayConnection(api, controller.signal);
    for (const status of [401, 403, 503]) {
      globalThis.fetch = async () => Response.json({ data: null, error: { code: 'UNAVAILABLE', message: 'unavailable' }, traceId: 'probe' }, { status });
      await assert.rejects(checkGatewayConnection(api, controller.signal), error => error instanceof ApiError && error.status === status);
    }
    globalThis.fetch = async () => { throw new TypeError('Network unavailable'); };
    await assert.rejects(checkGatewayConnection(api, controller.signal), error => error instanceof ApiError && error.code === 'NETWORK_ERROR');
    globalThis.fetch = async () => Response.json({ data: {}, meta: {}, traceId: 'probe' });
    await assert.rejects(checkGatewayConnection(api, controller.signal), error => error instanceof ApiError && error.code === 'RESPONSE_INVALID');
    globalThis.fetch = async () => Response.json({ data: [], meta: {}, traceId: 'recovered' });
    await checkGatewayConnection(api, controller.signal);
  } finally { globalThis.fetch = original; }
});

test('connection probes can be cancelled when settings change or the page unmounts', async () => {
  const original = globalThis.fetch; const controller = new AbortController();
  globalThis.fetch = async (_url, init) => new Promise((_resolve, reject) => { init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason), { once: true }); });
  try {
    const pending = checkGatewayConnection(new GatewayApi(defaultSettings), controller.signal);
    controller.abort();
    await assert.rejects(pending, error => error instanceof DOMException && error.name === 'AbortError');
  } finally { globalThis.fetch = original; }
});
