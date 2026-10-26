import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { ActionMenu, Empty, Icon, Modal, ModalPresence } from './components.tsx';
import { ApiError, GatewayApi, isUuid, listAll, validBaseUrl } from './lib/api.ts';
import { assertAdvice } from './lib/advice.ts';
import { checkGatewayConnection, gatewayStates } from './lib/connection.ts';
import type { GatewayState } from './lib/connection.ts';
import { defaultSettings, isDesktop, restoreSettings } from './lib/settings.ts';
import { WeChatImportDialog } from './WeChatImportDialog.tsx';
import { BatchImportDialog } from './BatchImportDialog.tsx';
import { AffinityAssessment } from './AffinityAssessment.tsx';
import { ModelKeyFields } from './ModelKeyFields.tsx';
import { PhotoInput } from './PhotoInput.tsx';
import { AccountEmailVerification } from './EmailVerification.tsx';
import type { AccountProfile } from './lib/auth.ts';
import { boundaries, categories, eventTypes, goals, sources, stages } from './lib/contracts.ts';
import type { Advice, AdviceInput, Boundary, Category, Contact, Entry, Event, EventType, Goal, Message, MessageImage, Preference, Settings, Source, Stage, Style, StyleInput, Transport, WritingStyle } from './lib/contracts.ts';

type Page = 'workspace' | 'history';
type RecordItem = Message | Event | Preference;
type RecordKind = 'messages' | 'events' | 'preference-records';
type Dialog = { kind: 'contact'; value?: Contact } | { kind: 'record'; type: RecordKind; value?: RecordItem } | { kind: 'settings' } | { kind: 'feedback' } | { kind: 'outcome' } | { kind: 'wechat' } | { kind: 'batch' } | { kind: 'delete'; title: string; detail: string; path: string; version?: number; requireTextConfirmation?: boolean };
const entries: { id: Entry; title: string; icon: string }[] = [{ id: 'NEW_CONNECTION', title: '刚刚认识', icon: 'leaf' }, { id: 'BUILD_RELATIONSHIP', title: '想进一步了解', icon: 'chat' }, { id: 'SPECIFIC_DIFFICULTY', title: '遇到具体困难', icon: 'flag' }];
const blankStyle: StyleInput = { preferredLength: 'AS_NEEDED', emojiPreference: 'NEUTRAL', preferredTones: ['NEUTRAL'], avoidPatterns: [], examplePhrases: [] };
function readSettings(): Settings { try { return restoreSettings(localStorage.getItem('betweenly.settings')); } catch { return { ...defaultSettings }; } }
function splitLines(value: string) { return value.split('\n').map(line => line.trim()).filter(Boolean); }
function shortDate(date: string) { return new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(date)); }
function localDate(value: string | null) { if (!value) return ''; const date = new Date(value); return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16); }
function getId(item: RecordItem) { return 'messageId' in item ? item.messageId : 'eventId' in item ? item.eventId : item.recordId; }
function recordText(item: RecordItem) { return 'text' in item ? item.text || (item.image ? '[图片]' : '') : 'whatHappened' in item ? item.whatHappened : item.statement; }
function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) { return <label className="field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>; }
function Actions({ busy, label = '保存', onClose }: { busy: boolean; label?: string; onClose: () => void }) { return <div className="form-actions"><button className="primary-button" disabled={busy}>{busy ? '正在处理…' : label}<Icon name="arrow" size={16} /></button></div>; }

function ToneOptions({ initial, disabled }: { initial: StyleInput['preferredTones']; disabled: boolean }) {
  const [selected, setSelected] = useState(initial);
  const options = [{ value: 'NEUTRAL', label: '平实' }, { value: 'WARM', label: '温和' }, { value: 'PLAYFUL', label: '轻松' }, { value: 'DIRECT', label: '直接' }, { value: 'FORMAL', label: '正式' }] as const;
  return <fieldset className="tone-options" disabled={disabled}><legend>语气（最多 3 项）</legend>{options.map(({ value, label }) => {
    const checked = selected.includes(value);
    const atLimit = !checked && selected.length >= 3;
    return <label key={value} className={atLimit || disabled ? 'is-disabled' : undefined}><input type="checkbox" name="tones" value={value} checked={checked} disabled={atLimit} onChange={event => {
      const next = event.currentTarget.checked;
      setSelected(values => next ? values.length < 3 && !values.includes(value) ? [...values, value] : values : values.filter(item => item !== value));
    }} />{label}</label>;
  })}</fieldset>;
}

export default function App({ account }: { account?: { api: Transport; profile: AccountProfile; onLogout: () => Promise<void>; onVerified: () => void } }) {
  const [settings, setSettings] = useState(readSettings);
  const [theme, setTheme] = useState<'light' | 'dark'>(() => { try { return localStorage.getItem('betweenly.theme') === 'dark' ? 'dark' : 'light'; } catch { return 'light'; } });
  const api = useMemo<Transport>(() => account?.api ?? new GatewayApi(settings), [settings, account?.api]);
  const [gatewayState, setGatewayState] = useState<GatewayState>('connecting');
  const [page, setPage] = useState<Page>('workspace'); const [mobileNav, setMobileNav] = useState(false);
  const [contacts, setContacts] = useState<Contact[]>([]); const [contactId, setContactId] = useState('');
  const [messages, setMessages] = useState<Message[]>([]); const [events, setEvents] = useState<Event[]>([]); const [preferences, setPreferences] = useState<Preference[]>([]); const [history, setHistory] = useState<Advice[]>([]);
  const [style, setStyle] = useState<Style | null>(null); const [contextTab, setContextTab] = useState<RecordKind>('messages');
  const [selected, setSelected] = useState<string[]>([]); const [entry, setEntry] = useState<Entry>('BUILD_RELATIONSHIP'); const [goal, setGoal] = useState<Goal>('CONTINUE_CONVERSATION');
  const [question, setQuestion] = useState(''); const [draft, setDraft] = useState(''); const [result, setResult] = useState<Advice | null>(null); const [editedReply, setEditedReply] = useState(''); const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null); const [busy, setBusy] = useState(false); const [loading, setLoading] = useState(true); const [contextLoading, setContextLoading] = useState(false); const [revision, setRevision] = useState(0);
  const [error, setError] = useState<ApiError | null>(null); const [formError, setFormError] = useState(''); const [toast, setToast] = useState(''); const [search, setSearch] = useState('');
  const requestReplay = useRef({ signature: '', key: '' }); const resultRef = useRef<HTMLElement>(null);
  const contact = contacts.find(item => item.contactId === contactId);
  const selectedMessages = messages.filter(item => selected.includes(item.messageId)); const selectedEvents = events.filter(item => selected.includes(item.eventId)); const selectedPreferences = preferences.filter(item => selected.includes(item.recordId));
  const [styleForm, setStyleForm] = useState<StyleInput>(blankStyle);
  const [writingStyle, setWritingStyle] = useState<WritingStyle | null>(null);
  const [settingsView, setSettingsView] = useState<'connection' | 'style'>('connection');
  const [photoPreview, setPhotoPreview] = useState<MessageImage | null>(null);

  useEffect(() => { document.documentElement.dataset.theme = theme; try { localStorage.setItem('betweenly.theme', theme); } catch { /* Theme storage is optional. */ } }, [theme]);

  useEffect(() => {
    const controller = new AbortController(); let inFlight = false;
    async function check(showConnecting = false) {
      if (inFlight || controller.signal.aborted) return;
      inFlight = true;
      if (showConnecting) setGatewayState('connecting');
      try { await checkGatewayConnection(api, controller.signal); if (!controller.signal.aborted) setGatewayState('connected'); }
      catch { if (!controller.signal.aborted) setGatewayState('failed'); }
      finally { inFlight = false; }
    }
    const online = () => { void check(true); };
    const offline = () => setGatewayState('failed');
    const visible = () => { if (document.visibilityState === 'visible') void check(); };
    void check(true);
    const timer = setInterval(() => { void check(); }, 15000);
    window.addEventListener('online', online); window.addEventListener('offline', offline); document.addEventListener('visibilitychange', visible);
    return () => { controller.abort(); clearInterval(timer); window.removeEventListener('online', online); window.removeEventListener('offline', offline); document.removeEventListener('visibilitychange', visible); };
  }, [api, revision]);

  useEffect(() => { const timeout = setTimeout(() => setToast(''), 3500); return () => clearTimeout(timeout); }, [toast]);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError(null);
    listAll<Contact>(api, '/contacts', controller.signal).then(items => { setContacts(items); setContactId(current => items.some(item => item.contactId === current) ? current : items[0]?.contactId ?? ''); }).catch(cause => { if (!controller.signal.aborted) { setError(toError(cause)); setContacts([]); setContactId(''); } }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [api, revision]);
  useEffect(() => {
    const controller = new AbortController(); setResult(null); setSelected([]); setMessages([]); setEvents([]); setPreferences([]); setHistory([]);
    if (!contactId) return () => controller.abort();
    setContextLoading(true);
    Promise.all([listAll<Message>(api, '/contacts/' + contactId + '/messages', controller.signal), listAll<Event>(api, '/contacts/' + contactId + '/events', controller.signal), listAll<Preference>(api, '/contacts/' + contactId + '/preference-records', controller.signal), listAll<Advice>(api, '/contacts/' + contactId + '/advice-requests', controller.signal)])
      .then(([m, e, p, h]) => { if (!controller.signal.aborted) { setMessages(m); setEvents(e); setPreferences(p); setHistory(h); } })
      .catch(cause => { if (!controller.signal.aborted) setError(toError(cause)); }).finally(() => { if (!controller.signal.aborted) setContextLoading(false); });
    return () => controller.abort();
  }, [api, contactId, revision]);
  useEffect(() => { setQuestion(''); setDraft(''); requestReplay.current = { signature: '', key: '' }; }, [api, contactId]);
  useEffect(() => {
    const controller = new AbortController(); setWritingStyle(null);
    if (contactId) api.request<WritingStyle>('/contacts/' + contactId + '/writing-style', { signal: controller.signal }).then(response => { if (!controller.signal.aborted) setWritingStyle(response.data); }).catch(() => { /* Status is optional; analysis reports service errors. */ });
    return () => controller.abort();
  }, [api, contactId, messages]);
  useEffect(() => {
    const controller = new AbortController();
    api.request<Style>('/me/expression-style', { signal: controller.signal }).then(response => { setStyle(response.data); setStyleForm(response.data); }).catch(cause => { if (!controller.signal.aborted) { setStyle(null); setStyleForm(blankStyle); if (!(cause instanceof ApiError && cause.status === 404)) setError(toError(cause)); } });
    return () => controller.abort();
  }, [api]);

  function openDialog(value: Dialog) { if (!busy) { setFormError(''); setDialog(value); } }
  function closeDialog() { if (!busy) { setDialog(null); setFormError(''); } }
  function chooseContact(id: string) { if (busy) return; setError(null); setContactId(id); setMobileNav(false); setPage('workspace'); }
  function toggle(id: string) { setResult(null); setSelected(values => values.includes(id) ? values.filter(value => value !== id) : [...values, id]); }
  function toggleAllMessages() {
    setResult(null);
    const messageIds = new Set(messages.map(item => item.messageId));
    setSelected(values => {
      const allSelected = messages.every(item => values.includes(item.messageId));
      return allSelected ? values.filter(id => !messageIds.has(id)) : [...new Set([...values, ...messageIds])];
    });
  }
  function showResult(value: Advice) { setGoal(current => value.affinityAssessment ? 'ASSESS_AFFINITY' : current === 'ASSESS_AFFINITY' ? 'REVIEW_INTERACTION' : current); setResult(value); setEditedReply(value.replyOptions[0]?.text ?? ''); setSelectedOption(value.replyOptions[0]?.optionId ?? null); }
  async function work(action: () => Promise<void>, modal = false) { setBusy(true); setError(null); setFormError(''); try { await action(); } catch (cause) { if (modal) setFormError(toError(cause).message); else setError(toError(cause)); } finally { setBusy(false); } }
  async function refreshContext() {
    requestReplay.current = { signature: '', key: '' };
    const [m, e, p, h] = await Promise.all([listAll<Message>(api, '/contacts/' + contactId + '/messages'), listAll<Event>(api, '/contacts/' + contactId + '/events'), listAll<Preference>(api, '/contacts/' + contactId + '/preference-records'), listAll<Advice>(api, '/contacts/' + contactId + '/advice-requests')]);
    setMessages(m); setEvents(e); setPreferences(p); setHistory(h);
  }
  function deleteMessage(message: Message) {
    if (busy) return;
    void work(async () => {
      await api.request('/messages/' + message.messageId, { method: 'DELETE', version: message.version });
      setResult(null);
      setMessages(values => values.filter(item => item.messageId !== message.messageId));
      setSelected(values => values.filter(id => id !== message.messageId));
      setHistory([]);
      requestReplay.current = { signature: '', key: '' };
      setToast('聊天记录已删除');
      await refreshContext();
    });
  }
  function deleteContact(value: Contact) {
    if (busy) return;
    void work(async () => {
      await api.request('/contacts/' + value.contactId, { method: 'DELETE', version: value.version });
      const remaining = contacts.filter(item => item.contactId !== value.contactId);
      setContacts(remaining);
      setContactId(remaining[0]?.contactId ?? '');
      setResult(null); setSelected([]); setMessages([]); setEvents([]); setPreferences([]); setHistory([]);
      setPage('workspace');
      requestReplay.current = { signature: '', key: '' };
      setToast('联系人已删除');
    });
  }
  function analyze() {
    if (!contact) return;
    if (selectedMessages.filter(m => m.image).length > 2) { setError(new ApiError('每次分析最多选择 2 张图片，请减少后重试', 'INPUT_TOO_LARGE')); return; }
    if (selectedMessages.length > 200 || selectedEvents.length > 50 || selectedPreferences.length > 50) { setError(new ApiError('选中的背景超过契约上限，请减少后重试', 'VALIDATION_ERROR')); return; }
    const input: AdviceInput = { entryPoint: entry, userGoal: goal, specificQuestion: question.trim() || null, selectedMessageIds: selectedMessages.map(item => item.messageId), selectedEventIds: selectedEvents.map(item => item.eventId), selectedPreferenceIds: selectedPreferences.map(item => item.recordId), draftText: goal === 'ASSESS_AFFINITY' ? null : draft.trim() || null, ephemeralContext: null };
    const signature = JSON.stringify([contactId, input]); if (signature !== requestReplay.current.signature) requestReplay.current = { signature, key: crypto.randomUUID() };
    void work(async () => {
      const response = await api.request<Advice>('/contacts/' + contactId + '/advice-requests', { method: 'POST', body: input, idempotencyKey: requestReplay.current.key });
      assertAdvice(response.data, contactId, goal === 'ASSESS_AFFINITY');
      showResult(response.data); setHistory(current => [response.data, ...current.filter(item => item.requestId !== response.data.requestId)]); setTimeout(() => resultRef.current?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'nearest' }), 50);
    });
  }
  async function submitDialog(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!dialog) return;
    const data = new FormData(event.currentTarget); const text = (key: string) => String(data.get(key) ?? '').trim(); const nullable = (key: string) => text(key) || null;
    if (dialog.kind === 'settings') {
      if (account) {
        const modelKeys: Record<string, string> = Object.fromEntries(['deepseekApiKey', 'jevApiKey'].map(name => [name, text(name)]).filter(([, value]) => value));
        if (Object.values(modelKeys).some(value => !/^[!-~]{8,512}$/.test(value))) { setFormError('API Key 应为 8–512 个非空格英文字符'); return; }
        await work(async () => { if (Object.keys(modelKeys).length) await api.request('/me/model-credentials', { method: 'PATCH', body: modelKeys }); setDialog(null); setToast('设置已保存'); }, true);
        return;
      }
      const next: Settings = isDesktop ? { ...defaultSettings } : { baseUrl: text('baseUrl').replace(/\/$/, ''), devUserId: text('devUserId'), token: text('token') };
      if (!validBaseUrl(next.baseUrl)) { setFormError('请填写以 /api/v1 结尾的 HTTP(S) 地址'); return; }
      if (!next.token && !isUuid(next.devUserId)) { setFormError('请填写有效的小写开发用户 UUID v4，或用户令牌'); return; }
      const modelKeys: Record<string, string> = Object.fromEntries(['deepseekApiKey', 'jevApiKey'].map(name => [name, text(name)]).filter(([, value]) => value));
      if (Object.values(modelKeys).some(value => !/^[!-~]{8,512}$/.test(value))) { setFormError('API Key 应为 8–512 个非空格英文字符'); return; }
      await work(async () => {
        if (Object.keys(modelKeys).length) await new GatewayApi(next).request('/me/model-credentials', { method: 'PATCH', body: modelKeys });
        setResult(null); setSelected([]); setContactId(''); setSettings(next); try { localStorage.setItem('betweenly.settings', JSON.stringify({ ...next, token: '' })); } catch { /* Storage is optional. */ }
        setDialog(null); setToast('连接设置已保存');
      }, true);
      return;
    }
    void work(async () => {
      if (dialog.kind === 'contact') {
        if (!text('label')) throw new ApiError('请填写联系人称呼', 'VALIDATION_ERROR');
        const body = { label: text('label'), relationshipStage: text('stage') as Stage, connectionContext: nullable('connectionContext'), currentSituation: nullable('currentSituation') };
        const response = await api.request<Contact>('/contacts' + (dialog.value ? '/' + dialog.value.contactId : ''), { method: dialog.value ? 'PATCH' : 'POST', body, version: dialog.value?.version });
        requestReplay.current = { signature: '', key: '' };
        setResult(null); if (dialog.value) setHistory([]);
        setContacts(current => dialog.value ? current.map(item => item.contactId === response.data.contactId ? response.data : item) : [...current, response.data]); setContactId(response.data.contactId); setPage('workspace');
      }
      if (dialog.kind === 'record') {
        if (text('imageProcessing')) throw new ApiError('图片正在处理，请稍候保存', 'VALIDATION_ERROR');
        const image = dialog.type === 'messages' && text('image') ? JSON.parse(text('image')) as MessageImage : null;
        if (!text('text') && !image) throw new ApiError('请填写文字或上传图片', 'VALIDATION_ERROR');
        const sourceType = text('sourceType') as Source; const refDate = text('date'); let body: unknown;
        if (dialog.type === 'messages' && sourceType === 'USER_RELAY' && data.has('isVerbatim')) throw new ApiError('凭记忆转述时，请取消“与聊天界面原文一致”', 'VALIDATION_ERROR');
        if (data.getAll('sourceRefs').length > 20) throw new ApiError('关联依据最多选择 20 条', 'VALIDATION_ERROR');
        if (dialog.type === 'messages') body = { sender: text('sender'), text: text('text'), sentAt: refDate ? new Date(refDate).toISOString() : null, sequenceNo: text('sequenceNo') ? Number(text('sequenceNo')) : null, sourceType, isVerbatim: data.has('isVerbatim'), image };
        if (dialog.type === 'events') body = { eventType: text('eventType'), whatHappened: text('text'), occurredAt: refDate ? new Date(refDate).toISOString() : null, sourceType, userReflection: nullable('userReflection'), relatedAdviceId: dialog.value && 'relatedAdviceId' in dialog.value ? dialog.value.relatedAdviceId : null };
        if (dialog.type === 'preference-records') body = { subject: text('subject'), category: text('category'), statement: text('text'), boundaryRule: text('category') === 'BOUNDARY' ? text('boundaryRule') as Boundary : null, appliesWhen: nullable('appliesWhen'), sourceType, sourceRefs: data.getAll('sourceRefs').map(String), supersedesRecordId: dialog.value && 'supersedesRecordId' in dialog.value ? dialog.value.supersedesRecordId : null };
        await api.request(dialog.value ? '/' + dialog.type + '/' + getId(dialog.value) : '/contacts/' + contactId + '/' + dialog.type, { method: dialog.value ? 'PATCH' : 'POST', body, version: dialog.value?.version });
        setResult(null); await refreshContext();
      }
      if (dialog.kind === 'feedback' && result) { await api.request('/advice-requests/' + result.requestId + '/feedback', { method: 'POST', body: { selectedOptionId: selectedOption, editedText: editedReply || null, flags: data.getAll('flags'), comment: nullable('comment') } }); }
      if (dialog.kind === 'outcome' && result) {
        if (!text('text')) throw new ApiError('请记录实际发生的内容', 'VALIDATION_ERROR');
        await api.request('/advice-requests/' + result.requestId + '/outcomes', { method: 'POST', body: { eventType: text('eventType'), whatHappened: text('text'), occurredAt: text('date') ? new Date(text('date')).toISOString() : null, sourceType: 'USER_SELF_REPORT', userReflection: nullable('userReflection'), relatedAdviceId: result.requestId } }); await refreshContext();
      }
      if (dialog.kind === 'delete') {
        if (dialog.requireTextConfirmation !== false && text('confirmation') !== '删除') throw new ApiError('请输入“删除”以确认');
        await api.request(dialog.path, { method: 'DELETE', version: dialog.version }); setResult(null); setSelected([]); setRevision(current => current + 1);
        requestReplay.current = { signature: '', key: '' };
      }
      setDialog(null); setToast('已保存');
    }, true);
  }
  function saveStyle(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    const input: StyleInput = { preferredLength: String(data.get('length')) as StyleInput['preferredLength'], emojiPreference: String(data.get('emoji')) as StyleInput['emojiPreference'], preferredTones: data.getAll('tones') as StyleInput['preferredTones'], avoidPatterns: splitLines(String(data.get('avoid') ?? '')), examplePhrases: splitLines(String(data.get('examples') ?? '')), learnFromMessages: data.has('learnFromMessages') };
    if (input.preferredTones.length > 3 || input.avoidPatterns.length > 20 || input.avoidPatterns.some(item => item.length > 100) || input.examplePhrases.length > 10 || input.examplePhrases.some(item => item.length > 500)) { setFormError('请遵守表达习惯的条数和长度限制'); return; }
    void work(async () => { const response = await api.request<Style>('/me/expression-style', { method: 'PUT', body: input, version: style?.version }); requestReplay.current = { signature: '', key: '' }; setStyle(response.data); setStyleForm(response.data); setDialog(null); setToast('已保存'); }, true);
  }
  function evidence(ref: string) {
    const [type, id] = ref.split(':'); const item = type === 'message' ? messages.find(item => item.messageId === id) : type === 'event' ? events.find(item => item.eventId === id) : preferences.find(item => item.recordId === id);
    return <blockquote className="evidence-item" key={ref}><span>{item ? recordText(item) : '引用已不可用'}</span></blockquote>;
  }

  return <div className="app-shell">
    {mobileNav && <button className="sidebar-mask" aria-label="关闭联系人列表" onClick={() => setMobileNav(false)} />}
    <aside className={'workspace-sidebar ' + (mobileNav ? 'is-open' : '')}>
      <div className="brand">
        <picture className="brand-mark">
          <source media="(max-width: 720px)" srcSet="/brand/betweenly-icon.svg" />
          <img className="brand-logo" src="/brand/betweenly-horizontal.svg" alt="Betweenly · 之间" width="440" height="110" />
        </picture>
      </div>
      <div className="sidebar-content">
        <div className="sidebar-heading"><h2>联系人</h2><button className="icon-button" aria-label="添加联系人" title="添加联系人" disabled={busy} onClick={() => openDialog({ kind: 'contact' })}><Icon name="plus" size={19} /></button></div>
        <div className="contact-search"><Icon name="search" size={16} /><input aria-label="搜索联系人" placeholder="搜索" value={search} onChange={event => setSearch(event.target.value)} /></div>
        <nav className="contact-list" aria-label="联系人">
          {contacts.filter(item => item.label.includes(search)).map((item, index) => <button key={item.contactId} className={'contact-link ' + (contactId === item.contactId ? 'is-selected' : '')} aria-current={contactId === item.contactId ? 'true' : undefined} disabled={busy} onClick={() => chooseContact(item.contactId)}>
            <span className={'contact-avatar tint-' + index % 3}>{item.label.slice(0, 1)}</span><span className="contact-label"><strong>{item.label}</strong><small>{stages[item.relationshipStage]}</small></span>
          </button>)}
          {!loading && contacts.filter(item => item.label.includes(search)).length === 0 && <span className="sidebar-empty">{search ? '无匹配联系人' : '暂无联系人'}</span>}
        </nav>
      </div>
      <div className="sidebar-tools">
        <button className="icon-button" aria-label={theme === 'light' ? '切换深色主题' : '切换浅色主题'} title={theme === 'light' ? '切换深色主题' : '切换浅色主题'} onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}><Icon name={theme === 'light' ? 'moon' : 'sun'} size={21} /></button>
        <button className="icon-button" aria-label="设置" title="设置" disabled={busy} onClick={() => openDialog({ kind: 'settings' })}><Icon name="settings" size={21} /></button>
      </div>
    </aside>

    <div className="workspace-main-shell">
      <header className="workspace-header">
        <button className="icon-button mobile-only" aria-label="打开联系人列表" onClick={() => setMobileNav(true)}><Icon name="menu" size={20} /></button>
        <div className="workspace-title"><div className="contact-title"><h1>{contact?.label ?? 'Betweenly'}</h1>{contact && <button className="icon-button contact-edit" aria-label="修改联系人" title="修改联系人" disabled={busy} onClick={() => openDialog({ kind: 'contact', value: contact })}><Icon name="edit" size={17} /></button>}</div>{contact && <span>{stages[contact.relationshipStage]}</span>}</div>
        <span className={'gateway-status is-' + gatewayState} role="status" aria-label={'Gateway：' + gatewayStates[gatewayState]} title={'Gateway：' + gatewayStates[gatewayState]}><span className="connection-dot" aria-hidden="true" />Gateway</span>
        {contact && <>
          <button className={'icon-button history-toggle ' + (page === 'history' ? 'is-active' : '')} aria-label={page === 'history' ? '返回工作区' : '查看历史建议'} title={page === 'history' ? '返回工作区' : '历史建议'} aria-pressed={page === 'history'} disabled={busy} onClick={() => setPage(page === 'history' ? 'workspace' : 'history')}><Icon name="history" size={21} /></button>
          <ActionMenu label="联系人操作"><button className="danger" disabled={busy} onClick={() => deleteContact(contact)}>删除联系人</button></ActionMenu>
        </>}
        {account && <button type="button" className="workspace-logout" disabled={busy} onClick={() => { void work(account.onLogout, true); }}>Log out</button>}
      </header>

      {error && <div className="error-message" role="alert"><Icon name="info" size={17} /><div><strong>{error.message}</strong><small>{error.code}{error.traceId && ' · ' + error.traceId}</small></div><button className="icon-button" aria-label="重试加载" disabled={busy} onClick={() => setRevision(current => current + 1)}><Icon name="refresh" size={17} /></button><button className="icon-button" aria-label="关闭错误提示" onClick={() => setError(null)}><Icon name="close" size={17} /></button></div>}

      {loading ? <main className="loading-view" role="status"><span className="spinner" /><span>加载中</span></main> : !contact ? <main className="blank-workspace"><Empty title="暂无联系人" icon="users" /></main> : page === 'history' ? <main key={contactId + ":history"} className="history-workspace motion-panel">
        <header className="pane-heading"><h2>历史建议</h2><span>{history.length}</span></header>
        <div className="history-scroll">{contextLoading ? <div className="loading-view" role="status"><span className="spinner" /></div> : history.length === 0 ? <Empty title="暂无历史建议" icon="history" /> : history.map(item => <article className="history-item" key={item.requestId}>
          <button className="history-open" onClick={() => { try { assertAdvice(item, contactId); showResult(item); setPage('workspace'); } catch (cause) { setError(toError(cause)); } }}><span className="history-date">{shortDate(item.createdAt)}</span><strong>{item.affinityAssessment ? '好感度 · ' + (item.affinityAssessment.score === null ? '信息不足' : item.affinityAssessment.score + ' / 100') : item.status === 'OK' ? item.recommendation.title : item.status === 'NEEDS_CONTEXT' ? '待补充背景' : '无法建议'}</strong><span className="history-state">{item.affinityAssessment ? '评估' : { OK: '建议', NEEDS_CONTEXT: '补问', CANNOT_ADVISE: '边界' }[item.status]}</span><Icon name="chevron" size={17} /></button>
          <ActionMenu label="历史建议操作" className="row-menu"><button className="danger" disabled={busy} onClick={() => openDialog({ kind: 'delete', title: '删除这次分析？', detail: '建议与反馈将被删除，原始记录保留。', path: '/advice-requests/' + item.requestId })}>删除</button></ActionMenu>
        </article>)}</div>
      </main> : <main key={contactId + ":workspace"} className="workbench motion-panel">
        <section className="input-pane" aria-label="记录与问题">
          <div className="pane-heading record-heading">
            <h2>记录</h2>
            {contextTab === 'messages' && <div className="record-selection-bar">
              <label className="record-select-all" title={messages.length > 0 && selectedMessages.length === messages.length ? '取消全选' : '全选聊天记录'}>
                <input type="checkbox" aria-label="全选聊天记录" aria-controls="context-records" checked={messages.length > 0 && selectedMessages.length === messages.length} ref={node => { if (node) node.indeterminate = selectedMessages.length > 0 && selectedMessages.length < messages.length; }} disabled={busy || contextLoading || messages.length === 0} onChange={toggleAllMessages} />
              </label>
              <span title={messages.length > 200 ? '单次分析最多 200 条聊天记录' : undefined}>已选 {selectedMessages.length} 条</span>
            </div>}
            <select className="record-filter" aria-label="记录类型" value={contextTab} onChange={event => setContextTab(event.target.value as RecordKind)}><option value="messages">聊天 · {messages.length}</option><option value="events">事件 · {events.length}</option><option value="preference-records">偏好与边界 · {preferences.length}</option></select>
            {contextTab === 'messages' ? <ActionMenu label="添加记录" className="record-import-menu" icon="plus">
              <button disabled={busy || contextLoading} onClick={() => openDialog({ kind: 'record', type: 'messages' })}>添加文字 / 图片</button>
              <button disabled={busy || contextLoading} onClick={() => openDialog({ kind: 'batch' })}>批量导入</button>
              {isDesktop && <button disabled={busy || contextLoading} onClick={() => openDialog({ kind: 'wechat' })}>从微信导入</button>}
            </ActionMenu> : <button className="icon-button" aria-label="添加记录" title="添加记录" disabled={busy || contextLoading} onClick={() => openDialog({ kind: 'record', type: contextTab })}><Icon name="plus" size={19} /></button>}
          </div>
          <div key={contextTab} className={'record-scroll motion-panel' + (contextTab === 'messages' ? ' chat-timeline' : '')} id="context-records">
            {contextLoading ? <div className="loading-view" role="status"><span className="spinner" /></div> : (contextTab === 'messages' ? messages : contextTab === 'events' ? events : preferences).length === 0 ? <Empty title="暂无记录" icon="chat" /> : contextTab === 'messages' ? messages.map((item, index) => {
              const own = item.sender === 'USER';
              const sender = own ? '我' : item.sender === 'OTHER' ? contact.label : '未知发送者';
              const previous = messages[index - 1];
              const showTime = item.sentAt && (!previous?.sentAt || Math.abs(Date.parse(item.sentAt) - Date.parse(previous.sentAt)) >= 5 * 60 * 1000);
              return <div key={item.messageId} className="chat-entry">
                {showTime && <div className="chat-time"><time dateTime={item.sentAt!}>{shortDate(item.sentAt!)}</time></div>}
                <div className={'chat-message' + (own ? ' is-own' : '') + (selected.includes(item.messageId) ? ' is-selected' : '')}>
                  <div className="chat-choice">
                    <input id={'chat-select-' + item.messageId} type="checkbox" aria-label={'选择记录：' + item.text.slice(0, 32)} checked={selected.includes(item.messageId)} onChange={() => toggle(item.messageId)} />
                    <label className="chat-avatar" htmlFor={'chat-select-' + item.messageId}><Icon name="user" size={21} /></label>
                    <div className="chat-content">
                      <div className="chat-sender"><div className="chat-sender-controls"><label className="chat-sender-name" htmlFor={'chat-select-' + item.messageId} title={sender}>{sender}</label><ActionMenu label="记录操作" className="chat-message-menu"><button disabled={busy} onClick={() => openDialog({ kind: 'record', type: 'messages', value: item })}>编辑</button><button className="danger" disabled={busy} onClick={() => deleteMessage(item)}>删除</button></ActionMenu></div></div>
                      <div className="chat-bubble">{item.image && <button type="button" className="chat-photo" aria-label="查看图片" onClick={() => setPhotoPreview(item.image!)}><img src={item.image.dataUrl} alt="聊天图片" loading="lazy" /></button>}{item.text && <label htmlFor={'chat-select-' + item.messageId}>{item.text}</label>}</div>
                    </div>
                  </div>
                </div>
              </div>;
            }) : (contextTab === 'events' ? events : preferences).map(item => <div key={getId(item)} className={'context-record ' + (selected.includes(getId(item)) ? 'is-selected' : '')}>
              <label className="record-choice"><input type="checkbox" aria-label={'选择记录：' + recordText(item).slice(0, 32)} checked={selected.includes(getId(item))} onChange={() => toggle(getId(item))} /><div className="record-body"><div className="record-caption"><strong>{'eventType' in item ? eventTypes[item.eventType] : categories[item.category]}</strong><span>{sources[item.sourceType]}</span>{'occurredAt' in item && item.occurredAt ? <time>{shortDate(item.occurredAt)}</time> : null}{'hardConstraint' in item && item.hardConstraint && <span className="boundary-tag">硬边界</span>}</div><p>{recordText(item)}</p>{'userReflection' in item && item.userReflection && <p className="record-reflection">{item.userReflection}</p>}</div></label>
              <ActionMenu label="记录操作" className="row-menu"><button disabled={busy} onClick={() => openDialog({ kind: 'record', type: contextTab, value: item })}>编辑</button><button className="danger" disabled={busy} onClick={() => openDialog({ kind: 'delete', title: '删除这条记录？', detail: '记录及依赖它的分析将被删除。', path: '/' + contextTab + '/' + getId(item), version: item.version })}>删除</button></ActionMenu>
            </div>)}
          </div>

          <form className="question-composer" onSubmit={event => { event.preventDefault(); analyze(); }}>
            <div className="intent-selects"><label><span>场景</span><select aria-label="场景" value={entry} onChange={event => { const value = event.target.value as Entry; setResult(null); setEntry(value); setGoal(current => current === 'ASSESS_AFFINITY' ? current : value === 'NEW_CONNECTION' ? 'START_CONTACT' : value === 'SPECIFIC_DIFFICULTY' ? 'DECIDE_NEXT_STEP' : 'CONTINUE_CONVERSATION'); }}>{entries.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label><label><span>目标</span><select aria-label="目标" value={goal} onChange={event => { setResult(null); setGoal(event.target.value as Goal); }}>{Object.entries(goals).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div>
            <textarea className="question-input" aria-label="问题" rows={2} maxLength={2000} placeholder="输入问题" value={question} onChange={event => { setResult(null); setQuestion(event.target.value); }} />
            <div className="draft-disclosure" data-open={goal !== 'ASSESS_AFFINITY'} aria-hidden={goal === 'ASSESS_AFFINITY'} inert={goal === 'ASSESS_AFFINITY'}><div><textarea className="draft-input" aria-label="草稿（可选）" rows={1} maxLength={2000} placeholder="草稿（可选）" value={draft} onChange={event => { setResult(null); setDraft(event.target.value); }} /></div></div>
            <div className="composer-footer"><span>{selected.length ? '已选 ' + selected.length + ' 条' : '未选择记录'}</span><button type="submit" className="primary-button" disabled={busy || contextLoading}>{busy ? <span className="spinner" /> : <Icon name="spark" size={17} />}{busy ? goal === 'ASSESS_AFFINITY' ? '评估中' : '生成中' : goal === 'ASSESS_AFFINITY' ? '评估好感度' : '查看建议'}</button></div>
          </form>
        </section>

        <aside className="output-pane" ref={resultRef} aria-label={result?.affinityAssessment || goal === 'ASSESS_AFFINITY' ? '好感度评估' : '建议'} aria-live="polite">
          <div className="pane-heading"><h2>{result?.affinityAssessment || goal === 'ASSESS_AFFINITY' && !result ? '好感度评估' : !result || result.status === 'OK' ? '建议' : result.status === 'NEEDS_CONTEXT' ? '待补充背景' : '无法建议'}</h2>{result && <ActionMenu label="建议操作"><button disabled={busy} onClick={() => openDialog({ kind: 'feedback' })}>反馈</button><button disabled={busy} onClick={() => openDialog({ kind: 'outcome' })}>记录后续</button><button className="danger" disabled={busy} onClick={() => openDialog({ kind: 'delete', title: '删除这次分析？', detail: '建议与反馈将被删除，原始记录保留。', path: '/advice-requests/' + result.requestId })}>删除分析</button></ActionMenu>}</div>
          <div className={'output-scroll ' + (!result ? 'is-empty' : '')}>{!result ? <div className="output-empty"><Icon name="chat" size={34} /><span>{goal === 'ASSESS_AFFINITY' ? '暂无评估' : '暂无建议'}</span></div> : <div key={result.requestId} className="advice-document motion-content">
            {result.affinityAssessment && <AffinityAssessment value={result.affinityAssessment} evidence={evidence} />}
            {result.status === 'OK' ? result.affinityAssessment ? null : <><h3 className="advice-title">{result.recommendation.title}</h3><p className="advice-reason">{result.recommendation.reason}</p>{result.replyOptions.length > 0 && <section className="reply-editor"><label htmlFor="reply-editor">回复</label>{result.replyOptions.length > 1 && <select aria-label="回复候选" value={selectedOption ?? ''} onChange={event => { const reply = result.replyOptions.find(item => item.optionId === event.target.value); if (reply) { setSelectedOption(reply.optionId); setEditedReply(reply.text); } }}>{result.replyOptions.map(reply => <option key={reply.optionId} value={reply.optionId}>{reply.style}</option>)}</select>}<textarea id="reply-editor" aria-label="编辑回复" rows={3} maxLength={1000} value={editedReply} onChange={event => setEditedReply(event.target.value)} /><button className="icon-button copy-button" title="复制回复" aria-label="复制回复" onClick={() => { void navigator.clipboard.writeText(editedReply).then(() => setToast('已复制')).catch(() => setToast('请手动复制')); }}><Icon name="copy" size={17} /></button></section>}{result.draftRevision && <section className="document-section"><h4>草稿调整</h4><p>{result.draftRevision.text}</p><ul>{result.draftRevision.changes.map(item => <li key={item}>{item}</li>)}</ul></section>}<section className="document-section"><h4>依据</h4>{result.recommendation.evidenceRefs.map(evidence)}</section>{result.recommendation.alternatives.length > 0 && <section className="document-section"><h4>其他选择</h4>{result.recommendation.alternatives.map(item => <div className="document-entry" key={item.title}><strong>{item.title}</strong><p>{item.appliesWhen}</p></div>)}</section>}</> : result.status === 'NEEDS_CONTEXT' ? <section className="clarifying-questions">{result.clarifyingQuestions.map(item => <div key={item.question}><h3>{item.question}</h3><p>{item.reason}</p></div>)}</section> : <p className="boundary-message">{result.cannotAdviseReason.message}</p>}
            {!result.affinityAssessment && result.observations.length > 0 && <section className="document-section"><h4>观察</h4>{result.observations.map((item, index) => <p key={index}><span className="observation-kind">{item.kind === 'FACT' ? '事实' : '推测'}</span>{item.statement}</p>)}</section>}
            {(result.uncertainties.length > 0 || !!result.affinityAssessment?.uncertainties.length) && <section className="document-section"><h4>待确认</h4><ul>{[...new Set([...(result.affinityAssessment?.uncertainties ?? []), ...result.uncertainties])].map(item => <li key={item}>{item}</li>)}</ul></section>}
            {result.responseHandling.length > 0 && <section className="document-section"><h4>后续回应</h4>{result.responseHandling.map(item => <p key={item.scenario}><strong>{{ ACCEPTS: '接受', AMBIGUOUS: '不明确', DECLINES: '拒绝', NO_RESPONSE: '未回应' }[item.scenario]}</strong> · {item.guidance}</p>)}</section>}
          </div>}</div>
        </aside>
      </main>}
    </div>

    <footer className="copyright">Betweenly · Copyright © 2026-2027</footer>
    {toast && <div className="toast" role="status"><Icon name="check" size={16} />{toast}</div>}

    <ModalPresence open={dialog !== null}>{dialog && (dialog.kind === 'batch' && contact ? <BatchImportDialog api={api} contact={contact} onClose={closeDialog} onImported={async result => { await refreshContext(); setDialog(null); setToast(result.importedCount ? '已导入 ' + result.importedCount + ' 条' : '相同记录已导入'); }} /> : dialog.kind === 'wechat' && contact ? <WeChatImportDialog api={api} contact={contact} onClose={closeDialog} onImported={async result => { await refreshContext(); setDialog(null); setToast(result.importedCount ? '已导入 ' + result.importedCount + ' 条' : '相同记录已导入'); }} /> : dialog.kind !== 'wechat' && dialog.kind !== 'batch' ? <Modal title={dialog.kind === 'contact' ? dialog.value ? '编辑联系人' : '添加联系人' : dialog.kind === 'record' ? (dialog.value ? '编辑' : '添加') + ({ messages: '聊天记录', events: '事件', 'preference-records': '偏好与边界' }[dialog.type]) : dialog.kind === 'settings' ? '设置' : dialog.kind === 'feedback' ? '反馈' : dialog.kind === 'outcome' ? '记录后续' : dialog.title} onClose={closeDialog} wide={dialog.kind === 'settings'}>
      {dialog.kind === 'settings' && <div className="settings-tabs" data-view={settingsView} role="tablist" aria-label="设置分类" onKeyDown={event => {
        const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End']; if (!keys.includes(event.key) || busy) return;
        event.preventDefault(); const next = event.key === 'Home' ? 'connection' : event.key === 'End' ? 'style' : settingsView === 'connection' ? 'style' : 'connection';
        setFormError(''); setSettingsView(next); event.currentTarget.querySelector<HTMLButtonElement>('#settings-tab-' + next)?.focus();
      }}>{([{ id: 'connection', title: '连接设置' }, { id: 'style', title: '表达习惯' }] as const).map(tab => <button key={tab.id} type="button" role="tab" id={'settings-tab-' + tab.id} aria-selected={settingsView === tab.id} aria-controls={'settings-panel-' + tab.id} tabIndex={settingsView === tab.id ? 0 : -1} disabled={busy} onClick={() => { setFormError(''); setSettingsView(tab.id); }}>{tab.title}</button>)}</div>}
      {dialog.kind === 'settings' && settingsView === 'style' ? <form className="motion-panel" key={JSON.stringify(styleForm)} id="settings-panel-style" role="tabpanel" aria-labelledby="settings-tab-style" onSubmit={saveStyle}>
        <div className="style-learning"><label><input type="checkbox" name="learnFromMessages" defaultChecked={styleForm.learnFromMessages !== false} />自动参考我的历史发言</label>{contact && <small>{writingStyle?.sampleCount ? '当前对话 · ' + writingStyle.sampleCount + ' 条可参考发言' : '当前对话还没有可参考的我的发言'}</small>}</div>
        <div className="form-grid"><Field label="句子长度"><select name="length" defaultValue={styleForm.preferredLength}><option value="SHORT">短句</option><option value="MEDIUM">适中</option><option value="AS_NEEDED">按情况决定</option></select></Field><Field label="表情"><select name="emoji" defaultValue={styleForm.emojiPreference}><option value="AVOID">不用</option><option value="NEUTRAL">无偏好</option><option value="SPARSE">偶尔使用</option></select></Field></div>
        <ToneOptions initial={styleForm.preferredTones} disabled={busy} />
        <Field label="避免的表达" hint="每行一项，最多 20 项，每项 100 字。"><textarea name="avoid" rows={3} maxLength={2019} defaultValue={styleForm.avoidPatterns.join('\n')} /></Field><Field label="我的例句" hint="每行一句，最多 10 句，每句 500 字。"><textarea name="examples" rows={3} maxLength={5009} defaultValue={styleForm.examplePhrases.join('\n')} /></Field>{formError && <p className="form-error" role="alert">{formError}</p>}<Actions busy={busy} label="保存" onClose={closeDialog} />
      </form> : <form className="motion-panel" key={dialog.kind === 'settings' ? 'connection' : dialog.kind} id={dialog.kind === 'settings' ? 'settings-panel-connection' : undefined} role={dialog.kind === 'settings' ? 'tabpanel' : undefined} aria-labelledby={dialog.kind === 'settings' ? 'settings-tab-connection' : undefined} onSubmit={submitDialog}>
        {dialog.kind === 'contact' && <><Field label="称呼"><input name="label" maxLength={64} required autoFocus defaultValue={dialog.value?.label} /></Field><Field label="阶段"><select name="stage" defaultValue={dialog.value?.relationshipStage ?? 'JUST_CONNECTED'}>{Object.entries(stages).map(([key, value]) => <option key={key} value={key}>{value}</option>)}</select></Field><Field label="认识背景"><textarea name="connectionContext" rows={3} maxLength={2000} defaultValue={dialog.value?.connectionContext ?? ''} /></Field><Field label="近况"><textarea name="currentSituation" rows={3} maxLength={2000} defaultValue={dialog.value?.currentSituation ?? ''} /></Field></>}
        {dialog.kind === 'record' && <RecordForm key={dialog.value ? getId(dialog.value) : dialog.type} dialog={dialog} messages={messages} events={events} busy={busy} />}
        {dialog.kind === 'settings' && <>{account && <div className="account-profile"><div><strong>{account.profile.username}</strong><span>{account.profile.email}</span></div></div>}{account && <AccountEmailVerification api={api} email={account.profile.email} verified={account.profile.emailVerified} disabled={busy} onVerified={account.onVerified} />}{!isDesktop && !account && <><Field label="API 地址"><input name="baseUrl" type="url" required defaultValue={settings.baseUrl} /></Field><Field label="开发用户 ID"><input name="devUserId" defaultValue={settings.devUserId} autoComplete="off" spellCheck={false} /></Field><Field label="访问令牌（可选）"><input name="token" type="password" defaultValue={settings.token} autoComplete="off" /></Field></>}<ModelKeyFields api={api} disabled={busy} /></>}
        {dialog.kind === 'feedback' && <><Field label="最终表达"><textarea maxLength={1000} rows={3} value={editedReply} onChange={event => setEditedReply(event.target.value)} /></Field><fieldset className="feedback-flags"><legend>反馈</legend>{Object.entries({ TOO_ROBOTIC: '机械', TOO_SMOOTH: '圆滑', NOT_ME: '不像我', TOO_LONG: '太长', MISREAD_CONTEXT: '背景理解有误', TOO_PUSHY: '太主动', BOUNDARY_RISK: '边界风险', OTHER: '其他' }).map(([key, value]) => <label key={key}><input type="checkbox" name="flags" value={key} />{value}</label>)}</fieldset><Field label="备注"><textarea name="comment" maxLength={1000} rows={2} /></Field></>}
        {dialog.kind === 'outcome' && <><Field label="事件类型"><select name="eventType" defaultValue="USER_ACTION">{Object.entries(eventTypes).map(([key, value]) => <option key={key} value={key}>{value}</option>)}</select></Field><Field label="实际结果"><textarea required name="text" maxLength={2000} rows={4} /></Field><Field label="发生时间（未知留空）"><input name="date" type="datetime-local" /></Field><Field label="我的感受（可选）"><textarea name="userReflection" maxLength={1000} rows={2} /></Field></>}
        {dialog.kind === 'delete' && <><div className="delete-warning"><Icon name="trash" size={25} /><p>{dialog.detail}</p></div>{dialog.requireTextConfirmation !== false && <Field label="输入“删除”确认"><input name="confirmation" required pattern="删除" autoComplete="off" autoFocus /></Field>}</>}
        {formError && <p className="form-error" role="alert">{formError}</p>}<Actions busy={busy} onClose={closeDialog} label={dialog.kind === 'delete' ? '确认删除' : dialog.kind === 'outcome' ? '保存结果' : '保存'} />
      </form>}
    </Modal> : null)}</ModalPresence>
    <ModalPresence open={photoPreview !== null}>{photoPreview && <Modal title="图片" onClose={() => setPhotoPreview(null)} wide><img className="photo-preview" src={photoPreview.dataUrl} alt="聊天图片预览" /></Modal>}</ModalPresence>
  </div>;
}

function toError(cause: unknown): ApiError { return cause instanceof ApiError ? cause : new ApiError(cause instanceof Error ? cause.message : '操作未能完成，请稍后重试'); }
function RecordForm({ dialog, messages, events, busy }: { dialog: Extract<Dialog, { kind: 'record' }>; messages: Message[]; events: Event[]; busy: boolean }) {
  const value = dialog.value; const [category, setCategory] = useState<Category>(value && 'category' in value ? value.category : 'INTEREST');
  const [image, setImage] = useState<MessageImage | null>(value && 'image' in value ? value.image ?? null : null);
  return <>
    {dialog.type === 'messages' && <Field label="这句话是谁说的？"><select name="sender" defaultValue={value && 'sender' in value ? value.sender : 'OTHER'}><option value="OTHER">对方</option><option value="USER">我</option><option value="UNKNOWN">不确定</option></select></Field>}
    {dialog.type === 'events' && <Field label="事件类型"><select name="eventType" defaultValue={value && 'eventType' in value ? value.eventType : 'OTHER'}>{Object.entries(eventTypes).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></Field>}
    {dialog.type === 'preference-records' && <><div className="form-grid"><Field label="这是谁的偏好？"><select name="subject" defaultValue={value && 'subject' in value ? value.subject : 'COUNTERPART'}><option value="COUNTERPART">对方</option><option value="USER">我</option></select></Field><Field label="记录类别"><select name="category" value={category} onChange={event => setCategory(event.target.value as Category)}>{Object.entries(categories).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></Field></div>{category === 'BOUNDARY' && <Field label="明确的边界规则"><select name="boundaryRule" required defaultValue={value && 'boundaryRule' in value ? value.boundaryRule ?? 'OTHER' : 'OTHER'}>{Object.entries(boundaries).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></Field>}</>}
    {dialog.type === 'messages' && <PhotoInput initial={image} disabled={busy} onChange={setImage} />}
    <Field label={dialog.type === 'messages' ? image ? '文字（可选）' : '聊天原文' : dialog.type === 'events' ? '实际发生了什么？' : '具体内容'}><textarea name="text" rows={4} required={!image} maxLength={dialog.type === 'messages' ? 4000 : 2000} defaultValue={value && 'text' in value ? value.text : value ? recordText(value) : ''} placeholder="输入记录内容" /></Field>
    <Field label="内容来源"><select name="sourceType" defaultValue={value?.sourceType ?? (dialog.type === 'messages' ? 'COUNTERPART_EXPLICIT' : 'USER_RELAY')}>{Object.entries(sources).filter(([key]) => dialog.type === 'preference-records' || key !== 'MODEL_INFERENCE').map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></Field>
    {dialog.type !== 'preference-records' && <Field label="原始发生时间（未知请留空）" ><input name="date" type="datetime-local" defaultValue={value && 'sentAt' in value ? localDate(value.sentAt) : value && 'occurredAt' in value ? localDate(value.occurredAt) : ''} /></Field>}
    {dialog.type === 'messages' && <><Field label="原始消息顺序（未知请留空）"><input name="sequenceNo" type="number" min={1} step={1} defaultValue={value && 'sequenceNo' in value ? value.sequenceNo ?? '' : ''} /></Field><label className="check-label"><input type="checkbox" name="isVerbatim" defaultChecked={value && 'isVerbatim' in value ? value.isVerbatim : true} />与聊天界面原文一致（凭记忆复述时请取消，并选择“我的转述”）</label></>}
    {dialog.type === 'events' && <Field label="我的感受或解释（可选）"><textarea name="userReflection" rows={2} maxLength={1000} defaultValue={value && 'userReflection' in value ? value.userReflection ?? '' : ''} /></Field>}
    {dialog.type === 'preference-records' && <><Field label="适用情境（可选）"><input name="appliesWhen" maxLength={1000} defaultValue={value && 'appliesWhen' in value ? value.appliesWhen ?? '' : ''} /></Field>{messages.length + events.length > 0 && <fieldset className="source-refs"><legend>关联的具体依据（可不选，最多 20 条）</legend>{[...messages.map(item => ({ ref: 'message:' + item.messageId, text: item.text })), ...events.map(item => ({ ref: 'event:' + item.eventId, text: item.whatHappened }))].map(item => <label key={item.ref}><input name="sourceRefs" value={item.ref} type="checkbox" defaultChecked={value && 'sourceRefs' in value ? value.sourceRefs.includes(item.ref) : false} />{item.text.slice(0, 50)}</label>)}</fieldset>}</>}
  </>;
}
