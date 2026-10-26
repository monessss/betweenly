import type { Envelope, RequestOptions, Settings, Transport } from './contracts.ts';

export class ApiError extends Error {
  code: string;
  traceId: string;
  status: number;
  constructor(message: string, code = 'NETWORK_ERROR', traceId = '', status = 0) {
    super(message); this.name = 'ApiError'; this.code = code; this.traceId = traceId; this.status = status;
  }
}

export function isUuid(value: string) { return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value); }
export function validBaseUrl(value: string) {
  try { const url = new URL(value); return (['http:', 'https:'].includes(url.protocol) || url.protocol === 'betweenly:' && url.host === 'app') && !url.username && !url.password && url.pathname.replace(/\/$/, '') === '/api/v1' && !url.search && !url.hash; }
  catch { return false; }
}

export class GatewayApi implements Transport {
  settings: Settings;
  constructor(settings: Settings) { this.settings = settings; }
  async request<T>(path: string, options: RequestOptions = {}): Promise<Envelope<T>> {
    if (!path.startsWith('/') || path.startsWith('//') || path.includes('..')) throw new ApiError('接口路径无效', 'VALIDATION_ERROR');
    if (!validBaseUrl(this.settings.baseUrl)) throw new ApiError('请在连接设置中填写以 /api/v1 结尾的 Gateway 地址', 'VALIDATION_ERROR');
    const anonymous = options.anonymous === true;
    if (anonymous && (options.method !== 'POST' || !['/auth/registrations', '/auth/registration-codes', '/auth/password-reset-codes', '/auth/password-resets', '/auth/sessions', '/auth/tokens'].includes(path))) throw new ApiError('该接口不允许匿名请求', 'AUTH_REQUIRED');
    if (!anonymous && !this.settings.token && !isUuid(this.settings.devUserId)) throw new ApiError('本地联调需要有效的开发用户 UUID，或提供用户令牌', 'AUTH_REQUIRED');
    const headers: Record<string, string> = { 'X-Correlation-Id': crypto.randomUUID() };
    if (!anonymous) {
      if (this.settings.token) headers.Authorization = 'Bearer ' + this.settings.token;
      else headers['X-Dev-User-Id'] = this.settings.devUserId;
    }
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';
    if (options.version !== undefined) headers['If-Match'] = String(options.version);
    if (options.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey;
    let response: Response;
    try {
      response = await fetch(this.settings.baseUrl.replace(/\/$/, '') + path, {
        method: options.method ?? 'GET', headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(100000)]) : AbortSignal.timeout(100000),
        credentials: 'omit', redirect: 'error'
      });
    } catch (error) {
      if (options.signal?.aborted) throw error;
      throw new ApiError('未能连接 Gateway，请检查服务是否启动、连接地址和跨域配置。输入已保留，可稍后重试。');
    }
    if (response.status === 204) return { data: undefined as T, meta: {}, traceId: response.headers.get('X-Correlation-Id') ?? '' };
    let body;
    try { body = await response.json(); } catch { throw new ApiError('服务响应不符合 JSON 契约，请稍后重试', 'RESPONSE_INVALID', response.headers.get('X-Correlation-Id') ?? '', response.status); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ApiError('服务响应缺少必要的契约字段', 'RESPONSE_INVALID', response.headers.get('X-Correlation-Id') ?? '', response.status);
    if (!response.ok) throw new ApiError(typeof body.error?.message === 'string' ? body.error.message : '请求未能完成', typeof body.error?.code === 'string' ? body.error.code : 'INTERNAL_ERROR', typeof body.traceId === 'string' ? body.traceId : '', response.status);
    if (!('data' in body) || typeof body.traceId !== 'string' || !body.meta || typeof body.meta !== 'object' || Array.isArray(body.meta) || body.error) throw new ApiError('服务响应缺少必要的契约字段', 'RESPONSE_INVALID');
    return body as Envelope<T>;
  }
}

export async function listAll<T>(transport: Transport, path: string, signal?: AbortSignal): Promise<T[]> {
  const items: T[] = []; const seen = new Set<string>();
  let cursor: string | null | undefined;
  do {
    const page = await transport.request<T[]>(path + (cursor ? (path.includes('?') ? '&' : '?') + 'cursor=' + encodeURIComponent(cursor) : ''), { signal });
    if (!Array.isArray(page.data)) throw new ApiError('分页响应 data 应为列表', 'RESPONSE_INVALID');
    items.push(...page.data); cursor = page.meta.nextCursor;
    if (cursor !== undefined && cursor !== null && typeof cursor !== 'string') throw new ApiError('分页游标应为不透明字符串', 'RESPONSE_INVALID');
    if (cursor) { if (seen.has(cursor)) throw new ApiError('服务返回了重复分页游标', 'RESPONSE_INVALID'); seen.add(cursor); }
  } while (cursor);
  return items;
}
