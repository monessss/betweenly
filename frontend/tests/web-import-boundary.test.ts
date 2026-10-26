import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { webImportBoundary } from '../web-import-boundary.js';

test('web proxy never forwards WeChat automation, even with loopback spoofing or encoded paths', async () => {
  let forwarded = 0;
  const server = createServer((request, response) => webImportBoundary(request, response, () => { forwarded++; response.end('forwarded'); }));
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = 'http://127.0.0.1:' + (server.address() as { port: number }).port;
  try {
    const status = await fetch(base + '/api/v1/wechat-import/status'); assert.equal(status.status, 200); assert.equal((await status.json()).data.available, false);
    for (const path of ['/api/v1/contacts/test/wechat-imports/preview', '/api/v1/contacts/test/wechat-imports', '/api/v1/contacts/test/%77echat-imports/preview']) {
      const response = await fetch(base + path, { method: 'POST', headers: { 'X-Forwarded-For': '127.0.0.1', 'X-WeChat-Import-Token': 'spoofed' } });
      assert.equal(response.status, 403); assert.equal((await response.json()).error.code, 'WECHAT_LOCAL_ONLY');
    }
    assert.equal(forwarded, 0);
    assert.equal(await (await fetch(base + '/api/v1/contacts/test/text-imports', { method: 'POST' })).text(), 'forwarded');
    assert.equal(forwarded, 1);
  } finally { server.closeAllConnections(); await new Promise<void>(done => server.close(() => done())); }
});
