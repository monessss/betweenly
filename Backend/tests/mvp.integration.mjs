import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
mkdirSync(join(root, '.runtime'), { recursive: true });
const runtime = mkdtempSync(join(root, '.runtime/test-mvp-'));
const base = 'http://127.0.0.1:6080/api/v1';
const user = randomUUID(), otherUser = randomUUID();
let calls = 0, reviewCalls = 0, latestInput, invalidations = 0, visionCalls = 0;
const photo = { dataUrl: 'data:image/jpeg;base64,' + readFileSync(join(root, 'Backend/tests/fixtures/photo.jpg')).toString('base64'), width: 32, height: 24 };
let launcher, ready, providerFailure = false;
const savedKeys = {
  CREDENTIAL_A: { deepseek: 'saved-fixture-deepseek-a', jev: 'saved-fixture-jev-a' },
  CREDENTIAL_B: { deepseek: 'saved-fixture-deepseek-b' },
  CREDENTIAL_A_UPDATED: { deepseek: 'saved-fixture-deepseek-updated', jev: 'saved-fixture-jev-a' },
};
const provider = createServer(async (req, res) => {
  let body = ''; for await (const chunk of req) body += chunk;
  const request = JSON.parse(body);
  if (Array.isArray(request.messages[1].content)) {
    assert.equal(req.headers.authorization, 'Bearer test-only-key');
    const blocks = request.messages[1].content; visionCalls++;
    const images = [];
    for (let i = 0; i < blocks.length; i += 2) {
      const item = JSON.parse(blocks[i].text);
      assert.equal(blocks[i + 1].type, 'image_url'); assert.equal(blocks[i + 1].image_url.url, photo.dataUrl);
      images.push({ messageId: item.messageId, description: '图片可能是棕色背景', uncertainties: ['颜色识别可能有偏差'] });
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ images }) } }] })); return;
  }
  assert.equal(request.response_format.type, 'json_object'); assert.match(request.messages[0].content, /JSON Schema/);
  const input = JSON.parse(request.messages[1].content); latestInput = input; calls++;
  const q = input.specificQuestion || '';
  if (req.headers.authorization !== 'Bearer ' + (savedKeys[q]?.deepseek ?? 'test-only-key')) { res.writeHead(401).end(); return; }
  if (providerFailure) { res.writeHead(500).end('{}'); return; }
  if (q === 'TIMEOUT') await new Promise(r => setTimeout(r, 1700));
  if (q === 'RACE') await new Promise(r => setTimeout(r, 500));
  const message = input.context.messages.find(m => m.text !== '未被模型引用的输入') ?? input.context.messages[0]; const ref = message ? 'message:' + message.messageId : null;
  const blocked = input.context.preferenceRecords.some(p => p.hardConstraint && p.boundaryRule === 'DO_NOT_CONTACT_AGAIN');
  const output = { schemaVersion: '1.0', status: blocked && q !== 'BYPASS_BOUNDARY' ? 'CANNOT_ADVISE' : ref ? 'OK' : 'NEEDS_CONTEXT', contextUsedRefs: ref ? [ref] : [],
    observations: ref ? [{ statement: message.text || message.imageAnalysis?.description, kind: message.imageAnalysis ? 'INFERENCE' : 'FACT', evidenceRefs: [ref] }] : [], uncertainties: message?.imageAnalysis ? ['图片识别可能有误差'] : [],
    recommendation: null, replyOptions: [], draftRevision: null, responseHandling: [], clarifyingQuestions: [], engineVersion: 'server-assigned', createdAt: new Date().toISOString() };
  if (output.status === 'OK') {
    output.recommendation = { actionType: 'ASK_FOLLOW_UP', title: '先听对方说', reason: '对方表达了难受，可以简短关心。', evidenceRefs: [ref], actionTags: ['CONTACT'], appliesWhen: null, alternatives: [] };
    output.replyOptions = [{ optionId: 'reply-1', text: '怎么了？愿意说说吗？', style: '简短自然', evidenceRefs: [ref], appliesWhen: null }];
    if (q === 'DUAL_REPAIR') output.replyOptions[0].text = request.messages.length === 3 ? '修改版本' : '最初版本';
    if (q === 'VOICE_REWRITE' || q === 'VOICE_STUCK') output.replyOptions[0].text = q === 'VOICE_REWRITE' && request.messages.length === 3 ? '行 那你先歇会' : '听起来你今天很累，如果你愿意的话可以聊聊。';
  } else if (output.status === 'NEEDS_CONTEXT') output.clarifyingQuestions = [{ question: '最近聊了什么？', reason: '原话会影响建议', fieldHint: 'MESSAGE_CONTENT' }];
  else output.cannotAdviseReason = { code: 'BOUNDARY_OVERRIDE', message: '对方已明确要求不再联系。' };
  if(input.userGoal==='ASSESS_AFFINITY') {
    const canScore=!!ref && message.sender==='OTHER' && !blocked;
    if(!canScore && !blocked) { output.status='NEEDS_CONTEXT';output.recommendation=null;output.clarifyingQuestions=[{question:'对方主动说过什么？',reason:'需要对方的互动记录。',fieldHint:'MESSAGE_CONTENT'}]; }
    output.replyOptions=[];output.draftRevision=null;output.responseHandling=[];
    if(canScore)output.recommendation={actionType:'NO_ACTION',title:'好感度评估',reason:'依据本次选中的互动记录。',evidenceRefs:[ref],actionTags:[],appliesWhen:null,alternatives:[]};
    output.affinityAssessment={score:canScore?68:null,confidence:canScore?'MEDIUM':'LOW',summary:canScore?'存在积极互动，仍有其他解释。':'信息不足，暂不评分。',evidence:canScore?[{signal:'POSITIVE',description:'对方分享了近况。',evidenceRefs:[ref]}]:[],uncertainties:['分享近况也可能是普通朋友之间的交流。']};
    if(q==='AFFINITY_BAD_SCORE')output.affinityAssessment.score=101;
    if(q==='AFFINITY_BAD_REF')output.affinityAssessment.evidence[0].evidenceRefs=['message:'+randomUUID()];
    if(q==='AFFINITY_NO_UNCERTAINTY')output.affinityAssessment.uncertainties=[];
    if(q==='AFFINITY_WITH_REPLY')output.replyOptions=[{optionId:'bad',text:'继续问',style:'自然',evidenceRefs:[ref],appliesWhen:null}];
  }
  if (q === 'FAKE_REF') { output.contextUsedRefs = ['message:' + randomUUID()]; output.observations[0].evidenceRefs = output.contextUsedRefs; }
  if (q === 'UNKNOWN_ENUM') output.recommendation.actionType = 'UNKNOWN_ACTION';
  if (q === 'EXTRA_FIELD') output.secret = 'not permitted';
  if (q === 'BAD_UNION') output.status = 'NEEDS_CONTEXT';
  if (q === 'VOICE_BAD_SOURCE') { const reference='message:'+input.context.writingStyle.sourceMessageIds[0];output.contextUsedRefs=[reference];output.observations[0].evidenceRefs=[reference]; }
  if (q === 'CORPUS_BAD_SOURCE') { const reference='voice:'+input.context.personalVoice.examples[0].sampleId;output.contextUsedRefs=[reference];output.observations[0].evidenceRefs=[reference]; }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: q === 'INVALID_JSON' ? '{' : JSON.stringify(output) } }] }));
});

const jevProvider = createServer(async (req,res) => {
  assert.equal(req.url,'/v1/systemone');
  let raw=''; for await(const chunk of req) raw+=chunk;
  const request=JSON.parse(raw); reviewCalls++;
  assert.deepEqual(Object.keys(request).sort(),['model','questions','state']);
  assert.equal(request.model,'jev-fixture');
  assert.ok(Object.values(request.questions).every(q=>q.type==='noul'));
  assert.equal(request.state.context.messages.length,1,'Jev gets only the selected context');
  assert.ok(!raw.includes('test-only-key') && !raw.includes('jev-fixture-key'),'no provider credentials enter state');
  const q=request.state.specificQuestion;
  if(q==='DUAL_PASS') assert.equal(request.state.context.personalVoice.examples[0].text,'行 那你先歇会');
  assert.equal(req.headers.authorization,'Bearer ' + (savedKeys[q]?.jev ?? 'jev-fixture-key'));
  assert.ok(!raw.includes('saved-fixture-'), 'saved credentials never enter model context');
  if(q==='DUAL_OUTAGE'){res.writeHead(503).end('{}');return;}
  const answers=Object.fromEntries(Object.keys(request.questions).map(name=>[name,{type:'noul',noul:.01}]));
  if(q==='DUAL_REPAIR' && request.state.candidate.replyOptions[0]?.text==='最初版本')answers.unsupported_fact.noul=.95;
  if(q==='DUAL_FAIL')answers.boundary_violation.noul=.99;
  if(q==='DUAL_UNCERTAIN')answers.style_mismatch.noul=.5;
  if(q==='DUAL_BAD')delete answers.boundary_violation;
  res.writeHead(200,{'Content-Type':'application/json'});
  res.end(JSON.stringify({model:'jev-fixture',answers,usage:{input_tokens:100,output_tokens:10}}));
});

async function start(extraEnv = {}) {
  let output = '';
  launcher = spawn(process.execPath, [join(root, 'scripts/mvp.mjs'), '--no-frontend', '--skip-build'], { cwd: root, windowsHide: true, env: { ...process.env,
    BETWEENLY_RUNTIME: runtime, BETWEENLY_PORT_OFFSET: '1000', BETWEENLY_TEST_PROVIDER: '1', MODEL_TIMEOUT_SECONDS: '1',
    DEEPSEEK_API_KEY: 'test-only-key', DEEPSEEK_MODEL: 'test-model', DEEPSEEK_BASE_URL: `http://127.0.0.1:${provider.address().port}`, TYPESAFE_API_KEY: '', JEV_ENABLED: 'false', JEV_BASE_URL: 'https://api.typesafe.ai/v1', WECHAT_ASSISTANT_PATH: join(root,'Backend/tests/wechat-fixture.mjs'), ...extraEnv }, stdio: ['ignore', 'pipe', 'pipe'] });
  ready = new Promise((yes, no) => {
    const timeout = setTimeout(() => no(Error('Test services failed to start: ' + output)), 45000);
    function consume(chunk) { output += chunk; if (output.includes('MVP_READY')) { clearTimeout(timeout); yes(); } }
    launcher.stdout.on('data', consume); launcher.stderr.on('data', consume);
    launcher.once('error', no); launcher.once('exit', code => { clearTimeout(timeout); if (!output.includes('MVP_READY')) no(Error(`Launcher exited ${code}: ${output}`)); });
  });
  await ready;
}
async function stop() {
  if (!launcher || launcher.exitCode !== null) return;
  const exited = new Promise(yes => launcher.once('exit', yes));
  writeFileSync(join(runtime, 'stop'), 'stop');
  await exited;
}
async function api(path, method = 'GET', body, headers = {}, expected = 200, identity = user) {
  const response = await fetch(base + path, { method, headers: { 'X-Dev-User-Id': identity, 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000) });
  const raw = await response.text(); let json;
  try { json = raw ? JSON.parse(raw) : null; } catch { assert.fail('Non-JSON response: ' + response.status); }
  assert.equal(response.status, expected, `${method} ${path}: ${raw}`);
  if (expected >= 400) { assert.equal(json.data, null); assert.ok(json.error.code); assert.ok(json.traceId); }
  else if (expected !== 204) { assert.ok(json.meta); assert.ok(json.traceId); assert.ok(Object.hasOwn(json, 'data')); }
  return json;
}
const contactInput = label => ({ label, relationshipStage: 'ACQUAINTED', connectionContext: null, currentSituation: null });
const messageInput = text => ({ sender: 'OTHER', text, sentAt: null, sequenceNo: null, sourceType: 'COUNTERPART_EXPLICIT', isVerbatim: true });
const adviceInput = (id, question = null) => ({ entryPoint: 'BUILD_RELATIONSHIP', userGoal: 'CONTINUE_CONVERSATION', specificQuestion: question, selectedMessageIds: id ? [id] : [], selectedEventIds: [], selectedPreferenceIds: [], draftText: null, ephemeralContext: null });
const styleInput = { preferredLength: 'SHORT', emojiPreference: 'AVOID', preferredTones: ['WARM'], avoidPatterns: ['说教'], examplePhrases: [] };
const version = v => ({ 'If-Match': String(v) });

test('MVP: real service chain against isolated DeepSeek protocol fixture', { timeout: 120000 }, async t => {
  await new Promise(yes => provider.listen(0, '127.0.0.1', yes));
  await new Promise(yes => jevProvider.listen(0, '127.0.0.1', yes));
  t.after(async () => { await stop(); await Promise.all([new Promise(yes => provider.close(yes)),new Promise(yes=>jevProvider.close(yes))]); });
  await start();
  let contact, message, advice;
  await t.test('identity required; direct service and INTERNAL routes reject browser', async () => {
    const response = await fetch(base + '/contacts'); assert.equal(response.status, 401);
    assert.equal((await fetch('http://127.0.0.1:6102/api/v1/contacts')).status, 403);
    assert.equal((await fetch('http://127.0.0.1:6080/internal/v1/analysis', { method: 'POST', headers: { 'X-Dev-User-Id': user } })).status, 403);
  });
  await t.test('CRUD, owner isolation, optimistic version and strict fields', async () => {
    contact = (await api('/contacts', 'POST', contactInput('测试对象'), {}, 201)).data;
    await api('/contacts/' + contact.contactId, 'GET', undefined, {}, 404, otherUser);
    const invalid = await api('/contacts', 'POST', { ...contactInput('测试'), ownerUserId: otherUser }, {}, 400); assert.equal(invalid.error.code, 'VALIDATION_ERROR');
    await api('/contacts/' + contact.contactId, 'PATCH', { label: '新称呼' }, version(2), 409);
    contact = (await api('/contacts/' + contact.contactId, 'PATCH', { label: '新称呼' }, version(1))).data; assert.equal(contact.version, 2);
    message = (await api(`/contacts/${contact.contactId}/messages`, 'POST', messageInput('今天汇报不顺，有点难受。'), {}, 201)).data;
    await api('/messages/' + message.messageId, 'PATCH', { isVerbatim: 'yes' }, version(1), 400);
    await api(`/contacts/${contact.contactId}/messages`, 'POST', { ...messageInput('另一个'), sequenceNo: 2 }, {}, 422);
    await api('/contacts?limit=wrong', 'GET', undefined, {}, 400); await api('/contacts?cursor=invalid', 'GET', undefined, {}, 400);
  });
  await t.test('text batch imports are atomic, scoped, ordered and replayable', async () => {
    const target = (await api('/contacts', 'POST', contactInput('批量导入测试'), {}, 201)).data;
    const path = `/contacts/${target.contactId}/text-imports`;
    const messages = [
      { sender: 'USER', text: '多行\n原文[流泪]', sentAt: '2026-10-21T08:41:00.000Z' },
      { sender: 'OTHER', text: '[动画表情]', sentAt: '2026-10-21T16:34:00.000Z' },
      { sender: 'OTHER', text: '[动画表情]', sentAt: '2026-10-21T16:34:00.000Z' }
    ];
    await api(path, 'POST', { importId: randomUUID(), messages }, {}, 404, otherUser);
    await api(path, 'POST', { importId: randomUUID(), messages: [...messages, { ...messages[0], sender: 'INVALID' }] }, {}, 400);
    assert.equal((await api(`/contacts/${target.contactId}/messages`)).data.length, 0);
    const input = { importId: randomUUID(), messages };
    const responses = await Promise.all([api(path, 'POST', input, {}, 201), api(path, 'POST', input, {}, 201)]);
    assert.deepEqual(responses.map(r => r.data.importedCount).sort(), [0, 3]);
    assert.deepEqual(responses[0].data.messageIds, responses[1].data.messageIds);
    const stored = (await api(`/contacts/${target.contactId}/messages`)).data;
    assert.equal(stored.length, 3);
    assert.deepEqual(stored.map(m => ({ sender: m.sender, text: m.text, sentAt: m.sentAt })), messages);
    assert.equal(stored[0].sourceType, 'USER_SELF_REPORT'); assert.equal(stored[1].sourceType, 'COUNTERPART_EXPLICIT');
    await api(path, 'POST', { ...input, messages: messages.slice(1) }, {}, 409);
    await api(path, 'POST', { importId: randomUUID(), messages: [] }, {}, 400);
    await api(path, 'POST', { importId: randomUUID(), messages: Array(1001).fill(messages[0]) }, {}, 400);
    assert.equal((await api(`/contacts/${target.contactId}/messages`)).data.length, 3);
  });
  await t.test('pagination and expression style validation/version', async () => {
    await api('/contacts', 'POST', contactInput('第二对象'), {}, 201);
    const page = await api('/contacts?limit=1'); assert.equal(page.data.length, 1); assert.ok(page.meta.nextCursor);
    const next = await api('/contacts?limit=1&cursor=' + encodeURIComponent(page.meta.nextCursor)); assert.notEqual(next.data[0].contactId, page.data[0].contactId);
    await api('/me/expression-style', 'GET', undefined, {}, 404);
    await api('/me/expression-style', 'PUT', { ...styleInput, preferredTones: ['WARM', 'WARM'] }, {}, 400);
    const style = (await api('/me/expression-style', 'PUT', styleInput)).data; assert.equal(style.version, 1);
    await api('/me/expression-style', 'PUT', styleInput, version(8), 409);
  });
  await t.test('personal corpus: atomic import, deduplication, isolation, contextual selection, opt-out and privacy invalidation', async () => {
    const identity = randomUUID();
    const call = (path, method='GET', body, headers={}, expected=200) => api(path,method,body,headers,expected,identity);
    const endpoint='/me/voice-corpus';
    assert.equal((await call(endpoint)).data.sampleCount,0);
    await call(endpoint+'/imports','POST',{confirmedOwnWords:false,samples:[{text:'那你先歇会',situation:'GENERAL'}]}, {},422);
    await call(endpoint+'/imports','POST',{confirmedOwnWords:true,samples:[{text:'那你先歇会',situation:'GENERAL'},{text:'bad',situation:'INVALID'}]}, {},400);
    assert.equal((await call(endpoint)).data.sampleCount,0);
    const batch={confirmedOwnWords:true,samples:[{text:'那你先歇会',situation:'GENERAL'},{text:'那你先歇会',situation:'GENERAL'},{text:'周末出来走走？',situation:'INVITATION'},{text:'行 那你先休息',situation:'CARE'}]};
    const first=(await call(endpoint+'/imports','POST',batch,{},201)).data;
    assert.equal(first.importedCount,3);assert.equal(first.duplicateCount,1);
    assert.equal((await call(endpoint+'/imports','POST',batch,{},201)).data.importedCount,0);
    await stop(); await start();
    assert.equal((await call(endpoint)).data.sampleCount,3,'corpus survives service restart');
    await call(endpoint+'/imports','POST',{confirmedOwnWords:true,samples:[{text:'sk-'+'x'.repeat(25),situation:'GENERAL'}]}, {},400);
    await call(endpoint+'/imports','POST',{confirmedOwnWords:true,samples:Array(501).fill(batch.samples[0])}, {},400);
    assert.equal((await api(endpoint)).data.sampleCount,0);
    const page=(await call(endpoint+'/samples?limit=1'));assert.equal(page.data.length,1);assert.ok(page.meta.nextCursor);
    const saved=(await call(endpoint+'/samples')).data;
    await api(endpoint+'/samples/'+saved[0].sampleId,'DELETE',undefined,version(1),404);
    await call(endpoint+'/samples/'+saved[0].sampleId,'PUT',{text:'新版',situation:'GENERAL'},version(9),409);
    const target=(await call('/contacts','POST',contactInput('语料测试'),{},201)).data;
    const m=(await call(`/contacts/${target.contactId}/messages`,'POST',messageInput('今天搞砸了，很难受'),{},201)).data;
    const advicePath=`/contacts/${target.contactId}/advice-requests`;
    const run=async question => (await call(advicePath,'POST',adviceInput(m.messageId,question),{'Idempotency-Key':randomUUID()},201)).data;
    const result=await run('CORPUS_TEST');
    const profile=latestInput.context.personalVoice;
    assert.equal(profile.sampleCount,3);assert.ok(profile.examples.length<=8);
    assert.equal(profile.examples[0].situation,'CARE');
    assert.ok(profile.examples.every(s=>s.situation!=='INVITATION'));
    assert.ok(result.contextUsedRefs.every(r=>r.startsWith('message:')));
    await call(advicePath,'POST',adviceInput(m.messageId,'CORPUS_BAD_SOURCE'),{'Idempotency-Key':randomUUID()},502);
    const beforeRace=calls;
    const racing=call(advicePath,'POST',adviceInput(m.messageId,'RACE'),{'Idempotency-Key':randomUUID()},409);
    while(calls===beforeRace) await new Promise(resolve=>setTimeout(resolve,10));
    await call(endpoint+'/imports','POST',{confirmedOwnWords:true,samples:[{text:'别急 慢慢来',situation:'GENERAL'}]}, {},201);
    await racing;
    await call(endpoint+'/imports','POST',{confirmedOwnWords:true,samples:[{text:'这事慢慢来',situation:'GENERAL'}]}, {},201);
    await call('/advice-requests/'+result.requestId);
    await call(endpoint+'/samples/'+saved[0].sampleId,'PUT',{text:'新版表达',situation:'GENERAL'},version(1));
    await call('/advice-requests/'+result.requestId,'GET',undefined,{},404);
    const enabled=await run('CORPUS_ENABLED');
    let style=(await call('/me/expression-style','PUT',{...styleInput,usePersonalCorpus:false})).data;
    const disabled=await run('CORPUS_DISABLED');assert.ok(!Object.hasOwn(latestInput.context,'personalVoice'));
    await call('/me/expression-style','PUT',{...styleInput,usePersonalCorpus:true},version(style.version));
    await call(endpoint,'DELETE',{confirmation:'wrong'},{},400);
    await call(endpoint,'DELETE',{confirmation:'删除'},{},204);
    assert.equal((await call(endpoint)).data.sampleCount,0);
    await call('/advice-requests/'+enabled.requestId,'GET',undefined,{},404);
    await call('/advice-requests/'+disabled.requestId);
    await call('/contacts/'+target.contactId,'DELETE',undefined,version(target.version),204);
  });
  await t.test('unknown contact and cross-contact evidence never reach provider', async () => {
    const before = calls;
    await api(`/contacts/${randomUUID()}/advice-requests`, 'POST', adviceInput(message.messageId), { 'Idempotency-Key': randomUUID() }, 404);
    const second = (await api('/contacts', 'POST', contactInput('第三对象'), {}, 201)).data;
    const result = await api(`/contacts/${second.contactId}/advice-requests`, 'POST', adviceInput(message.messageId), { 'Idempotency-Key': randomUUID() }, 422); assert.equal(result.error.code, 'CONTEXT_SCOPE_INVALID'); assert.equal(calls, before);
  });
  await t.test('analysis saves, forwards only selected context, concurrent replay calls model once', async () => {
    const before = calls, key = randomUUID(), path = `/contacts/${contact.contactId}/advice-requests`, input = adviceInput(message.messageId);
    const replies = await Promise.all([api(path, 'POST', input, { 'Idempotency-Key': key }, 201), api(path, 'POST', input, { 'Idempotency-Key': key }, 201)]);
    advice = replies[0].data; assert.equal(advice.requestId, replies[1].data.requestId); assert.equal(calls, before + 1);
    assert.equal(latestInput.context.messages.length, 1); assert.equal(latestInput.expressionStyle.preferredLength, 'SHORT'); assert.equal(latestInput.context.contact.contactId, contact.contactId);
    assert.equal((await api('/advice-requests/' + advice.requestId)).data.requestId, advice.requestId);
    const conflict = await api(path, 'POST', { ...input, specificQuestion: 'changed' }, { 'Idempotency-Key': key }, 409); assert.equal(conflict.error.code, 'IDEMPOTENCY_KEY_REUSED');
  });
  await t.test('photo records persist, reach vision, respect scope, and invalidate advice on edit/delete', async () => {
    const target = (await api('/contacts', 'POST', contactInput('图片测试'), {}, 201)).data;
    const path = `/contacts/${target.contactId}/messages`;
    const input = { ...messageInput(''), image: photo };
    const record = (await api(path, 'POST', input, {}, 201)).data;
    assert.deepEqual(record.image, photo); assert.equal(record.text, '');
    await api(path, 'POST', { ...input, image: { ...photo, width: 99 } }, {}, 400);
    await api(path, 'POST', { ...input, image: { ...photo, dataUrl: 'https://example.com/private.jpg' } }, {}, 400);
    await api(path, 'POST', { ...input, imageAnalysis: { description: 'forged' } }, {}, 400);
    await api('/messages/' + record.messageId, 'PATCH', { image: null }, version(1), 400);
    await api('/messages/' + record.messageId, 'DELETE', undefined, version(1), 404, otherUser);
    const before = visionCalls;
    const advicePath = `/contacts/${target.contactId}/advice-requests`;
    const result = (await api(advicePath, 'POST', adviceInput(record.messageId), { 'Idempotency-Key': randomUUID() }, 201)).data;
    assert.equal(visionCalls, before + 1); assert.match(result.engineVersion, /vision-1.0/);
    assert.equal(latestInput.context.messages[0].imageAnalysis.sourceType, 'MODEL_INFERENCE');
    assert.ok(!JSON.stringify(latestInput).includes('data:image'));
    const extra = [];
    for (let i = 0; i < 2; i++) extra.push((await api(path, 'POST', input, {}, 201)).data.messageId);
    const pair = { ...adviceInput(record.messageId), selectedMessageIds: [record.messageId, extra[0]] }, pairKey = randomUUID();
    const combined = (await api(advicePath, 'POST', pair, { 'Idempotency-Key': pairKey }, 201)).data;
    assert.equal(visionCalls, before + 2); assert.equal(latestInput.context.messages.filter(m => m.imageAnalysis).length, 2);
    const replay = (await api(advicePath, 'POST', pair, { 'Idempotency-Key': pairKey }, 201)).data;
    assert.equal(replay.requestId, combined.requestId); assert.equal(visionCalls, before + 2, 'replay does not bill vision twice');
    const tooMany = await api(advicePath, 'POST', { ...adviceInput(record.messageId), selectedMessageIds: [record.messageId, ...extra] }, { 'Idempotency-Key': randomUUID() }, 413);
    assert.equal(tooMany.error.code, 'INPUT_TOO_LARGE'); assert.equal(visionCalls, before + 2);
    const changed = (await api('/messages/' + record.messageId, 'PATCH', { text: '补充文字', image: null }, version(1))).data;
    assert.equal(changed.image, null);
    await api('/advice-requests/' + result.requestId, 'GET', undefined, {}, 404);
    const imageAdvice = (await api(advicePath, 'POST', adviceInput(extra[0]), { 'Idempotency-Key': randomUUID() }, 201)).data;
    await api('/messages/' + extra[0], 'DELETE', undefined, version(1), 204);
    await api('/advice-requests/' + imageAdvice.requestId, 'GET', undefined, {}, 404);
    await api('/contacts/' + target.contactId, 'DELETE', undefined, version(1), 204);
  });
  await t.test('feedback and actual outcome persist through owning service', async () => {
    await api(`/advice-requests/${advice.requestId}/feedback`, 'POST', { selectedOptionId: 'foreign-option', editedText: null, flags: [], comment: null }, {}, 422);
    await api(`/advice-requests/${advice.requestId}/feedback`, 'POST', { selectedOptionId: 'reply-1', editedText: '怎么了？', flags: ['NOT_ME'], comment: null }, {}, 201);
    const outcome = (await api(`/advice-requests/${advice.requestId}/outcomes`, 'POST', { eventType: 'USER_ACTION', whatHappened: '听对方说明', occurredAt: null, sourceType: 'USER_SELF_REPORT', userReflection: null, relatedAdviceId: null }, {}, 201)).data;
    assert.equal(outcome.relatedAdviceId, advice.requestId); assert.equal((await api(`/contacts/${contact.contactId}/events`)).data.length, 1);
    assert.equal((await api('/me/expression-style')).data.version, 1);
  });
  await t.test('data and successful idempotency survive service restart', async () => {
    await stop(); await start();
    assert.equal((await api('/advice-requests/' + advice.requestId)).data.requestId, advice.requestId);
    assert.equal((await api('/contacts/' + contact.contactId)).data.label, '新称呼');
  });
  await t.test('no context yields NEEDS_CONTEXT; invalid model outputs are never saved', async () => {
    const path = `/contacts/${contact.contactId}/advice-requests`;
    assert.equal((await api(path, 'POST', adviceInput(null), { 'Idempotency-Key': randomUUID() }, 201)).data.status, 'NEEDS_CONTEXT');
    for (const marker of ['INVALID_JSON', 'FAKE_REF', 'UNKNOWN_ENUM', 'EXTRA_FIELD', 'BAD_UNION']) {
      const response = await api(path, 'POST', adviceInput(message.messageId, marker), { 'Idempotency-Key': randomUUID() }, 502); assert.equal(response.error.code, 'MODEL_OUTPUT_INVALID');
    }
    assert.equal((await api(path)).data.length, 2);
  });
  await t.test('provider outage and timeout use stable errors', async () => {
    const path = `/contacts/${contact.contactId}/advice-requests`;
    providerFailure = true;
    const unavailable = await api(path, 'POST', adviceInput(message.messageId), { 'Idempotency-Key': randomUUID() }, 503); assert.equal(unavailable.error.code, 'MODEL_UNAVAILABLE');
    providerFailure = false;
    const timed = await api(path, 'POST', adviceInput(message.messageId, 'TIMEOUT'), { 'Idempotency-Key': randomUUID() }, 504); assert.equal(timed.error.code, 'MODEL_TIMEOUT');
  });
  await t.test('source edits during generation discard stale results', async () => {
    const path = `/contacts/${contact.contactId}/advice-requests`, before = calls;
    const pending = api(path, 'POST', adviceInput(message.messageId, 'RACE'), { 'Idempotency-Key': randomUUID() }, 409);
    while (calls === before) await new Promise(r => setTimeout(r, 10));
    message = (await api('/messages/' + message.messageId, 'PATCH', { text: '新的原文' }, version(message.version))).data;
    assert.equal((await pending).error.code, 'VERSION_CONFLICT');
    await api('/advice-requests/' + advice.requestId, 'GET', undefined, {}, 404);
  });
  await t.test('automatic voice learning is contact-scoped, optional, style-only and invalidated with source messages', async () => {
    const target=(await api('/contacts','POST',contactInput('说话风格测试'),{},201)).data;
    const foreign=(await api('/contacts','POST',contactInput('另一段对话'),{},201)).data;
    const own=[];
    for(const text of ['哈哈可以','那你先歇会','好嘞','我晚点再看','行啊','哈哈好'])own.push((await api(`/contacts/${target.contactId}/messages`,'POST',{...messageInput(text),sender:'USER',sourceType:'USER_SELF_REPORT'},{},201)).data);
    const counterpart=(await api(`/contacts/${target.contactId}/messages`,'POST',messageInput('今天有点困，想早点睡。'),{},201)).data;
    await api(`/contacts/${foreign.contactId}/messages`,'POST',{...messageInput('这是另一段关系的说话方式'),sender:'USER'},{},201);
    const preview=(await api(`/contacts/${target.contactId}/writing-style`)).data;
    assert.equal(preview.sampleCount,6);assert.equal(preview.examples.length,6);assert.ok(preview.medianLength<=6);
    await api(`/contacts/${target.contactId}/writing-style`,'GET',undefined,{},404,otherUser);
    const path=`/contacts/${target.contactId}/advice-requests`, body=adviceInput(counterpart.messageId);
    let before=calls;
    const revised=(await api(path,'POST',{...body,specificQuestion:'VOICE_REWRITE'},{'Idempotency-Key':randomUUID()},201)).data;
    assert.equal(revised.replyOptions[0].text,'行 那你先歇会');assert.equal(calls-before,2);
    assert.equal(latestInput.context.messages.length,1);assert.equal(latestInput.context.writingStyle.sampleCount,6);
    assert.ok(latestInput.context.writingStyle.sourceMessageIds.every(id=>own.some(m=>m.messageId===id)));
    const bad=await api(path,'POST',{...body,specificQuestion:'VOICE_BAD_SOURCE'},{'Idempotency-Key':randomUUID()},502);
    assert.equal(bad.error.code,'MODEL_OUTPUT_INVALID','style examples cannot become unselected factual evidence');
    const stuck=await api(path,'POST',{...body,specificQuestion:'VOICE_STUCK'},{'Idempotency-Key':randomUUID()},502);
    assert.equal(stuck.error.code,'MODEL_STYLE_MISMATCH');
    const pending=api(path,'POST',{...body,specificQuestion:'RACE'},{'Idempotency-Key':randomUUID()},409);
    await new Promise(resolve=>setTimeout(resolve,120));
    await api('/messages/'+own[0].messageId,'PATCH',{text:'我晚点再看'},version(own[0].version));
    await pending;
    const saved=(await api(path,'POST',body,{'Idempotency-Key':randomUUID()},201)).data;
    const settings=(await api('/me/expression-style')).data;
    const off=(await api('/me/expression-style','PUT',{...styleInput,learnFromMessages:false},version(settings.version))).data;
    const manualOnly=(await api(path,'POST',body,{'Idempotency-Key':randomUUID()},201)).data;
    assert.equal(Object.hasOwn(latestInput.context,'writingStyle'),false);
    await api('/messages/'+own[1].messageId,'DELETE',undefined,version(own[1].version),204);
    assert.equal((await api(`/contacts/${target.contactId}/writing-style`)).data.sampleCount,5);
    await api('/advice-requests/'+saved.requestId,'GET',undefined,{},404);
    await api('/advice-requests/'+manualOnly.requestId);
    await api('/me/expression-style','PUT',{...styleInput,learnFromMessages:true},version(off.version));
    await api('/contacts/'+target.contactId,'DELETE',undefined,version(target.version),204);
    await api('/contacts/'+foreign.contactId,'DELETE',undefined,version(foreign.version),204);
  });
  await t.test('hard boundaries auto-include and prevent model bypass', async () => {
    const boundary = (await api(`/contacts/${contact.contactId}/preference-records`, 'POST', { subject: 'COUNTERPART', category: 'BOUNDARY', statement: '请不要再联系我', boundaryRule: 'DO_NOT_CONTACT_AGAIN', appliesWhen: null, sourceType: 'COUNTERPART_EXPLICIT', sourceRefs: [], supersedesRecordId: null }, {}, 201)).data;
    assert.equal(boundary.hardConstraint, true);
    const path = `/contacts/${contact.contactId}/advice-requests`;
    const refusal = (await api(path, 'POST', adviceInput(message.messageId), { 'Idempotency-Key': randomUUID() }, 201)).data; assert.equal(refusal.status, 'CANNOT_ADVISE');
    assert.ok(latestInput.context.autoIncludedPreferenceIds.includes(boundary.recordId));
    assert.equal((await api(path, 'POST', adviceInput(message.messageId, 'BYPASS_BOUNDARY'), { 'Idempotency-Key': randomUUID() }, 502)).error.code, 'MODEL_OUTPUT_INVALID');
    await api('/preference-records/' + boundary.recordId, 'DELETE', undefined, version(boundary.version), 204);
  });
  await t.test('delete uncited input also removes dependent advice and feedback', async () => {
    const second = (await api(`/contacts/${contact.contactId}/messages`, 'POST', messageInput('未被模型引用的输入'), {}, 201)).data;
    const input = adviceInput(message.messageId); input.selectedMessageIds.push(second.messageId);
    const created = (await api(`/contacts/${contact.contactId}/advice-requests`, 'POST', input, { 'Idempotency-Key': randomUUID() }, 201)).data;
    assert.ok(!created.contextUsedRefs.includes('message:' + second.messageId));
    await api('/messages/' + second.messageId, 'DELETE', undefined, version(1), 204);
    await api('/advice-requests/' + created.requestId, 'GET', undefined, {}, 404);
  });
  await t.test('web visitors cannot trigger the server computer WeChat helper', async () => {
    const beforeCalls = calls;
    assert.equal((await api('/wechat-import/status')).data.available, false);
    const target = (await api('/contacts','POST',contactInput('导入测试对象'),{},201)).data;
    const path = `/contacts/${target.contactId}/wechat-imports`;
    await api(path+'/preview','POST',{count:50},{},403);
    await api(path,'POST',{}, {'X-Forwarded-For':'127.0.0.1','X-WeChat-Import-Token':'spoofed'},403);
    assert.equal((await api(`/contacts/${target.contactId}/messages`)).data.length,0);
    assert.equal(calls,beforeCalls,'import must never call the model');
    await api('/contacts/'+target.contactId,'DELETE',undefined,version(target.version),204);
    await api(path,'POST',{}, {},403);
  });
  await t.test('affinity assessment is scoped, evidence-backed, nullable when insufficient and invalidated with its sources', async () => {
    const target=(await api('/contacts','POST',contactInput('评分合成测试'),{},201)).data;
    const record=(await api(`/contacts/${target.contactId}/messages`,'POST',messageInput('周末一起去看展吧？'),{},201)).data;
    const own=(await api(`/contacts/${target.contactId}/messages`,'POST',{...messageInput('我觉得对方喜欢我。'),sender:'USER'},{},201)).data;
    const path=`/contacts/${target.contactId}/advice-requests`;
    await api('/me/voice-corpus/imports','POST',{confirmedOwnWords:true,samples:[{text:'行 那你先歇会',situation:'GENERAL'}]}, {},201);
    const body={...adviceInput(record.messageId),userGoal:'ASSESS_AFFINITY'};
    const headers={'Idempotency-Key':randomUUID()};
    const result=(await api(path,'POST',body,headers,201)).data;
    assert.ok(!Object.hasOwn(latestInput.context,'personalVoice'),'affinity mode never receives corpus examples');
    assert.equal(result.affinityAssessment.score,68);assert.equal(result.replyOptions.length,0);assert.equal(result.recommendation.actionType,'NO_ACTION');
    assert.equal((await api(path,'POST',body,headers,201)).data.requestId,result.requestId);
    assert.ok((await api(`/contacts/${target.contactId}/advice-requests`)).data.some(item=>item.affinityAssessment?.score===68));
    await api('/advice-requests/'+result.requestId,'GET',undefined,{},404,otherUser);
    for(const selected of [null,own.messageId]) {
      const missing=(await api(path,'POST',{...adviceInput(selected),userGoal:'ASSESS_AFFINITY'},{'Idempotency-Key':randomUUID()},201)).data;
      assert.equal(missing.status,'NEEDS_CONTEXT');assert.equal(missing.affinityAssessment.score,null);
    }
    for(const q of ['AFFINITY_BAD_SCORE','AFFINITY_BAD_REF','AFFINITY_NO_UNCERTAINTY','AFFINITY_WITH_REPLY']) {
      const failure=await api(path,'POST',{...body,specificQuestion:q},{'Idempotency-Key':randomUUID()},502);
      assert.equal(failure.error.code,'MODEL_OUTPUT_INVALID');
    }
    await api('/messages/'+record.messageId,'DELETE',undefined,version(record.version),204);
    await api('/advice-requests/'+result.requestId,'GET',undefined,{},404);
    await api('/contacts/'+target.contactId,'DELETE',undefined,version(target.version),204);
    await api('/me/voice-corpus','DELETE',{confirmation:'删除'},{},204);
  });
  await t.test('clear user data preserves style and leaves other users isolated', async () => {
    const preservedStyle=(await api('/me/expression-style')).data;
    await api('/contacts', 'POST', contactInput('其他用户'), {}, 201, otherUser);
    await api('/me/context-data', 'DELETE', undefined, {}, 204);
    assert.equal((await api('/contacts')).data.length, 0); assert.equal((await api('/me/expression-style')).data.version, preservedStyle.version);
    assert.equal((await api('/contacts', 'GET', undefined, {}, 200, otherUser)).data.length, 1);
    await api('/me/context-data', 'DELETE', undefined, {}, 204, otherUser);
    await api('/me/expression-style', 'DELETE', undefined, version(preservedStyle.version), 204);
  });
  await t.test('DeepSeek and Jev cooperate, repair once, preserve retries and expose review failures', async () => {
    await stop();
    await start({TYPESAFE_API_KEY:'jev-fixture-key',JEV_ENABLED:'true',JEV_MODEL:'jev-fixture',JEV_BASE_URL:`http://127.0.0.1:${jevProvider.address().port}/v1`});
    const ready=await (await fetch('http://127.0.0.1:6104/readyz')).json();
    assert.equal(ready.provider,'deepseek+jev');assert.equal(ready.reviewEnabled,true);
    const target=(await api('/contacts','POST',contactInput('双模型测试'),{},201)).data;
    const record=(await api(`/contacts/${target.contactId}/messages`,'POST',messageInput('今天工作有点累。'),{},201)).data;
    const path=`/contacts/${target.contactId}/advice-requests`;
    await api('/me/voice-corpus/imports','POST',{confirmedOwnWords:true,samples:[{text:'行 那你先歇会',situation:'GENERAL'}]}, {},201);
    let before=calls, reviews=reviewCalls;
    const body=adviceInput(record.messageId,'DUAL_PASS'), headers={'Idempotency-Key':randomUUID()};
    const output=(await api(path,'POST',body,headers,201)).data;
    assert.match(output.engineVersion,/jev:jev-fixture/);
    await api(path,'POST',body,headers,201);
    assert.equal(calls-before,1);assert.equal(reviewCalls-reviews,1);
    before=calls;reviews=reviewCalls;
    const repaired=(await api(path,'POST',adviceInput(record.messageId,'DUAL_REPAIR'),{'Idempotency-Key':randomUUID()},201)).data;
    assert.equal(repaired.replyOptions[0].text,'修改版本');
    assert.equal(calls-before,2);assert.equal(reviewCalls-reviews,2);
    const uncertain=(await api(path,'POST',adviceInput(record.messageId,'DUAL_UNCERTAIN'),{'Idempotency-Key':randomUUID()},201)).data;
    assert.ok(uncertain.uncertainties.some(item=>item.includes('Jev')));
    const assessment=(await api(path,'POST',{...adviceInput(record.messageId,'AFFINITY_TEST'),userGoal:'ASSESS_AFFINITY'},{'Idempotency-Key':randomUUID()},201)).data;
    assert.equal(assessment.affinityAssessment.score,68);assert.match(assessment.engineVersion,/jev:jev-fixture/);
    for(const [question,status,code] of [['DUAL_FAIL',502,'MODEL_REVIEW_FAILED'],['DUAL_OUTAGE',503,'JEV_UNAVAILABLE'],['DUAL_BAD',502,'JEV_OUTPUT_INVALID']]) {
      const failure=await api(path,'POST',adviceInput(record.messageId,question),{'Idempotency-Key':randomUUID()},status);
      assert.equal(failure.error.code,code);
    }
    await api('/contacts/'+target.contactId,'DELETE',undefined,version(target.version),204);
    await api('/me/voice-corpus','DELETE',{confirmation:'删除'},{},204);
  });
  await t.test('UI credentials persist encrypted, stay user-scoped and drive both providers without env keys', { skip: process.platform !== 'win32' }, async () => {
    await stop();
    const environment={DEEPSEEK_API_KEY:'',TYPESAFE_API_KEY:'',JEV_ENABLED:'auto',JEV_MODEL:'jev-fixture',JEV_BASE_URL:`http://127.0.0.1:${jevProvider.address().port}/v1`};
    await start(environment);
    const accountA=randomUUID(), accountB=randomUUID();
    const endpoint='/me/model-credentials';
    assert.equal((await fetch(base+endpoint)).status,401);
    assert.equal((await fetch('http://127.0.0.1:6104/api/v1/me/model-credentials',{headers:{'X-User-Id':accountA}})).status,403);
    assert.deepEqual((await api(endpoint,'GET',undefined,{},200,accountA)).data,{deepseekConfigured:false,jevConfigured:false});
    const saved=await api(endpoint,'PATCH',{deepseekApiKey:savedKeys.CREDENTIAL_A.deepseek,jevApiKey:savedKeys.CREDENTIAL_A.jev},{},200,accountA);
    assert.deepEqual(saved.data,{deepseekConfigured:true,jevConfigured:true});
    assert.ok(!JSON.stringify(saved).includes('saved-fixture'));
    assert.deepEqual((await api(endpoint,'GET',undefined,{},200,accountB)).data,{deepseekConfigured:false,jevConfigured:false});
    await api(endpoint,'PATCH',{deepseekApiKey:savedKeys.CREDENTIAL_B.deepseek},{},200,accountB);
    for(const invalid of [{},{jevApiKey:'bad key secret'},{deepseekApiKey:'x'.repeat(513)},{unexpected:'saved-fixture-value'}]) {
      const failure=await api(endpoint,'PATCH',invalid,{},400,accountA);
      assert.ok(!JSON.stringify(failure).includes('saved-fixture')&&!JSON.stringify(failure).includes('bad key secret'));
    }
    const targets=[];
    for(const [identity,question] of [[accountA,'CREDENTIAL_A'],[accountB,'CREDENTIAL_B']]) {
      const target=(await api('/contacts','POST',contactInput('密钥联调'),{},201,identity)).data;
      const record=(await api(`/contacts/${target.contactId}/messages`,'POST',messageInput('今天工作有点累。'),{},201,identity)).data;
      const path=`/contacts/${target.contactId}/advice-requests`;
      const output=(await api(path,'POST',adviceInput(record.messageId,question),{'Idempotency-Key':randomUUID()},201,identity)).data;
      assert.equal(output.engineVersion.includes('/jev:'),identity===accountA);
      assert.ok(!JSON.stringify(output).includes('saved-fixture'));
      targets.push({identity,target,record,path});
    }
    await stop();await start(environment);
    assert.deepEqual((await api(endpoint,'GET',undefined,{},200,accountA)).data,{deepseekConfigured:true,jevConfigured:true});
    await api(endpoint,'PATCH',{deepseekApiKey:savedKeys.CREDENTIAL_A_UPDATED.deepseek},{},200,accountA);
    const {record,path}=targets[0];
    const output=(await api(path,'POST',adviceInput(record.messageId,'CREDENTIAL_A_UPDATED'),{'Idempotency-Key':randomUUID()},201,accountA)).data;
    assert.match(output.engineVersion,/jev:jev-fixture/);
    for(const file of readdirSync(join(runtime,'data/model-credentials'))) {
      const encrypted=readFileSync(join(runtime,'data/model-credentials',file));
      assert.ok(!encrypted.includes(Buffer.from('saved-fixture')));
    }
    for(const {identity,target} of targets) {
      await api('/contacts/'+target.contactId,'DELETE',undefined,version(target.version),204,identity);
      await api(endpoint,'PATCH',{deepseekApiKey:null,jevApiKey:null},{},200,identity);
    }
  });
});
