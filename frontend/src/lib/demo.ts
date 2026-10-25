import type { Advice, AdviceInput, Contact, Envelope, Event, Message, Preference, RequestOptions, Style, Transport } from './contracts.ts';
import { ApiError } from './api.ts';

const ids = { contact: '9f11f90a-f8cc-4e48-a4ab-30b14ea824df', second: '221157ea-32e9-4320-9c32-c887ad6fa879', message: '2869ab5e-6f3e-4cb4-ae48-478555bf45bb' };
const stamp = { version: 1, createdAt: '2026-10-24T10:00:00Z', updatedAt: '2026-10-24T10:00:00Z' };
export const defaultStyle = { preferredLength: 'SHORT', emojiPreference: 'SPARSE', preferredTones: ['WARM'], avoidPatterns: ['过多的感叹号', '没来由的安慰'], examplePhrases: ['啊，怎么了？', '这个听着还挺有意思的'] } as const;

export class DemoApi implements Transport {
  contacts: Contact[] = [
    { ...stamp, contactId: ids.contact, label: '林知夏', relationshipStage: 'ONGOING_CONTACT', connectionContext: '在学校的摄影社认识，平时会聊摄影和上课的事情。', currentSituation: '最近在准备课程汇报，今天说汇报不太顺利。' },
    { ...stamp, contactId: ids.second, label: '陈屿', relationshipStage: 'JUST_CONNECTED', connectionContext: '在朋友的读书聚会上认识，聊过几句科幻小说。', currentSituation: null }
  ];
  messages: Message[] = [
    { ...stamp, messageId: crypto.randomUUID(), contactId: ids.contact, sender: 'USER', text: '你今天是不是有个课程汇报？', sentAt: null, sequenceNo: 1, sourceType: 'USER_SELF_REPORT', isVerbatim: true },
    { ...stamp, messageId: ids.message, contactId: ids.contact, sender: 'OTHER', text: '今天汇报搞砸了，有点难受。', sentAt: null, sequenceNo: 2, sourceType: 'COUNTERPART_EXPLICIT', isVerbatim: true },
  ];
  events: Event[] = [{ ...stamp, eventId: crypto.randomUUID(), contactId: ids.contact, eventType: 'SHARED_EXPERIENCE', whatHappened: '上周摄影社活动一起拍了校园的秋天，交流过相机设置。', occurredAt: null, sourceType: 'OBSERVED_BEHAVIOR', userReflection: '交流的时候感觉比较放松。', relatedAdviceId: null }];
  preferences: Preference[] = [{ ...stamp, recordId: crypto.randomUUID(), contactId: ids.contact, subject: 'COUNTERPART', category: 'INTEREST', statement: '提过喜欢拍日落和街边的小店。', boundaryRule: null, appliesWhen: null, sourceType: 'USER_RELAY', sourceRefs: [], supersedesRecordId: null, status: 'PENDING', hardConstraint: false }];
  advices: Advice[] = [];
  style: Style = { ...structuredClone(defaultStyle), preferredTones: ['WARM'], avoidPatterns: [...defaultStyle.avoidPatterns], examplePhrases: [...defaultStyle.examplePhrases], userId: '7bc4918a-9079-4ea2-9e8e-369ad79a9f20', version: 1, updatedAt: stamp.updatedAt };
  replay = new Map<string, { checksum: string; result: Advice }>();

  async request<T>(path: string, options: RequestOptions = {}): Promise<Envelope<T>> {
    if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const url = new URL(path, 'http://demo.local'); const parts = url.pathname.split('/').filter(Boolean);
    const method = options.method ?? 'GET'; const body = options.body as Record<string, unknown>;
    let data: unknown;
    const resource = parts[0]; const id = parts[1];
    if (resource === 'me' && id === 'expression-style') {
      if (method === 'PUT') { this.checkVersion(this.style.version, options); this.style = { ...this.style, ...body, version: this.style.version + 1, updatedAt: new Date().toISOString() } as Style; }
      data = this.style;
    } else if (resource === 'me' && id === 'context-data' && method === 'DELETE') {
      this.contacts = []; this.messages = []; this.events = []; this.preferences = []; this.advices = []; this.replay.clear();
    } else if (resource === 'contacts' && !id) {
      if (method === 'POST') this.contacts.push({ ...body, ...stamp, contactId: crypto.randomUUID() } as Contact);
      data = method === 'POST' ? this.contacts.at(-1) : this.contacts;
    } else if (resource === 'contacts' && !parts[2]) {
      const contact = this.contacts.find(item => item.contactId === id);
      if (!contact) throw new ApiError('联系人不存在', 'RESOURCE_NOT_FOUND', '', 404);
      if (method === 'PATCH') { this.checkVersion(contact.version, options); Object.assign(contact, body, { version: contact.version + 1 }); }
      if (method === 'DELETE') {
        this.checkVersion(contact.version, options); this.contacts = this.contacts.filter(item => item.contactId !== id);
        this.messages = this.messages.filter(item => item.contactId !== id); this.events = this.events.filter(item => item.contactId !== id);
        this.preferences = this.preferences.filter(item => item.contactId !== id); this.advices = this.advices.filter(item => item.contactId !== id); this.replay.clear();
      }
      data = contact;
    } else if (resource === 'contacts' && parts[2] === 'advice-requests') {
      if (method === 'POST') {
        const key = options.idempotencyKey;
        if (!key) throw new ApiError('缺少幂等键', 'VALIDATION_ERROR');
        const checksum = JSON.stringify([id, body]); const previous = this.replay.get(key);
        if (previous && previous.checksum !== checksum) throw new ApiError('幂等键对应了不同请求', 'IDEMPOTENCY_KEY_REUSED', '', 409);
        data = previous?.result ?? this.exampleAdvice(id, options.body as AdviceInput);
        if (!previous) { this.advices.unshift(data as Advice); this.replay.set(key, { checksum, result: data as Advice }); }
      } else data = this.advices.filter(item => item.contactId === id);
    } else if (resource === 'contacts' && ['messages', 'events', 'preference-records'].includes(parts[2])) {
      const kind = parts[2];
      if (method === 'POST') {
        const common = { ...stamp, ...body, contactId: id };
        if (kind === 'messages') { const value = { ...common, messageId: crypto.randomUUID() } as Message; this.messages.push(value); data = value; }
        if (kind === 'events') { const value = { ...common, eventId: crypto.randomUUID() } as Event; this.events.push(value); data = value; }
        if (kind === 'preference-records') {
          const value = { ...common, recordId: crypto.randomUUID(), status: 'PENDING', hardConstraint: body.boundaryRule === 'DO_NOT_CONTACT_AGAIN' } as Preference;
          this.preferences.push(value); data = value;
        }
      } else data = (kind === 'messages' ? this.messages : kind === 'events' ? this.events : this.preferences).filter(item => item.contactId === id);
    } else if (['messages', 'events', 'preference-records'].includes(resource)) {
      const collection = resource === 'messages' ? this.messages : resource === 'events' ? this.events : this.preferences;
      const key = resource === 'messages' ? 'messageId' : resource === 'events' ? 'eventId' : 'recordId';
      const index = collection.findIndex(item => (item as unknown as Record<string, unknown>)[key] === id);
      if (index < 0) throw new ApiError('记录不存在', 'RESOURCE_NOT_FOUND', '', 404);
      this.checkVersion(collection[index].version, options);
      if (method === 'DELETE') { collection.splice(index, 1); this.advices = this.advices.filter(item => !item.contextUsedRefs.includes((resource === 'messages' ? 'message:' : resource === 'events' ? 'event:' : 'preference:') + id)); this.replay.clear(); }
      else { Object.assign(collection[index], body, { version: collection[index].version + 1 }); data = collection[index]; }
    } else if (resource === 'advice-requests') {
      const advice = this.advices.find(item => item.requestId === id);
      if (!advice) throw new ApiError('分析不存在', 'RESOURCE_NOT_FOUND', '', 404);
      if (parts[2] === 'outcomes' && method === 'POST') { data = { ...stamp, ...body, relatedAdviceId: id, contactId: advice.contactId, eventId: crypto.randomUUID() }; this.events.push(data as Event); }
      else if (method === 'DELETE') { this.advices = this.advices.filter(item => item.requestId !== id); this.replay.clear(); }
      else data = parts[2] === 'feedback' ? { saved: true } : advice;
    } else throw new ApiError('演示模式暂不支持此操作', 'RESOURCE_NOT_FOUND', '', 404);
    return { data: structuredClone(data) as T, meta: {}, traceId: 'demo-' + crypto.randomUUID() };
  }
  checkVersion(version: number, options: RequestOptions) { if (options.version !== version) throw new ApiError('记录版本已变化，请刷新后重试', 'VERSION_CONFLICT', '', 409); }
  exampleAdvice(contactId: string, input: AdviceInput): Advice {
    const refs = [...input.selectedMessageIds.map(id => 'message:' + id), ...input.selectedEventIds.map(id => 'event:' + id), ...input.selectedPreferenceIds.map(id => 'preference:' + id)];
    const base = { requestId: crypto.randomUUID(), contactId, schemaVersion: '1.0' as const, contextUsedRefs: refs, observations: [], uncertainties: [] as string[], draftRevision: null, responseHandling: [], clarifyingQuestions: [], engineVersion: 'demo-fixtures-1.0', createdAt: new Date().toISOString() };
    if (input.userGoal === 'ASSESS_AFFINITY') return { ...base, status: 'NEEDS_CONTEXT', recommendation: null, replyOptions: [], affinityAssessment: { score: null, confidence: 'LOW', summary: '当前演示记录不足以评估互动倾向。', evidence: [], uncertainties: ['单次对话无法判断互动是否持续、双向。'] }, clarifyingQuestions: [{ question: '对方最近主动聊过什么，或提出过具体邀约？', reason: '需要更多对方主动互动的原文。', fieldHint: 'MESSAGE_CONTENT' }] };
    if (this.preferences.some(item => item.contactId === contactId && item.boundaryRule === 'DO_NOT_CONTACT_AGAIN' && item.status !== 'REJECTED' && item.status !== 'SUPERSEDED')) return { ...base, status: 'CANNOT_ADVISE', recommendation: null, replyOptions: [], cannotAdviseReason: { code: 'BOUNDARY_OVERRIDE', message: '已记录不要再联系的明确边界，应尊重这一意愿，不继续提供联系话术。' } };
    if (!input.selectedMessageIds.includes(ids.message) || contactId !== ids.contact) return { ...base, status: 'NEEDS_CONTEXT', recommendation: null, replyOptions: [], clarifyingQuestions: [{ question: '最近一次具体聊了什么，或发生了什么？', reason: '需要最近一次互动的具体内容。', fieldHint: 'MESSAGE_CONTENT' }] };
    return { ...base, status: 'OK', observations: [{ statement: '对方说汇报不顺利，并表达了难受。', kind: 'FACT', evidenceRefs: ['message:' + ids.message] }], uncertainties: [...base.uncertainties, '尚不清楚汇报中具体发生了什么，也不知道对方此刻是否方便继续聊。'], recommendation: { actionType: 'ASK_FOLLOW_UP', title: '先接住她的话，留一个自然的话口。', reason: '她表达了感受，但没有讲具体经过。简短地接一句，让她决定愿不愿意继续说。', evidenceRefs: ['message:' + ids.message], actionTags: ['CONTACT'], appliesWhen: '对方尚未说明具体经过，且没有不愿继续联系的边界。', alternatives: [{ actionType: 'SLOW_DOWN', title: '如果对方现在不想聊，就留一点空间。', appliesWhen: '对方表示想休息或暂时不方便。', actionTags: [] }] }, replyOptions: [{ optionId: 'demo-short', text: '啊，怎么了？', style: '简短自然', evidenceRefs: ['message:' + ids.message], appliesWhen: null }], responseHandling: [{ scenario: 'DECLINES', guidance: '尊重她暂时不想聊的选择，不连续追问。' }, { scenario: 'NO_RESPONSE', guidance: '先停在这里，给对方一点时间和空间。' }] };
  }
}
