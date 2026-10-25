import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { assertAdvice } from '../frontend/src/lib/advice.ts';
const base = process.env.BETWEENLY_API_URL || 'http://127.0.0.1:5080/api/v1';
const user = randomUUID();
async function call(path, method = 'GET', body, headers = {}) {
  const response = await fetch(base + path, { method, headers: { 'X-Dev-User-Id': user, 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(100000) });
  const value = response.status === 204 ? null : await response.json();
  assert.ok(response.ok, `${method} ${path}: ${response.status} ${value?.error?.code}: ${value?.error?.message}`);
  return value?.data;
}
try {
  const contact = await call('/contacts', 'POST', { label: '端到端测试联系人', relationshipStage: 'ACQUAINTED', connectionContext: '测试数据：同事', currentSituation: null });
  const message = await call(`/contacts/${contact.contactId}/messages`, 'POST', { sender: 'OTHER', text: '今天汇报不太顺，有点难受。', sentAt: null, sequenceNo: null, sourceType: 'COUNTERPART_EXPLICIT', isVerbatim: true });
  const input = { entryPoint: 'BUILD_RELATIONSHIP', userGoal: 'CONTINUE_CONVERSATION', specificQuestion: '我该怎么接？简短自然，不说教。', selectedMessageIds: [message.messageId], selectedEventIds: [], selectedPreferenceIds: [], draftText: null, ephemeralContext: null };
  const key = randomUUID(); const path = `/contacts/${contact.contactId}/advice-requests`;
  const result = await call(path, 'POST', input, { 'Idempotency-Key': key });
  assertAdvice(result, contact.contactId);
  assert.equal(result.status, 'OK'); assert.match(result.engineVersion, /^deepseek:/); assert.ok(result.contextUsedRefs.includes('message:' + message.messageId));
  const replay = await call(path, 'POST', input, { 'Idempotency-Key': key }); assert.equal(replay.requestId, result.requestId);
  const feedback = await call(`/advice-requests/${result.requestId}/feedback`, 'POST', { selectedOptionId: result.replyOptions[0]?.optionId ?? null, editedText: null, flags: [], comment: '端到端测试' }); assert.equal(feedback.requestId, result.requestId);
  const outcome = await call(`/advice-requests/${result.requestId}/outcomes`, 'POST', { eventType: 'USER_ACTION', whatHappened: '测试：听对方说完。', occurredAt: null, sourceType: 'USER_SELF_REPORT', userReflection: null, relatedAdviceId: null }); assert.equal(outcome.relatedAdviceId, result.requestId);
  console.log(JSON.stringify({ realDeepSeek: true, status: result.status, engineVersion: result.engineVersion, title: result.recommendation.title, saved: true, idempotentReplay: true, feedback: true, outcome: true }));
} finally {
  await call('/me/context-data', 'DELETE');
}
