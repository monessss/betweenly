import { useEffect, useRef, useState } from 'react';
import { Icon, Modal } from './components.tsx';
import type { Contact, Transport } from './lib/contracts.ts';
import type { WeChatAssistantStatus, WeChatImportMessage, WeChatImportPreview, WeChatImportResult } from './lib/wechat-import.ts';

export function WeChatImportDialog({ api, contact, onClose, onImported }: { api: Transport; contact: Contact; onClose: () => void; onImported: (result: WeChatImportResult) => Promise<void> }) {
  const [status, setStatus] = useState<WeChatAssistantStatus | null>(null);
  const [preview, setPreview] = useState<WeChatImportPreview | null>(null);
  const [messages, setMessages] = useState<WeChatImportMessage[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [count, setCount] = useState('50'); const [confirmed, setConfirmed] = useState(false);
  const validCount = Number.isInteger(Number(count)) && Number(count) >= 1 && Number(count) <= 100;
  const [busy, setBusy] = useState<'reading' | 'importing' | null>(null); const [error, setError] = useState('');
  const readController = useRef<AbortController | null>(null);
  useEffect(() => () => readController.current?.abort(), []);
  useEffect(() => {
    const controller = new AbortController();
    api.request<WeChatAssistantStatus>('/wechat-import/status', { signal: controller.signal }).then(response => setStatus(response.data)).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '本地助手不可用'); });
    return () => controller.abort();
  }, [api]);
  async function read() {
    if (!validCount || !status?.available) return;
    const controller = new AbortController(); readController.current = controller;
    setBusy('reading'); setError('');
    try {
      const response = await api.request<WeChatImportPreview>('/contacts/' + contact.contactId + '/wechat-imports/preview', { method: 'POST', body: { count: Number(count) }, signal: controller.signal });
      setPreview(response.data); setMessages(response.data.messages); setSelected(response.data.messages.filter(m => m.sender !== 'UNKNOWN' && !m.possibleDuplicate).map(m => m.clientId)); setConfirmed(false);
    } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '读取失败，请重试'); }
    finally { readController.current = null; setBusy(null); }
  }
  async function commit() {
    if (!preview || !confirmed || selected.length === 0) return;
    setBusy('importing'); setError('');
    try {
      const response = await api.request<WeChatImportResult>('/contacts/' + contact.contactId + '/wechat-imports', { method: 'POST', body: { previewId: preview.previewId, conversationConfirmed: confirmed, messages: messages.filter(m => selected.includes(m.clientId)).map(m => ({ clientId: m.clientId, sender: m.sender, text: m.text })) } });
      await onImported(response.data);
    } catch (cause) { setError(cause instanceof Error ? cause.message : '导入失败，请重试'); }
    finally { setBusy(null); }
  }
  function update(id: string, value: Partial<WeChatImportMessage>) { setMessages(current => current.map(message => message.clientId === id ? { ...message, ...value } : message)); }
  return <Modal title="从微信导入" wide onClose={() => { if (busy !== 'importing') { readController.current?.abort(); onClose(); } }}>
    <div className="wechat-import">
      <p className="import-instruction">在运行 Betweenly 桌面版的本机微信中打开对话，仅读取纯文本。</p>
      <div className="import-read-controls"><label className="import-count"><input type="number" aria-label="读取条数" min={1} max={100} step={1} value={count} disabled={!!busy} onChange={event => setCount(event.target.value)} /><span>条</span></label><button className="primary-button" disabled={!!busy || !validCount || !status?.available} onClick={() => { void read(); }}>{busy === 'reading' ? <span className="spinner" /> : <Icon name="download" size={16} />}{busy === 'reading' ? '读取中' : preview ? '重新读取' : '读取微信'}</button></div>
      {!preview && status && <p className="import-note">{status.available ? '微信 ' + (status.version ?? '') + ' · 本机读取' : status.message}</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      {preview && <div className="import-preview motion-content">
        <div className="import-source"><strong>微信会话：{preview.conversationTitle || '未识别到名称'}</strong><span>{messages.length} 条</span></div>
        <p className="import-note">核对原文和说话人；时间未明确显示的保持未知。可能重复或说话人未确认的消息默认不选。</p>
        {preview.warnings.length > 1 && <p className="import-note" role="status">{preview.warnings.slice(1).join(' ')}</p>}
        <div className="import-message-list" aria-label="导入预览">{messages.map((message, index) => <article className={'import-message ' + (selected.includes(message.clientId) ? 'is-selected' : '')} key={message.clientId}>
          <div className="import-message-head"><label><input type="checkbox" aria-label={'导入第 ' + (index + 1) + ' 条'} disabled={!!busy} checked={selected.includes(message.clientId)} onChange={() => setSelected(current => current.includes(message.clientId) ? current.filter(id => id !== message.clientId) : [...current, message.clientId])} /><span>{index + 1}</span></label><select aria-label={'第 ' + (index + 1) + ' 条说话人'} value={message.sender} disabled={!!busy} onChange={event => update(message.clientId, { sender: event.target.value as WeChatImportMessage['sender'] })}><option value="USER">我</option><option value="OTHER">对方</option><option value="UNKNOWN">未确认</option></select>{message.possibleDuplicate && <small>可能重复</small>}</div>
          <textarea aria-label={'第 ' + (index + 1) + ' 条原文'} rows={2} maxLength={4000} disabled={!!busy} value={message.text} onChange={event => update(message.clientId, { text: event.target.value })} />
        </article>)}</div>
        <label className="import-confirm"><input type="checkbox" checked={confirmed} disabled={!!busy} onChange={event => setConfirmed(event.target.checked)} />确认所选记录属于「{contact.label}」</label>
        <div className="form-actions"><button className="primary-button" disabled={!!busy || !confirmed || selected.length === 0 || messages.some(m => selected.includes(m.clientId) && !m.text.trim())} onClick={() => { void commit(); }}>{busy === 'importing' ? '导入中' : '导入 ' + selected.length + ' 条'}</button></div>
      </div>}
    </div>
  </Modal>;
}
