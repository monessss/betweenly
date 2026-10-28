import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { Modal } from './components.tsx';
import type { Envelope, Transport } from './lib/contracts.ts';
import { parseChatText } from './lib/text-import.ts';
import { prepareVoiceImport, voiceSituations } from './lib/voice-corpus.ts';
import type { VoiceImportResult, VoiceInput, VoiceSample, VoiceSituation, VoiceStatus } from './lib/voice-corpus.ts';

const root = '/me/voice-corpus';
const message = (e: unknown) => e instanceof Error ? e.message : '操作失败，请重试';
function Situation({ value, onChange }: { value: VoiceSituation; onChange: (v: VoiceSituation) => void }) {
  return <label className="field"><span>适用情境</span><select value={value} onChange={e => onChange(e.target.value as VoiceSituation)}>{Object.entries(voiceSituations).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>;
}

export function VoiceCorpusPanel({ api, onChanged, onBusyChange }: { api: Transport; onChanged: (destructive: boolean) => void; onBusyChange: (busy: boolean) => void }) {
  const [status, setStatus] = useState<VoiceStatus | null>(null), [samples, setSamples] = useState<VoiceSample[]>([]);
  const [cursor, setCursor] = useState<string | null>(null), [raw, setRaw] = useState(''), [format, setFormat] = useState<'lines' | 'chat'>('lines');
  const [ownNickname, setOwnNickname] = useState(''), [situation, setSituation] = useState<VoiceSituation>('GENERAL');
  const [preview, setPreview] = useState<VoiceInput[]>([]), [confirmed, setConfirmed] = useState(false), [busy, setBusy] = useState(false), [loading, setLoading] = useState(true);
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [clearText, setClearText] = useState<string | null>(null), [editing, setEditing] = useState<VoiceSample | null>(null);
  const nicknames = useMemo(() => { if (format !== 'chat' || !raw.trim()) return []; try { return [...new Set(parseChatText(raw).map(m => m.nickname))]; } catch { return []; } }, [raw, format]);
  async function refresh() {
    const [s, p] = await Promise.all([api.request<VoiceStatus>(root), api.request<VoiceSample[]>(root + '/samples?limit=30')]);
    setStatus(s.data); setSamples(p.data); setCursor(p.meta.nextCursor ?? null);
  }
  useEffect(() => { let active = true; setLoading(true); Promise.all([api.request<VoiceStatus>(root), api.request<VoiceSample[]>(root + '/samples?limit=30')]).then(([s, p]) => { if (active) { setStatus(s.data); setSamples(p.data); setCursor(p.meta.nextCursor ?? null); } }).catch(e => { if (active) setError(message(e)); }).finally(() => { if (active) setLoading(false); }); return () => { active = false; }; }, [api]);
  function resetPreview() { setPreview([]); setConfirmed(false); setNotice(''); }
  async function work(action: () => Promise<void>) { setBusy(true); onBusyChange(true); setError(''); setNotice(''); try { await action(); } catch (e) { setError(message(e)); } finally { setBusy(false); onBusyChange(false); } }
  function previewImport(e: FormEvent) { e.preventDefault(); setError(''); setNotice(''); try { const result = prepareVoiceImport(raw, format, ownNickname, situation); setPreview(result.samples); setConfirmed(false); if (result.duplicateCount) setNotice('预览已去除 ' + result.duplicateCount + ' 条重复表达'); } catch (e) { setPreview([]); setError(message(e)); } }
  async function importSamples() {
    if (!confirmed || !preview.length) return;
    await work(async () => {
      let added = 0, duplicate = 0;
      // A failed batch can be safely retried: the server deduplicates saved examples.
      for (let i = 0; i < preview.length; i += 500) {
        let result: Envelope<VoiceImportResult>;
        try { result = await api.request<VoiceImportResult>(root + '/imports', { method: 'POST', body: { confirmedOwnWords: true, samples: preview.slice(i, i + 500) } }); }
        catch (e) { await refresh(); throw new Error('本次已新增 ' + added + ' 条；剩余批次未完成，可重新导入，重复内容会自动跳过。' + message(e)); }
        added += result.data.importedCount; duplicate += result.data.duplicateCount;
        onChanged(false); setNotice('已处理 ' + Math.min(i + 500, preview.length) + ' / ' + preview.length + ' 条');
      }
      await refresh(); setRaw(''); setPreview([]); setConfirmed(false); setNotice('新增 ' + added + ' 条，跳过 ' + duplicate + ' 条重复语料');
    });
  }
  return <div className="voice-panel motion-panel" id="settings-panel-corpus" role="tabpanel" aria-labelledby="settings-tab-corpus" aria-busy={loading || busy}>
    <div className="voice-intro"><strong>让回复更像你</strong><p>导入你平时真实说过的话，生成时会挑选相关样例，参考措辞、标点和节奏。只保存自己的表达，先移除姓名、联系方式及其他隐私。</p><small>{loading ? '正在读取…' : status ? '已保存 ' + status.sampleCount + ' / ' + status.capacity + ' 条 · 在“表达习惯”中可暂停使用' : '语料尚未载入'}</small><p>分析时，最多 8 条选中的表达会发给你配置的生成模型及已启用的复核模型；导入和管理语料不调用模型。</p></div>
    {error && <p className="form-error" role="alert">{error}<button type="button" className="text-button" disabled={busy} onClick={() => void work(refresh)}>重新读取</button></p>}
    {notice && <p className="voice-notice" role="status">{notice}</p>}
    <form onSubmit={previewImport}><fieldset disabled={busy || loading} className="voice-fields">
      <div className="form-grid"><label className="field"><span>导入格式</span><select value={format} onChange={e => { setFormat(e.target.value as 'lines' | 'chat'); setOwnNickname(''); resetPreview(); }}><option value="lines">每行一句自己的话</option><option value="chat">聊天文本（选择自己的昵称）</option></select></label><Situation value={situation} onChange={v => { setSituation(v); resetPreview(); }} /></div>
      <label className="field"><span>粘贴语料，或读取 TXT 文件</span><input type="file" accept=".txt,text/plain" aria-label="读取语料文本文件" onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; if (!file) return; if (file.size > 4_000_000) { setError('文件过大，请拆分为 4MB 以内的 UTF-8 文本'); return; } void work(async () => { const text = await file.text(); if (text.includes('\uFFFD')) throw new Error('文本编码无法识别，请转为 UTF-8 后重试'); setRaw(text); resetPreview(); }); }} /><textarea aria-label="语料文本" rows={5} maxLength={1_000_000} value={raw} onChange={e => { setRaw(e.target.value); resetPreview(); }} placeholder={format === 'lines' ? '行 那你先歇会\n等你有空再说\n我感觉还挺有意思的' : '我\n时间未显示\n行 那你先歇会\n\n朋友\n时间未显示\n好'} /><small>{format === 'chat' ? '格式：昵称 → 时间或“时间未显示” → 正文。只提取你选中昵称的文字。' : '一行一条，单条最多 500 字符；每次最多 10000 条。'} 不会自动导入对方的话。</small></label>
      {format === 'chat' && <label className="field"><span>哪个昵称是你？</span><select value={ownNickname} onChange={e => { setOwnNickname(e.target.value); resetPreview(); }} required><option value="">请选择自己的昵称</option>{nicknames.map(n => <option key={n}>{n}</option>)}</select></label>}
      <button className="secondary-button" disabled={!raw.trim()} type="submit">解析并预览</button>
      {preview.length > 0 && <div className="voice-preview"><strong>待导入 {preview.length} 条 · {voiceSituations[situation]}</strong><ol>{preview.slice(0, 6).map((s, i) => <li key={i}>{s.text}</li>)}</ol>{preview.length > 6 && <small>其余 {preview.length - 6} 条将一同导入</small>}<label className="voice-confirm"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />我确认这些是我自己的表达，已检查并移除不需要保存的隐私</label><button className="primary-button" type="button" disabled={!confirmed} onClick={() => void importSamples()}>导入个人语料库</button></div>}
    </fieldset></form>
    <section className="voice-library"><div className="voice-heading"><h3>已保存的表达</h3>{!!status?.sampleCount && <button className="text-button" disabled={busy} onClick={() => setClearText(clearText === null ? '' : null)}>清空语料库</button>}</div><p className="voice-help">编辑或删除语料后，使用过个人语料的旧建议会从历史中隐藏，避免继续展示旧表达。新增语料不影响旧建议。</p>
      {clearText !== null && <form className="voice-preview" onSubmit={e => { e.preventDefault(); if (clearText === '删除') void work(async () => { await api.request(root, { method: 'DELETE', body: { confirmation: clearText } }); onChanged(true); setClearText(null); setEditing(null); await refresh(); setNotice('个人语料已清空'); }); }}><label className="field"><span>输入“删除”确认清空</span><input value={clearText} onChange={e => setClearText(e.target.value)} disabled={busy} /></label><button className="secondary-button" disabled={busy || clearText !== '删除'}>确认清空</button><button type="button" disabled={busy} className="text-button" onClick={() => setClearText(null)}>取消</button></form>}
      {!samples.length && !loading && <p className="voice-help">还没有语料。可以先导入 30–100 条涵盖不同情境的真实发言。</p>}
      <ul className="voice-list">{samples.map(s => <li key={s.sampleId}>{editing?.sampleId === s.sampleId ? <form onSubmit={e => { e.preventDefault(); void work(async () => { await api.request(root + '/samples/' + s.sampleId, { method: 'PUT', version: s.version, body: { text: editing.text, situation: editing.situation } }); onChanged(true); setEditing(null); await refresh(); setNotice('语料已更新'); }); }}><label className="field"><span>编辑自己的表达</span><textarea maxLength={500} required value={editing.text} onChange={e => setEditing({ ...editing, text: e.target.value })} disabled={busy} /></label><Situation value={editing.situation} onChange={v => setEditing({ ...editing, situation: v })} /><button className="secondary-button" disabled={busy || !editing.text.trim()}>保存修改</button><button className="text-button" type="button" disabled={busy} onClick={() => setEditing(null)}>取消</button></form> : <><p>{s.text}</p><div className="voice-row-actions"><small>{voiceSituations[s.situation]}</small><button className="text-button" disabled={busy} onClick={() => setEditing(s)}>编辑</button><button className="text-button" disabled={busy} onClick={() => void work(async () => { await api.request(root + '/samples/' + s.sampleId, { method: 'DELETE', version: s.version }); onChanged(true); await refresh(); setNotice('语料已删除'); })}>删除</button></div></>}</li>)}</ul>
      {cursor && <button className="secondary-button" disabled={busy} onClick={() => void work(async () => { const page = await api.request<VoiceSample[]>(root + '/samples?limit=30&cursor=' + encodeURIComponent(cursor)); setSamples(old => [...old, ...page.data.filter(s => !old.some(o => o.sampleId === s.sampleId))]); setCursor(page.meta.nextCursor ?? null); })}>加载更多</button>}
    </section>
  </div>;
}

export function SaveVoiceDialog({ api, initialText, onClose, onSaved }: { api: Transport; initialText: string; onClose: () => void; onSaved: () => void }) {
  const [text, setText] = useState(initialText), [situation, setSituation] = useState<VoiceSituation>('GENERAL'), [confirmed, setConfirmed] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  return <Modal title="存入个人语料库" onClose={() => { if (!busy) onClose(); }}><form onSubmit={e => { e.preventDefault(); if (!confirmed || busy) return; setBusy(true); setError(''); api.request(root + '/imports', { method: 'POST', body: { confirmedOwnWords: true, samples: [{ text, situation }] } }).then(onSaved).catch(e => setError(message(e))).finally(() => setBusy(false)); }}><fieldset className="voice-fields" disabled={busy}><label className="field"><span>我确认后的表达</span><textarea maxLength={500} required rows={4} value={text} onChange={e => setText(e.target.value)} /><small>请只保留符合你真实说话方式的部分，最多 500 字符。生成的内容不会自动加入语料库。</small></label><Situation value={situation} onChange={setSituation} /><label className="voice-confirm"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />这句话符合我的表达习惯，可以作为以后的风格参考</label>{error && <p className="form-error" role="alert">{error}</p>}<div className="form-actions"><button className="primary-button" disabled={!confirmed || !text.trim() || text.length > 500}>{busy ? '正在保存…' : '保存语料'}</button></div></fieldset></form></Modal>;
}
