import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Icon } from './components.tsx';
import { AccountClient, validateAuth } from './lib/auth.ts';
import { VerificationCodeField } from './EmailVerification.tsx';
import { AuthEyeIcon } from './AuthEntryIcons.tsx';
import type { AccountProfile, AccountView, AuthErrors, AuthValues, AuthView } from './lib/auth.ts';
import './auth.css';
import './registration.css';

export function AuthPage({ view, client, notice, onNavigate, onAuthenticated }: { view: AuthView; client: AccountClient; notice: string; onNavigate: (view: AccountView) => void; onAuthenticated: (profile: AccountProfile) => void }) {
  const [values, setValues] = useState<AuthValues>({ username: '', email: '', password: '' });
  const [errors, setErrors] = useState<AuthErrors>({});
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [sendingCode, setSendingCode] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark'>(() => { try { return localStorage.getItem('betweenly.theme') === 'dark' ? 'dark' : 'light'; } catch { return 'light'; } });
  const controller = useRef<AbortController | null>(null);
  const form = useRef<HTMLFormElement>(null);
  const register = view === 'register';
  useLayoutEffect(() => {
    document.title = (register ? '注册' : '登录') + ' · Betweenly';
    setErrors({}); setMessage(''); setValues(current => ({ ...current, password: '', verificationCode: '', challengeId: '' })); setRevealed(false); setBusy(false); setSendingCode(false);
    return () => { controller.current?.abort(); };
  }, [register]);
  useEffect(() => { document.documentElement.dataset.theme = theme; try { localStorage.setItem('betweenly.theme', theme); } catch { /* Theme persistence is optional. */ } }, [theme]);
  function update(field: keyof AuthValues, value: string) {
    setValues(current => ({ ...current, [field]: value }));
    setErrors(current => ({ ...current, [field]: undefined })); setMessage('');
  }
  async function submit(event: FormEvent) {
    event.preventDefault(); if (busy || sendingCode) return;
    const next = validateAuth(view, values); setErrors(next); setMessage('');
    if (Object.keys(next).length) { form.current?.querySelector<HTMLInputElement>('[name="' + Object.keys(next)[0] + '"]')?.focus(); return; }
    const active = new AbortController(); controller.current = active; setBusy(true);
    try {
      const profile = await client.signIn(view, values, active.signal);
      if (!active.signal.aborted) { setValues({ username: '', email: '', password: '' }); onAuthenticated(profile); }
    } catch (cause) { if (!active.signal.aborted) setMessage(cause instanceof Error ? cause.message : '暂时无法登录，请稍后重试'); }
    finally { if (!active.signal.aborted) setBusy(false); }
  }
  return <main className={'account-page account-page--' + view}>
    <aside className="account-story" aria-label="Betweenly">
      <img className="account-brand brand-logo" src="/brand/betweenly-horizontal.svg" alt="Betweenly · 之间" width="440" height="110" />
      <div className="account-story-copy"><p>Betweenly · 之间</p><h1>少一点纠结，<br />多一点理解。</h1></div>
      <footer className="account-copyright">Betweenly · Copyright © 2026-2027</footer>
    </aside>
    <section className="account-content" aria-labelledby="account-title">
      <button type="button" className="icon-button account-theme" aria-label={theme === 'light' ? '切换深色主题' : '切换浅色主题'} title={theme === 'light' ? '切换深色主题' : '切换浅色主题'} onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}><Icon name={theme === 'light' ? 'moon' : 'sun'} size={20} /></button>
      <form ref={form} className="account-form" onSubmit={submit} noValidate aria-busy={busy}>
        <header className="account-heading"><p>{register ? '创建账号' : '欢迎回来'}</p><h2 id="account-title">{register ? '注册' : '登录'} Betweenly</h2></header>
        <div key={view} className="account-fields">
          {register && <div className={'account-field' + (errors.username ? ' has-error' : '')}><label htmlFor="account-username">用户名</label><div className={'account-control' + (errors.username ? ' is-invalid' : '')}><input id="account-username" name="username" autoComplete="nickname" maxLength={32} value={values.username} onChange={e => update('username', e.target.value)} disabled={busy} aria-invalid={!!errors.username} aria-describedby={errors.username ? 'account-username-error' : undefined} /></div><p id="account-username-error" className="account-field-error" aria-live="polite">{errors.username}</p></div>}
          <div className={'account-field' + (errors.email ? ' has-error' : '')}><label htmlFor="account-email">邮箱</label><div className={'account-control' + (errors.email ? ' is-invalid' : '')}><input id="account-email" name="email" type={register ? 'email' : 'text'} inputMode={register ? 'email' : 'text'} autoComplete={register ? 'email' : 'username'} maxLength={254} spellCheck={false} autoCapitalize="none" value={values.email} onChange={e => update('email', e.target.value)} disabled={busy} aria-invalid={!!errors.email} aria-describedby={errors.email ? 'account-email-error' : undefined} /></div><p id="account-email-error" className="account-field-error" aria-live="polite">{errors.email}</p></div>
          <div className={'account-field' + (errors.password ? ' has-error' : '')}><label htmlFor="account-password">密码</label><div className={'account-control' + (errors.password ? ' is-invalid' : '')}><input id="account-password" name="password" type={revealed ? 'text' : 'password'} autoComplete={register ? 'new-password' : 'current-password'} minLength={register ? 6 : 1} maxLength={128} value={values.password} onChange={e => update('password', e.target.value)} disabled={busy} aria-invalid={!!errors.password} aria-describedby={errors.password ? 'account-password-error' : register ? 'account-password-help' : undefined} /><button type="button" className="account-reveal" disabled={busy} aria-label={revealed ? '隐藏密码' : '显示密码'} aria-pressed={revealed} onClick={() => setRevealed(value => !value)}>{register ? <AuthEyeIcon /> : <Icon name="eye" size={19} />}</button></div><p id="account-password-error" className="account-field-error" aria-live="polite">{errors.password}</p></div>
        </div>
        {register && <p className="account-field-help" id="account-password-help">至少 6 个字符</p>}
        {register && <VerificationCodeField identity={values.email.trim().toLowerCase()} value={values.verificationCode ?? ''} error={errors.verificationCode} disabled={busy} onSending={setSendingCode} send={signal => client.sendRegistrationCode(values.email, signal)} onChange={value => update('verificationCode', value)} onChallenge={value => setValues(current => ({ ...current, challengeId: value }))} />}
        <button className="account-submit" type="submit" disabled={busy || sendingCode}><span>{busy ? register ? '创建中…' : '登录中…' : register ? '创建账号' : '登录'}</span>{busy ? <span className="spinner" /> : register ? <b aria-hidden="true">→</b> : <Icon name="arrow" size={22} />}</button>
        {message && <p className="account-message" role="alert">{message}</p>}
        {!message && notice && <p className="account-notice" role="status">{notice}</p>}
        <div className={'account-switch' + (!register ? ' account-links' : '')}><span>{register ? '已有账号？' : '还没有账号？'}<a href={register ? '#/login' : '#/register'} aria-disabled={busy} onClick={event => { event.preventDefault(); if (!busy) onNavigate(register ? 'login' : 'register'); }}>{register ? '登录' : '注册'}</a></span>{!register && <a href="#/forgot-password" aria-disabled={busy} onClick={event => { event.preventDefault(); if (!busy) onNavigate('forgot-password'); }}>忘记密码？</a>}</div>
      </form>
    </section>
  </main>;
}
