import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Icon } from './components.tsx';
import { AuthEyeIcon } from './AuthEntryIcons.tsx';
import { AccountClient, validatePasswordReset } from './lib/auth.ts';
import type { PasswordResetValues } from './lib/auth.ts';
import './auth.css';

export function ForgotPasswordPage({ client, onLogin, onComplete }: { client: AccountClient; onLogin: () => void; onComplete: () => void }) {
  const [step, setStep] = useState<'request' | 'reset'>('request');
  const [values, setValues] = useState<PasswordResetValues>({ email: '', challengeId: '', verificationCode: '', newPassword: '' });
  const [errors, setErrors] = useState<Partial<Record<keyof PasswordResetValues, string>>>({});
  const [busy, setBusy] = useState<'send' | 'reset' | null>(null), [message, setMessage] = useState(''), [revealed, setRevealed] = useState(false);
  const [until, setUntil] = useState(0), [now, setNow] = useState(Date.now());
  const [theme, setTheme] = useState<'light' | 'dark'>(() => { try { return localStorage.getItem('betweenly.theme') === 'dark' ? 'dark' : 'light'; } catch { return 'light'; } });
  const controller = useRef<AbortController | null>(null), form = useRef<HTMLFormElement>(null);
  const remaining = Math.max(0, Math.ceil((until - now) / 1000));
  useEffect(() => { document.title = '找回密码 · Betweenly'; return () => controller.current?.abort(); }, []);
  useEffect(() => { document.documentElement.dataset.theme = theme; try { localStorage.setItem('betweenly.theme', theme); } catch { /* Optional theme storage. */ } }, [theme]);
  useEffect(() => { if (!until) return; const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, [until]);
  useEffect(() => { if (step === 'reset') form.current?.querySelector<HTMLInputElement>('[name="verificationCode"]')?.focus(); }, [step]);
  function update(field: keyof PasswordResetValues, value: string) { setValues(current => ({ ...current, [field]: value })); setErrors(current => ({ ...current, [field]: undefined })); setMessage(''); }
  async function sendCode() {
    if (busy || remaining) return;
    const email = values.email.trim();
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setErrors({ email: '请输入有效的邮箱地址' }); form.current?.querySelector<HTMLInputElement>('[name="email"]')?.focus(); return; }
    const active = new AbortController(); controller.current = active; setBusy('send'); setMessage(''); setErrors({});
    setValues(current => ({ ...current, challengeId: '', verificationCode: '' }));
    try {
      const receipt = await client.sendPasswordResetCode(email, active.signal);
      if (active.signal.aborted) return;
      setValues(current => ({ ...current, email, challengeId: receipt.challengeId }));
      const start = Date.now(); setNow(start); setUntil(start + receipt.retryAfterSeconds * 1000); setStep('reset');
    } catch (cause) { if (!active.signal.aborted) setMessage(cause instanceof Error ? cause.message : '验证码发送失败，请重试'); }
    finally { if (!active.signal.aborted) setBusy(null); }
  }
  async function submit(event: FormEvent) {
    event.preventDefault(); if (busy) return;
    if (step === 'request') { await sendCode(); return; }
    const next = validatePasswordReset(values); setErrors(next); setMessage('');
    if (Object.keys(next).length) { form.current?.querySelector<HTMLInputElement>('[name="' + Object.keys(next)[0] + '"]')?.focus(); return; }
    const active = new AbortController(); controller.current = active; setBusy('reset');
    try { await client.resetPassword(values, active.signal); if (!active.signal.aborted) { setValues(current => ({ ...current, newPassword: '', verificationCode: '' })); onComplete(); } }
    catch (cause) { if (!active.signal.aborted) setMessage(cause instanceof Error ? cause.message : '密码重置失败，请重试'); }
    finally { if (!active.signal.aborted) setBusy(null); }
  }
  return <main className="account-page account-page--forgot-password">
    <aside className="account-story" aria-label="Betweenly">
      <img className="account-brand brand-logo" src="/brand/betweenly-horizontal.svg" alt="Betweenly · 之间" width="440" height="110" />
      <div className="account-story-copy"><p>Betweenly · 之间</p><h1>少一点纠结，<br />多一点理解。</h1></div>
      <footer className="account-copyright">Betweenly · Copyright © 2026-2027</footer>
    </aside>
    <section className="account-content" aria-labelledby="account-title">
      <button type="button" className="icon-button account-theme" aria-label={theme === 'light' ? '切换深色主题' : '切换浅色主题'} onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}><Icon name={theme === 'light' ? 'moon' : 'sun'} size={20} /></button>
      <form ref={form} className="account-form" noValidate aria-busy={!!busy} onSubmit={event => { void submit(event); }}>
        <header className="account-heading"><p>找回密码</p><h2 id="account-title">{step === 'request' ? '找回你的账户' : '重设密码'}</h2><span className="account-recovery-note">{step === 'request' ? '使用已验证的登录邮箱' : '若邮箱已注册并验证，将收到验证码。'}</span>{step === 'reset' && <span className="account-recovery-email">{values.email}</span>}</header>
        <div key={step} className="account-fields">
          {step === 'request' ? <div className="account-field"><label htmlFor="reset-email">注册邮箱</label><div className={'account-control' + (errors.email ? ' is-invalid' : '')}><input id="reset-email" name="email" type="email" inputMode="email" autoComplete="email" maxLength={254} autoCapitalize="none" spellCheck={false} disabled={!!busy} value={values.email} onChange={event => update('email', event.target.value)} aria-invalid={!!errors.email} aria-describedby="reset-email-error" /></div><p className="account-field-error" id="reset-email-error" aria-live="polite">{errors.email}</p></div> : <>
            <div className="account-field"><label htmlFor="reset-code">验证码</label><div className="verification-code-row"><input id="reset-code" name="verificationCode" inputMode="numeric" autoComplete="one-time-code" maxLength={6} disabled={!!busy} value={values.verificationCode} onChange={event => update('verificationCode', event.target.value.replace(/\D/g, '').slice(0, 6))} aria-invalid={!!errors.verificationCode} aria-describedby="reset-code-error" /><button className="verification-send" type="button" disabled={!!busy || remaining > 0} onClick={() => { void sendCode(); }}>{busy === 'send' ? '发送中…' : remaining ? remaining + 's 后重发' : '重新发送'}</button></div><p className="account-field-error" id="reset-code-error" aria-live="polite">{errors.verificationCode}</p></div>
            <div className="account-field"><label htmlFor="reset-password">新密码</label><div className={'account-control' + (errors.newPassword ? ' is-invalid' : '')}><input id="reset-password" name="newPassword" type={revealed ? 'text' : 'password'} autoComplete="new-password" minLength={6} maxLength={128} placeholder="至少 6 个字符" disabled={!!busy} value={values.newPassword} onChange={event => update('newPassword', event.target.value)} aria-invalid={!!errors.newPassword} aria-describedby="reset-password-error" /><button className="account-reveal" type="button" disabled={!!busy} aria-label={revealed ? '隐藏密码' : '显示密码'} aria-pressed={revealed} onClick={() => setRevealed(value => !value)}><AuthEyeIcon /></button></div><p className="account-field-error" id="reset-password-error" aria-live="polite">{errors.newPassword}</p></div>
          </>}
        </div>
        <button className="account-submit" type="submit" disabled={!!busy}><span>{busy === 'send' ? '发送中…' : busy === 'reset' ? '重设中…' : step === 'request' ? '发送验证码' : '确认重设密码'}</span>{busy ? <span className="spinner" /> : <Icon name="arrow" size={22} />}</button>
        {message && <p className="account-message" role="alert">{message}</p>}
        <p className="account-switch"><a className="account-back" href="#/login" onClick={event => { event.preventDefault(); controller.current?.abort(); onLogin(); }}>返回登录</a></p>
      </form>
    </section>
  </main>;
}
