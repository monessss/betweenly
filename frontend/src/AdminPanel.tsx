import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Icon, Modal } from './components.tsx';
import type { AccountProfile } from './lib/auth.ts';
import type { Transport } from './lib/contracts.ts';
import { banUser, deleteUser, listUsers, newPasswordError, resetUserPassword, unbanUser, userDetail } from './lib/admin.ts';
import type { AdminUser, UserPage } from './lib/admin.ts';
import './admin.css';

function date(value: string) { return new Date(value).toLocaleString('zh-CN'); }
export function AdminPanel({ api, profile, onLogout, onSelfReset }: { api: Transport; profile: AccountProfile; onLogout: () => Promise<void>; onSelfReset: () => Promise<void> }) {
  const [theme, setTheme] = useState<'light' | 'dark'>(() => { try { return localStorage.getItem('betweenly.theme') === 'dark' ? 'dark' : 'light'; } catch { return 'light'; } });
  const [draft, setDraft] = useState(''), [query, setQuery] = useState(''), [page, setPage] = useState(1), [revision, setRevision] = useState(0);
  const [result, setResult] = useState<UserPage | null>(null), [loading, setLoading] = useState(true), [error, setError] = useState('');
  const [selected, setSelected] = useState<AdminUser | null>(null), [detail, setDetail] = useState<AdminUser | null>(null), [detailLoading, setDetailLoading] = useState(false);
  const [password, setPassword] = useState(''), [revealed, setRevealed] = useState(false), [saving, setSaving] = useState(false), [dialogError, setDialogError] = useState(''), [notice, setNotice] = useState('');
  const [dialogPage, setDialogPage] = useState<'profile' | 'access'>('profile');
  const [duration, setDuration] = useState('1440'), [confirmDelete, setConfirmDelete] = useState(false);
  const current = detail ?? selected;
  const detailRequest = useRef<AbortController | null>(null);
  useEffect(() => { document.title = '用户管理 · Betweenly'; return () => detailRequest.current?.abort(); }, []);
  useEffect(() => { document.documentElement.dataset.theme = theme; try { localStorage.setItem('betweenly.theme', theme); } catch { /* Optional theme storage. */ } }, [theme]);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError(''); setResult(null);
    listUsers(api, query, page, controller.signal).then(value => { if (!controller.signal.aborted) setResult(value); }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '用户列表加载失败'); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [api, query, page, revision]);
  function open(row: AdminUser) {
    detailRequest.current?.abort(); const controller = new AbortController(); detailRequest.current = controller;
    setSelected(row); setDetail(null); setPassword(''); setRevealed(false); setDialogError(''); setDetailLoading(true); setNotice(''); setDialogPage('profile'); setDuration('1440'); setConfirmDelete(false);
    userDetail(api, row.userId, controller.signal).then(value => { if (!controller.signal.aborted) setDetail(value); }).catch(cause => { if (!controller.signal.aborted) setDialogError(cause instanceof Error ? cause.message : '资料加载失败'); }).finally(() => { if (!controller.signal.aborted) setDetailLoading(false); });
  }
  function close() { if (saving) return; detailRequest.current?.abort(); setSelected(null); setPassword(''); setRevealed(false); }
  async function save() {
    if (!selected || !detail || saving) return;
    const validation = newPasswordError(password); if (validation) { setDialogError(validation); return; }
    setSaving(true); setDialogError('');
    try {
      await resetUserPassword(api, selected.userId, password); setPassword(''); setSelected(null);
      if (selected.userId === profile.userId) await onSelfReset();
      else { setNotice('密码已更新，该用户的旧会话已失效'); setRevision(value => value + 1); }
    } catch (cause) { setDialogError(cause instanceof Error ? cause.message : '密码重置失败'); }
    finally { setSaving(false); }
  }
  async function changeAccess(action: 'ban' | 'unban' | 'delete') {
    if (!selected || !detail || saving || selected.userId === profile.userId) return;
    setSaving(true); setDialogError('');
    try {
      if (action === 'ban') await banUser(api, selected.userId, duration === 'permanent' ? null : Number(duration));
      else if (action === 'unban') await unbanUser(api, selected.userId);
      else await deleteUser(api, selected.userId);
      setSelected(null); setPassword(''); setConfirmDelete(false);
      setNotice(action === 'ban' ? '用户已封禁，旧会话已失效' : action === 'unban' ? '用户已解封，可重新登录' : '用户已删除');
      if (action === 'delete' && page > 1 && result?.items.length === 1) setPage(value => value - 1);
      else setRevision(value => value + 1);
    } catch (cause) { setDialogError(cause instanceof Error ? cause.message : '操作失败，请重试'); }
    finally { setSaving(false); }
  }
  function switchDialog(next: 'profile' | 'access') { if (!saving) { setDialogError(''); setConfirmDelete(false); setDialogPage(next); } }
  return <main className="admin-page">
    <header className="admin-header"><img className="brand-logo" src="/brand/betweenly-horizontal.svg" alt="Betweenly · 之间" width="224" height="56" /><div className="admin-header-actions"><span>{profile.username}</span><button className="icon-button" aria-label={theme === 'light' ? '切换深色主题' : '切换浅色主题'} onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}><Icon name={theme === 'light' ? 'moon' : 'sun'} size={19} /></button><button className="secondary-button" onClick={() => { void onLogout(); }}>Log out</button></div></header>
    <section className="admin-content" aria-labelledby="admin-title">
      <div className="admin-toolbar"><div><h1 id="admin-title">用户管理</h1><span>{result ? result.total + ' 位用户' : '管理员'}</span></div><form className="admin-search" role="search" onSubmit={event => { event.preventDefault(); setPage(1); setQuery(draft.trim()); setRevision(value => value + 1); }}><input aria-label="搜索用户" placeholder="搜索用户名或邮箱" maxLength={100} value={draft} onChange={event => setDraft(event.target.value)} /><button className="icon-button" aria-label="搜索"><Icon name="search" size={19} /></button></form></div>
      {notice && <p className="admin-notice" role="status">{notice}</p>}
      {error && <div className="admin-error" role="alert">{error}<button className="secondary-button" onClick={() => setRevision(value => value + 1)}>重试</button></div>}
      <div className="admin-table-wrap" aria-busy={loading}><table className="admin-table"><thead><tr><th>用户名</th><th>邮箱</th><th>身份</th><th>状态</th><th>邮箱验证</th><th>注册时间</th><th><span className="sr-only">操作</span></th></tr></thead><tbody>
        {loading ? <tr><td colSpan={7} className="admin-empty">加载中…</td></tr> : !result?.items.length ? <tr><td colSpan={7} className="admin-empty">{error ? '加载失败' : '暂无用户'}</td></tr> : result.items.map(row => <tr key={row.userId}><td><strong>{row.username}</strong></td><td>{row.email}</td><td><span className={'admin-role' + (row.role === 'ADMIN' ? ' is-admin' : '')}>{row.role === 'ADMIN' ? '管理员' : '用户'}</span></td><td><span className={row.status === 'BANNED' ? 'admin-banned' : ''}>{row.status === 'BANNED' ? '已封禁' : row.status === 'PROVISIONING' ? '待完成注册' : '正常'}</span></td><td>{row.emailVerified ? '已验证' : '未验证'}</td><td className="admin-date">{date(row.createdAt)}</td><td><button className="admin-text-button" onClick={() => open(row)} aria-label={'管理用户 ' + row.username}>管理</button></td></tr>)}
      </tbody></table></div>
      {result && result.total > result.pageSize && <nav className="admin-pagination" aria-label="用户分页"><button className="secondary-button" disabled={page <= 1 || loading} onClick={() => setPage(value => value - 1)}>上一页</button><span>{page} / {Math.max(1, Math.ceil(result.total / result.pageSize))}</span><button className="secondary-button" disabled={page * result.pageSize >= result.total || loading} onClick={() => setPage(value => value + 1)}>下一页</button></nav>}
    </section>
    <footer className="admin-footer">Betweenly · Copyright © 2026-2027</footer>
    {selected && <Modal title={dialogPage === 'profile' ? selected.username : '账号管理'} onClose={close}>
      <AdminDialogPages page={dialogPage} profile={<>
      <dl className="admin-user-details"><div><dt>邮箱</dt><dd>{selected.email}</dd></div><div><dt>用户 ID</dt><dd>{selected.userId}</dd></div><div><dt>身份</dt><dd>{selected.role === 'ADMIN' ? '管理员' : '用户'}</dd></div><div><dt>邮箱验证</dt><dd>{selected.emailVerified ? '已验证' : '未验证'}</dd></div><div><dt>注册时间</dt><dd>{date(selected.createdAt)}</dd></div><div><dt>有效会话</dt><dd>{detailLoading ? '加载中…' : detail?.activeSessions ?? '—'}</dd></div></dl>
      <form onSubmit={event => { event.preventDefault(); void save(); }}><label className="admin-password-label" htmlFor="admin-new-password">重置密码</label><div className="admin-password-control"><input id="admin-new-password" type={revealed ? 'text' : 'password'} autoComplete="new-password" minLength={6} maxLength={128} placeholder="新密码，至少 6 个字符" disabled={saving || detailLoading || !detail} value={password} onChange={event => { setPassword(event.target.value); setDialogError(''); }} /><button type="button" className="icon-button" disabled={saving} aria-label={revealed ? '隐藏密码' : '显示密码'} aria-pressed={revealed} onClick={() => setRevealed(value => !value)}><Icon name="eye" size={18} /></button></div><div className="admin-dialog-actions"><button className="primary-button" type="submit" disabled={saving || detailLoading || !detail || !password}>{saving ? '处理中…' : '更新密码'}</button></div></form>
      {selected.userId !== profile.userId && <div className="admin-account-entry"><button type="button" className="admin-text-button" disabled={saving || detailLoading || !detail} onClick={() => switchDialog('access')}>账号管理<Icon name="chevron" size={16} /></button></div>}
      {dialogPage === 'profile' && dialogError && <p className="admin-dialog-error" role="alert">{dialogError}</p>}
      </>} access={<>
        <button className="admin-dialog-back" type="button" disabled={saving} onClick={() => switchDialog('profile')}><Icon name="arrow" size={16} />返回用户资料</button>
        <div className="admin-dialog-user"><strong>{selected.username}</strong><span>{selected.email}</span>{current?.status === 'BANNED' && <small className="admin-banned">{current.banExpiresAt ? '解封时间：' + date(current.banExpiresAt) : '永久封禁'}</small>}</div>
        <section className="admin-access" aria-label="封禁管理">
          {current?.status === 'BANNED' ? <button className="secondary-button" disabled={saving || detailLoading || !detail} onClick={() => { void changeAccess('unban'); }}>解封用户</button> : <><label className="admin-password-label" htmlFor="admin-ban-duration">封禁时长</label><div className="admin-ban-row"><select id="admin-ban-duration" disabled={saving || detailLoading || !detail} value={duration} onChange={event => setDuration(event.target.value)}><option value="60">1 小时</option><option value="1440">1 天</option><option value="4320">3 天</option><option value="10080">7 天</option><option value="43200">30 天</option><option value="permanent">永久</option></select><button className="secondary-button" disabled={saving || detailLoading || !detail} onClick={() => { void changeAccess('ban'); }}>{saving ? '处理中…' : '封禁用户'}</button></div></>}
          <div className="admin-delete-zone">{!confirmDelete ? <button className="admin-danger-button" disabled={saving || detailLoading || !detail} onClick={() => { setConfirmDelete(true); setDialogError(''); }}>删除用户</button> : <><p>删除后账号将从列表移除并禁止登录，历史数据保留。</p><div><button className="secondary-button" disabled={saving} onClick={() => setConfirmDelete(false)}>取消</button><button className="admin-danger-button is-confirm" disabled={saving} onClick={() => { void changeAccess('delete'); }}>{saving ? '处理中…' : '确认删除'}</button></div></>}</div>
        </section>
        {dialogPage === 'access' && dialogError && <p className="admin-dialog-error" role="alert">{dialogError}</p>}
      </>} />
    </Modal>}
  </main>;
}

function AdminDialogPages({ page, profile, access }: { page: 'profile' | 'access'; profile: ReactNode; access: ReactNode }) {
  const profileRef = useRef<HTMLDivElement>(null), accessRef = useRef<HTMLDivElement>(null);
  const previousPage = useRef(page);
  const [height, setHeight] = useState(0);
  useLayoutEffect(() => {
    const active = (page === 'profile' ? profileRef : accessRef).current;
    if (!active) return;
    const measure = () => setHeight(active.getBoundingClientRect().height);
    if (previousPage.current !== page) {
      active.querySelector<HTMLButtonElement>(page === 'access' ? '.admin-dialog-back' : '.admin-account-entry button')?.focus({ preventScroll: true });
      previousPage.current = page;
    }
    measure(); const observer = new ResizeObserver(measure); observer.observe(active);
    return () => observer.disconnect();
  }, [page]);
  return <div className="admin-dialog-stage" style={{ height }}>
    <div ref={profileRef} className={'admin-dialog-panel admin-dialog-profile' + (page === 'profile' ? ' is-active' : '')} inert={page !== 'profile'} aria-hidden={page !== 'profile'}>{profile}</div>
    <div ref={accessRef} className={'admin-dialog-panel admin-dialog-access' + (page === 'access' ? ' is-active' : '')} inert={page !== 'access'} aria-hidden={page !== 'access'}>{access}</div>
  </div>;
}
