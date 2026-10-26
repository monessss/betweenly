import { ApiError, isUuid } from './api.ts';
import type { Transport } from './contracts.ts';

export interface AdminUser {
  userId: string; email: string; username: string; role: 'USER' | 'ADMIN'; status: string;
  emailVerified: boolean; createdAt: string; activeSessions?: number; lastActiveSessionAt?: string | null; banExpiresAt?: string | null;
}
export interface UserPage { items: AdminUser[]; total: number; page: number; pageSize: number }
function user(value: AdminUser): AdminUser {
  if (!value || !isUuid(value.userId) || typeof value.email !== 'string' || typeof value.username !== 'string' || !['USER', 'ADMIN'].includes(value.role) || typeof value.status !== 'string' || typeof value.emailVerified !== 'boolean' || !Number.isFinite(Date.parse(value.createdAt))) throw new ApiError('用户资料响应无效', 'RESPONSE_INVALID');
  return value;
}
export async function listUsers(api: Transport, query: string, page: number, signal?: AbortSignal): Promise<UserPage> {
  const result = (await api.request<UserPage>('/admin/users?q=' + encodeURIComponent(query.trim()) + '&page=' + page, { signal })).data;
  if (!result || !Array.isArray(result.items) || result.items.length > 20 || !Number.isSafeInteger(result.total) || result.total < 0 || result.page !== page || result.pageSize !== 20) throw new ApiError('用户列表响应无效', 'RESPONSE_INVALID');
  result.items.forEach(user); return result;
}
export async function userDetail(api: Transport, id: string, signal?: AbortSignal): Promise<AdminUser> {
  if (!isUuid(id)) throw new ApiError('用户 ID 无效', 'VALIDATION_ERROR');
  const result = user((await api.request<AdminUser>('/admin/users/' + id, { signal })).data);
  if (result.userId !== id || !Number.isSafeInteger(result.activeSessions) || result.activeSessions! < 0) throw new ApiError('用户资料响应无效', 'RESPONSE_INVALID');
  return result;
}
export function newPasswordError(password: string): string {
  return password.length < 6 ? '密码至少 6 个字符' : password.length > 128 || /[\u0000-\u001f\u007f-\u009f]/.test(password) ? '密码格式无效' : '';
}
export async function resetUserPassword(api: Transport, id: string, newPassword: string): Promise<void> {
  if (!isUuid(id) || newPasswordError(newPassword)) throw new ApiError(newPasswordError(newPassword) || '用户 ID 无效', 'VALIDATION_ERROR');
  await api.request('/admin/users/' + id + '/password', { method: 'PUT', body: { newPassword } });
}
export async function banUser(api: Transport, id: string, durationMinutes: number | null): Promise<void> {
  if (!isUuid(id) || durationMinutes !== null && (!Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 525600)) throw new ApiError('用户或封禁时长无效', 'VALIDATION_ERROR');
  await api.request('/admin/users/' + id + '/ban', { method: 'PUT', body: { durationMinutes } });
}
export async function unbanUser(api: Transport, id: string): Promise<void> {
  if (!isUuid(id)) throw new ApiError('用户 ID 无效', 'VALIDATION_ERROR');
  await api.request('/admin/users/' + id + '/ban', { method: 'DELETE' });
}
export async function deleteUser(api: Transport, id: string): Promise<void> {
  if (!isUuid(id)) throw new ApiError('用户 ID 无效', 'VALIDATION_ERROR');
  await api.request('/admin/users/' + id, { method: 'DELETE' });
}
