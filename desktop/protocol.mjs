import { readFile } from 'node:fs/promises';
import { extname, resolve, relative, isAbsolute } from 'node:path';

export const APP_ORIGIN = 'betweenly://app';
export const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'";
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.json': 'application/json', '.txt': 'text/plain; charset=utf-8', '.woff2': 'font/woff2' };
export function trustedUrl(value) {
  try { const url = new URL(value); return url.protocol === 'betweenly:' && url.host === 'app' && !url.username && !url.password; } catch { return false; }
}
function failure(status, message) { return new Response(JSON.stringify({ data: null, error: { code: 'DESKTOP_UNAVAILABLE', message }, traceId: 'desktop' }), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } }); }

export function makeProtocolHandler({ assets, startup, runtime, transport = fetch }) {
  return async request => {
    if (!trustedUrl(request.url)) return failure(403, '不支持的桌面地址');
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/v1/')) {
      if (!runtime.ready) return failure(503, '本地服务正在启动');
      const origin = request.headers.get('Origin');
      if (origin && origin !== APP_ORIGIN) return failure(403, '请求来源无效');
      if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) return failure(405, '请求方法不支持');
      try {
        const headers = new Headers({ 'X-Desktop-Token': runtime.token });
        for (const name of ['Content-Type', 'If-Match', 'Idempotency-Key', 'X-Correlation-Id']) if (request.headers.has(name)) headers.set(name, request.headers.get(name));
        let body;
        if (request.method !== 'GET' && request.body) {
          const reader = request.body.getReader(), chunks = []; let length = 0;
          while (true) { const item = await reader.read(); if (item.done) break; length += item.value.length; if (length > 1024 * 1024) { await reader.cancel(); return failure(413, '请求过大'); } chunks.push(item.value); }
          body = Buffer.concat(chunks);
        }
        const response = await transport(runtime.gatewayUrl + url.pathname + url.search, { method: request.method, headers, body, redirect: 'manual', signal: AbortSignal.any([request.signal, AbortSignal.timeout(100000)]) });
        if (response.status >= 300 && response.status < 400) return failure(503, '本地服务返回了无效的重定向');
        const returned = new Headers({ 'Cache-Control': 'no-store' });
        for (const name of ['Content-Type', 'X-Correlation-Id', 'ETag', 'Allow', 'Retry-After']) if (response.headers.has(name)) returned.set(name, response.headers.get(name));
        return new Response(response.body, { status: response.status, headers: returned });
      } catch { return failure(503, '无法连接本地 Gateway，请重新打开 Betweenly'); }
    }
    if (request.method !== 'GET') return failure(405, '请求方法不支持');
    try {
      const pathname = decodeURIComponent(url.pathname);
      if (pathname.includes('\\') || pathname.includes('\0')) return failure(403, '文件路径无效');
      const file = pathname === '/__startup' ? startup : resolve(assets, '.' + (pathname === '/' ? '/index.html' : pathname));
      const inside = relative(assets, file);
      if (pathname !== '/__startup' && (inside.startsWith('..') || isAbsolute(inside))) return failure(403, '文件路径无效');
      return new Response(await readFile(file), { headers: { 'Content-Type': mime[extname(file)] ?? 'application/octet-stream', 'Content-Security-Policy': CSP, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-cache' } });
    } catch { return failure(404, '文件不存在'); }
  };
}
