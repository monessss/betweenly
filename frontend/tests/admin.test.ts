import test from 'node:test';
import assert from 'node:assert/strict';
import { banUser, deleteUser, listUsers, newPasswordError, resetUserPassword, unbanUser, userDetail } from '../src/lib/admin.ts';
import { ApiError } from '../src/lib/api.ts';
import type { RequestOptions, Transport } from '../src/lib/contracts.ts';

const id = '6b241530-c820-4e71-ae6e-9b3a0379e995';
const user = { userId: id, username: 'User', email: 'user@example.invalid', role: 'USER', status: 'ACTIVE', emailVerified: true, createdAt: '2026-10-26T00:00:00Z', activeSessions: 1 };
function fixture(reply: unknown, calls: { path: string; options?: RequestOptions }[] = []): Transport {
  return { async request<T>(path: string, options?: RequestOptions) { calls.push({ path, options }); return { data: reply as T, meta: {}, traceId: 'test' }; } };
}
test('admin search is encoded and user lists/details validate server identity and pagination', async () => {
  const calls: { path: string; options?: RequestOptions }[] = [];
  const page = { items: [user], total: 1, page: 1, pageSize: 20 };
  assert.deepEqual(await listUsers(fixture(page, calls), ' name&role=ADMIN ', 1), page);
  assert.equal(calls[0].path, '/admin/users?q=name%26role%3DADMIN&page=1');
  assert.deepEqual(await userDetail(fixture(user), id), user);
  await assert.rejects(userDetail(fixture({ ...user, userId: '15c85a6a-c639-45a1-9c41-bdcde743ba79' }), id), ApiError);
  await assert.rejects(listUsers(fixture({ ...page, items: [{ ...user, role: 'SUPERUSER' }] }), '', 1), ApiError);
  await assert.rejects(listUsers(fixture({ ...page, page: 2 }), '', 1), ApiError);
});
test('admin password reset keeps password bytes, uses the selected UUID and rejects invalid requests locally', async () => {
  const calls: { path: string; options?: RequestOptions }[] = [], api = fixture(undefined, calls);
  assert.equal(newPasswordError('123456'), ''); assert.equal(newPasswordError('a'.repeat(128)), '');
  for (const value of ['12345', 'a'.repeat(129), 'abc\n123']) assert.ok(newPasswordError(value));
  await resetUserPassword(api, id, ' 123456 ');
  assert.deepEqual(calls[0], { path: '/admin/users/' + id + '/password', options: { method: 'PUT', body: { newPassword: ' 123456 ' } } });
  await assert.rejects(resetUserPassword(api, '../another-user', '123456'), ApiError);
  await assert.rejects(resetUserPassword(api, id, 'short'), ApiError);
  assert.equal(calls.length, 1);
});
test('admin API permission failures are propagated without reporting a password update', async () => {
  const api: Transport = { async request() { throw new ApiError('需要管理员权限', 'FORBIDDEN', '', 403); } };
  await assert.rejects(listUsers(api, '', 1), (error: unknown) => error instanceof ApiError && error.status === 403);
  await assert.rejects(resetUserPassword(api, id, '123456'), (error: unknown) => error instanceof ApiError && error.code === 'FORBIDDEN');
});
test('ban/unban/delete use the selected user and validate duration without changing other accounts', async () => {
  const calls: { path: string; options?: RequestOptions }[] = [], api = fixture(undefined, calls);
  await banUser(api, id, 60); await banUser(api, id, null); await unbanUser(api, id); await deleteUser(api, id);
  assert.deepEqual(calls, [
    { path: '/admin/users/' + id + '/ban', options: { method: 'PUT', body: { durationMinutes: 60 } } },
    { path: '/admin/users/' + id + '/ban', options: { method: 'PUT', body: { durationMinutes: null } } },
    { path: '/admin/users/' + id + '/ban', options: { method: 'DELETE' } },
    { path: '/admin/users/' + id, options: { method: 'DELETE' } }
  ]);
  for (const duration of [0, -1, 1.5, 525601]) await assert.rejects(banUser(api, id, duration), ApiError);
  await assert.rejects(deleteUser(api, '../another-user'), ApiError);
  assert.equal(calls.length, 4);
});
