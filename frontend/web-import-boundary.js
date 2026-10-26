import { randomUUID } from 'node:crypto';

// Installed before the Vite proxy: even an old/unrestarted backend must not
// expose the server computer's WeChat automation to browser visitors.
export function webImportBoundary(request, response, next) {
  let path;
  try { path = decodeURIComponent(new URL(request.url || '/', 'http://localhost').pathname); }
  catch { response.statusCode = 400; response.end(); return; }
  const status = path === '/api/v1/wechat-import/status' || path === '/api/v1/wechat-import/status/';
  const imports = /^\/api\/v1\/contacts\/[^/]+\/wechat-imports(?:\/preview)?\/?$/.test(path);
  if (!status && !imports) return next();
  const message = '网页端不支持读取微信，请使用批量粘贴导入，或在自己的电脑上使用 Betweenly 桌面版。';
  response.statusCode = status && request.method === 'GET' ? 200 : 403;
  response.setHeader('Content-Type', 'application/json; charset=utf-8'); response.setHeader('Cache-Control', 'no-store');
  response.end(JSON.stringify(status && request.method === 'GET'
    ? { data: { available: false, version: null, method: 'WINDOWS_LOCAL_TEXT', message }, meta: {}, traceId: randomUUID() }
    : { data: null, error: { code: 'WECHAT_LOCAL_ONLY', message, details: {} }, traceId: randomUUID() }));
}

export const webImportBoundaryPlugin = {
  name: 'betweenly-web-import-boundary',
  configureServer(server) { server.middlewares.use(webImportBoundary); },
  configurePreviewServer(server) { server.middlewares.use(webImportBoundary); },
};
