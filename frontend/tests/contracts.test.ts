import test from 'node:test';
import assert from 'node:assert/strict';
import { GatewayApi, ApiError, isUuid, listAll, validBaseUrl } from '../src/lib/api.ts';
import { DemoApi } from '../src/lib/demo.ts';
import { assertAdvice } from '../src/lib/advice.ts';
import type { Advice, AdviceInput, Contact, Envelope, Message, Transport } from '../src/lib/contracts.ts';

const settings = { mode: 'api' as const, baseUrl: 'http://127.0.0.1:5080/api/v1', devUserId: '7bc4918a-9079-4ea2-9e8e-369ad79a9f20', token: '' };
const input: AdviceInput = { entryPoint: 'BUILD_RELATIONSHIP', userGoal: 'CONTINUE_CONVERSATION', specificQuestion: null, selectedMessageIds: ['2869ab5e-6f3e-4cb4-ae48-478555bf45bb'], selectedEventIds: [], selectedPreferenceIds: [], draftText: null, ephemeralContext: null };
const contactId = '9f11f90a-f8cc-4e48-a4ab-30b14ea824df';

test('API writes use identity, version, correlation and idempotency headers without service credentials', async () => {
  const original = globalThis.fetch;
  let captured: RequestInit | undefined;
  globalThis.fetch = async (url, init) => { assert.equal(url, settings.baseUrl + '/contacts'); captured = init; return Response.json({ data: { saved: true }, meta: {}, traceId: 'test-trace' }); };
  try {
    await new GatewayApi(settings).request('/contacts', { method: 'POST', body: { label: '测试' }, version: 3, idempotencyKey: 'test-key' });
    const headers = captured!.headers as Record<string, string>;
    assert.equal(headers['X-Dev-User-Id'], settings.devUserId); assert.equal(headers['If-Match'], '3');
    assert.equal(headers['Idempotency-Key'], 'test-key'); assert.ok(isUuid(headers['X-Correlation-Id']));
    assert.equal(headers['X-Service-Key'], undefined); assert.equal(headers['X-Gateway-Key'], undefined);
    assert.equal(captured!.credentials, 'omit'); assert.equal(captured!.redirect, 'error');
    assert.equal(captured!.body, '{"label":"测试"}');
  } finally { globalThis.fetch = original; }
});
test('Bearer identity replaces development identity and service failures never become success', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    const headers = init!.headers as Record<string, string>;
    assert.equal(headers.Authorization, 'Bearer test-only-token'); assert.equal(headers['X-Dev-User-Id'], undefined);
    return Response.json({ data: null, error: { code: 'SERVICE_UNAVAILABLE', message: '业务服务未启动', details: {} }, traceId: 'failure-trace' }, { status: 503 });
  };
  try { await assert.rejects(new GatewayApi({ ...settings, token: 'test-only-token' }).request('/contacts'), error => error instanceof ApiError && error.code === 'SERVICE_UNAVAILABLE' && error.traceId === 'failure-trace' && error.status === 503); }
  finally { globalThis.fetch = original; }
});
test('204 deletes succeed without attempting to parse an empty JSON body', async () => {
  const original = globalThis.fetch; globalThis.fetch = async () => new Response(null, { status: 204 });
  try { assert.equal((await new GatewayApi(settings).request('/contacts/test', { method: 'DELETE' })).data, undefined); }
  finally { globalThis.fetch = original; }
});
test('malformed success responses are rejected', async () => {
  const original = globalThis.fetch; globalThis.fetch = async () => Response.json({ status: 'ok' });
  try { await assert.rejects(new GatewayApi(settings).request('/contacts'), error => error instanceof ApiError && error.code === 'RESPONSE_INVALID'); }
  finally { globalThis.fetch = original; }
});
test('non-object JSON responses fail safely rather than crashing the application', async () => {
  const original = globalThis.fetch;
  try {
    for (const value of [null, 'unexpected', []]) {
      globalThis.fetch = async () => Response.json(value);
      await assert.rejects(new GatewayApi(settings).request('/contacts'), error => error instanceof ApiError && error.code === 'RESPONSE_INVALID');
    }
  } finally { globalThis.fetch = original; }
});
test('opaque pagination cursors are encoded, followed and not parsed', async () => {
  const paths: string[] = [];
  const transport: Transport = { async request<T>(path: string) { paths.push(path); return (paths.length === 1 ? { data: [1], meta: { nextCursor: 'a/+=' }, traceId: 'a' } : { data: [2], meta: {}, traceId: 'b' }) as Envelope<T>; } };
  assert.deepEqual(await listAll<number>(transport, '/contacts'), [1, 2]);
  assert.deepEqual(paths, ['/contacts', '/contacts?cursor=a%2F%2B%3D']);
});
test('repeated pagination cursors cannot loop forever', async () => {
  const transport: Transport = { async request<T>() { return { data: [], meta: { nextCursor: 'repeat' }, traceId: 'test' } as Envelope<T>; } };
  await assert.rejects(listAll(transport, '/contacts'), error => error instanceof ApiError && error.code === 'RESPONSE_INVALID');
});
test('gateway URL and user UUID validation reject internal or credential-bearing addresses', () => {
  assert.equal(validBaseUrl('http://127.0.0.1:5080/api/v1'), true);
  for (const url of ['javascript:alert(1)', 'http://user:secret@localhost/api/v1', 'http://localhost/internal/v1', 'http://localhost/api/v1?token=secret']) assert.equal(validBaseUrl(url), false);
  assert.equal(isUuid(settings.devUserId), true); assert.equal(isUuid(settings.devUserId.toUpperCase()), false); assert.equal(isUuid('00000000-0000-0000-0000-000000000000'), false);
});
test('demo analysis replays the same key and rejects a changed payload with 409', async () => {
  const demo = new DemoApi(); const path = '/contacts/' + contactId + '/advice-requests';
  const first = await demo.request<Advice>(path, { method: 'POST', body: input, idempotencyKey: 'same-key' });
  const second = await demo.request<Advice>(path, { method: 'POST', body: input, idempotencyKey: 'same-key' });
  assert.equal(first.data.requestId, second.data.requestId); assert.equal(demo.advices.length, 1);
  await assert.rejects(demo.request(path, { method: 'POST', body: { ...input, draftText: '不同的草稿' }, idempotencyKey: 'same-key' }), error => error instanceof ApiError && error.status === 409);
});
test('demo cannot-advise and needs-context results never contain sendable replies', async () => {
  const demo = new DemoApi(); const path = '/contacts/' + contactId + '/advice-requests';
  const missing = await demo.request<Advice>(path, { method: 'POST', body: { ...input, selectedMessageIds: [] }, idempotencyKey: 'empty' });
  assert.equal(missing.data.status, 'NEEDS_CONTEXT'); assert.deepEqual(missing.data.replyOptions, []); assert.equal(missing.data.recommendation, null); assert.ok(missing.data.clarifyingQuestions.length);
  await demo.request('/contacts/' + contactId + '/preference-records', { method: 'POST', body: { category: 'BOUNDARY', boundaryRule: 'DO_NOT_CONTACT_AGAIN', statement: '测试边界', sourceType: 'COUNTERPART_EXPLICIT', sourceRefs: [] } });
  const blocked = await demo.request<Advice>(path, { method: 'POST', body: input, idempotencyKey: 'blocked' });
  assert.equal(blocked.data.status, 'CANNOT_ADVISE'); assert.deepEqual(blocked.data.replyOptions, []); assert.equal(blocked.data.recommendation, null);
});
test('message unknown dates stay null and stale versions fail', async () => {
  const demo = new DemoApi();
  const response = await demo.request<Message>('/contacts/' + contactId + '/messages', { method: 'POST', body: { sender: 'USER', text: '测试文本', sentAt: null, sequenceNo: null, sourceType: 'USER_SELF_REPORT', isVerbatim: true } });
  assert.equal(response.data.sentAt, null); assert.equal(response.data.sequenceNo, null);
  await assert.rejects(demo.request('/messages/' + response.data.messageId, { method: 'PATCH', version: 99, body: { text: '覆盖' } }), error => error instanceof ApiError && error.code === 'VERSION_CONFLICT');
});
test('deleting a contact removes its context and saved analyses', async () => {
  const demo = new DemoApi();
  await demo.request('/contacts/' + contactId + '/advice-requests', { method: 'POST', body: input, idempotencyKey: 'delete-example' });
  await demo.request('/contacts/' + contactId, { method: 'DELETE', version: 1 });
  assert.equal(demo.contacts.some(item => item.contactId === contactId), false); assert.equal(demo.messages.length, 0); assert.equal(demo.events.length, 0); assert.equal(demo.preferences.length, 0); assert.equal(demo.advices.length, 0);
  assert.equal((await demo.request<Contact[]>('/contacts')).data.length, 1);
});
test('only complete, compatible advice results are displayed', () => {
  const valid = new DemoApi().exampleAdvice(contactId, input);
  assert.doesNotThrow(() => assertAdvice(valid, contactId));
  for (const value of [{ ...valid, observations: null }, { ...valid, schemaVersion: '2.0' }, { ...valid, replyOptions: Array(4).fill(valid.replyOptions[0]) }, { ...valid, contactId: crypto.randomUUID() }, { ...valid, status: 'NEEDS_CONTEXT', recommendation: null, replyOptions: [], clarifyingQuestions: [] }]) {
    assert.throws(() => assertAdvice(value, contactId), error => error instanceof ApiError && error.code === 'MODEL_OUTPUT_INVALID');
  }
});

test('affinity scores are bounded, cited and never fabricated for missing context', () => {
  const base = new DemoApi().exampleAdvice(contactId, input);
  const reference = 'message:' + input.selectedMessageIds[0];
  const assessment = { score: 68, confidence: 'MEDIUM', summary: '互动较积极，仍需观察。', evidence: [{ signal: 'POSITIVE', description: '对方愿意分享近况。', evidenceRefs: [reference] }], uncertainties: ['也可能是普通朋友之间的交流。'] };
  const valid = { ...base, replyOptions: [], responseHandling: [], draftRevision: null, recommendation: { actionType: 'NO_ACTION', title: '好感度评估', reason: '按已选记录评估', evidenceRefs: [reference], actionTags: [], appliesWhen: null, alternatives: [] }, affinityAssessment: assessment };
  assert.doesNotThrow(() => assertAdvice(valid,contactId,true));
  for (const score of [-1,101,67.5,NaN,Infinity,'68',true,null]) assert.throws(()=>assertAdvice({...valid,affinityAssessment:{...assessment,score}},contactId,true));
  for (const update of [{evidence:[]},{uncertainties:[]},{evidence:[{...assessment.evidence[0],evidenceRefs:['message:unknown']}]}]) assert.throws(()=>assertAdvice({...valid,affinityAssessment:{...assessment,...update}},contactId,true));
  assert.throws(()=>assertAdvice(base,contactId,true));
  assert.throws(()=>assertAdvice({...valid,replyOptions:[{optionId:'x',text:'追问一下',style:'自然',evidenceRefs:[reference],appliesWhen:null}]},contactId,true));
  const missing = new DemoApi().exampleAdvice(contactId,{...input,userGoal:'ASSESS_AFFINITY'});
  assert.equal(missing.affinityAssessment?.score,null);
  assert.doesNotThrow(()=>assertAdvice(missing,contactId,true));
});
