import { ApiError } from './api.ts';
import type { Transport } from './contracts.ts';

export type GatewayState = 'connecting' | 'connected' | 'failed';
export const gatewayStates: Record<GatewayState, string> = { connecting: '连接中', connected: '已连接', failed: '连接失败' };

// An authenticated, bounded API read checks both connectivity and usable credentials.
export async function checkGatewayConnection(api: Transport, signal: AbortSignal): Promise<void> {
  const response = await api.request<unknown>('/contacts?limit=1', { signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]) });
  if (!Array.isArray(response.data)) throw new ApiError('Gateway 连接检查响应无效', 'RESPONSE_INVALID');
}
