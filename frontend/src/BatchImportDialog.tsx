import { useRef, useState } from 'react';
import { Icon, Modal } from './components.tsx';
import type { Contact, Sender, Transport } from './lib/contracts.ts';
import { parseChatText } from './lib/text-import.ts';
import type { ParsedChatMessage } from './lib/text-import.ts';
import type { WeChatImportResult } from './lib/wechat-import.ts';

export function BatchImportDialog({ api, contact, onClose, onImported }: { api: Transport; contact: Contact; onClose: () => void; onImported: (result: WeChatImportResult) => Promise<void> }) {
  const [raw, setRaw] = useState('');
  const [messages, setMessages] = useState<ParsedChatMessage[]>([]);
  const [senders, setSenders] = useState<Record<string, Sender | 'SKIP' | ''>>({});
  const [selected, setSelected] = useState<number[]>([]);
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const replay = useRef({ signature: '', id: '' });
  const senderFor = (nickname: string) => Object.hasOwn(senders, nickname) ? senders[nickname] : '';
  const nicknames = [...new Set(messages.map(item => item.nickname))];
  const chosen = messages.filter((item, index) => selected.includes(index) && senderFor(item.nickname) && senderFor(item.nickname) !== 'SKIP');
  const unmapped = messages.some((item, index) => selected.includes(index) && !senderFor(item.nickname));
  function parse() {
    setError('');
    try {
      const parsed = parseChatText(raw);
      setMessages(parsed); setSelected(parsed.map((_, index) => index)); setSenders({}); replay.current = { signature: '', id: '' };
    } catch (cause) { setMessages([]); setError(cause instanceof Error ? cause.message : '解析失败'); }
  }
  async function commit() {
    if (busy || !chosen.length || unmapped) return;
    const payload = chosen.map(item => ({ sender: senders[item.nickname] as Sender, text: item.text, sentAt: item.sentAt }));
    const signature = JSON.stringify(payload);
    if (replay.current.signature !== signature) replay.current = { signature, id: crypto.randomUUID() };
    if (new TextEncoder().encode(JSON.stringify({ importId: replay.current.id, messages: payload })).length > 1_000_000) { setError('本批文本超过上传大小限制，请减少所选消息后再导入'); return; }
    setBusy(true); setError('');
    try {
      const response = await api.request<WeChatImportResult>('/contacts/' + contact.contactId + '/text-imports', { method: 'POST', body: { importId: replay.current.id, messages: payload } });
      await onImported(response.data);
    } catch (cause) { setError(cause instanceof Error ? cause.message : '导入失败，请重试'); }
    finally { setBusy(false); }
  }
  return <Modal title="批量导入" wide onClose={() => { if (!busy) onClose(); }}>
    <div className="wechat-import batch-import">
      <p className="import-instruction">粘贴聊天文本，按“昵称 → 时间 → 正文”识别，每批最多 1000 条。</p>
      <textarea className="batch-import-input" aria-label="批量聊天文本" rows={8} maxLength={1_000_000} disabled={busy} placeholder={'昵称\n2026年10月21日 16:41\n消息正文\n\n另一个昵称\n2026年10月21日 16:42\n回复正文'} value={raw} onChange={event => { setRaw(event.target.value); setMessages([]); setError(''); }} />
      <div className="batch-parse-actions"><span className="import-note">第二行非标准时间按未知处理；明确时间按北京时间（UTC+8）解析。</span><button className="primary-button" disabled={busy || !raw.trim()} onClick={parse}><Icon name="download" size={16} />{messages.length ? '重新解析' : '解析文本'}</button></div>
      {error && <p className="form-error" role="alert">{error}</p>}
      {messages.length > 0 && <div className="import-preview motion-content">
        <div className="import-source"><strong>导入到：{contact.label}</strong><span>识别到 {messages.length} 条</span></div>
        <div className="batch-sender-mapping">{nicknames.map(name => <label className="field" key={name}><span>{name}</span><select aria-label={name + '对应的说话人'} disabled={busy} value={senderFor(name)} onChange={event => setSenders(current => ({ ...current, [name]: event.target.value as Sender | 'SKIP' | '' }))}><option value="">请选择身份</option><option value="USER">我</option><option value="OTHER">对方（{contact.label}）</option><option value="UNKNOWN">未知发送者</option><option value="SKIP">不导入此人的消息</option></select></label>)}</div>
        <div className="batch-preview-heading"><button className="quiet-button" disabled={busy} onClick={() => setSelected(selected.length === messages.length ? [] : messages.map((_, index) => index))}>{selected.length === messages.length ? '取消全选' : '全选'}</button><span>已选 {chosen.length} 条{unmapped ? ' · 请确认说话人身份' : ''}</span></div>
        <div className="import-message-list" aria-label="批量导入预览">{messages.map((message, index) => <article className={'import-message ' + (selected.includes(index) ? 'is-selected' : '')} key={index}>
          <div className="import-message-head"><label><input type="checkbox" disabled={busy} aria-label={'导入第 ' + (index + 1) + ' 条'} checked={selected.includes(index)} onChange={() => setSelected(current => current.includes(index) ? current.filter(id => id !== index) : [...current, index])} /><span>{message.nickname}</span></label>{message.sentAt ? <time dateTime={message.sentAt}>{new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(message.sentAt))}</time> : <span className="batch-unknown-time">时间未显示</span>}</div>
          <p className="batch-preview-text">{message.text}</p>
        </article>)}</div>
        <div className="form-actions"><button className="primary-button" disabled={busy || unmapped || !chosen.length} onClick={() => { void commit(); }}>{busy ? '导入中…' : '导入 ' + chosen.length + ' 条'}</button></div>
      </div>}
    </div>
  </Modal>;
}
