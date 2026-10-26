import { useEffect, useRef, useState } from 'react';
import type { EmailChallenge } from './lib/auth.ts';
import { validateEmailChallenge } from './lib/auth.ts';
import type { Transport } from './lib/contracts.ts';

export function VerificationCodeField({ identity, value, error, disabled, send, onChange, onChallenge, onSending }: {
  identity: string; value: string; error?: string; disabled: boolean;
  send: (signal: AbortSignal) => Promise<EmailChallenge>; onChange: (value: string) => void;
  onChallenge: (value: string) => void; onSending?: (sending: boolean) => void;
}) {
  const [sending, setSending] = useState(false), [until, setUntil] = useState(0), [now, setNow] = useState(Date.now());
  const [message, setMessage] = useState(''), [sent, setSent] = useState(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    controller.current?.abort(); setSending(false); onSending?.(false); setUntil(0); setMessage(''); setSent(false); onChallenge(''); onChange('');
    return () => { controller.current?.abort(); onSending?.(false); };
  }, [identity]);
  useEffect(() => { if (!until) return; const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, [until]);
  const remaining = Math.max(0, Math.ceil((until - now) / 1000));
  async function request() {
    if (disabled || sending || remaining) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identity.trim())) { setMessage('请先输入有效的邮箱地址'); return; }
    const active = new AbortController(); controller.current = active; setSending(true); onSending?.(true); setMessage('');
    try {
      const receipt = validateEmailChallenge(await send(active.signal));
      if (!active.signal.aborted) {
        onChallenge(receipt.challengeId); onChange(''); setSent(true);
        const start = Date.now(); setNow(start); setUntil(start + Math.max(1, receipt.retryAfterSeconds) * 1000);
      }
    } catch (cause) { if (!active.signal.aborted) setMessage(cause instanceof Error ? cause.message : '验证码发送失败，请重试'); }
    finally { if (!active.signal.aborted) { setSending(false); onSending?.(false); } }
  }
  return <div className="account-field verification-field">
    <label htmlFor="email-verification-code">邮箱验证码</label>
    <div className="verification-code-row"><input id="email-verification-code" name="verificationCode" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={value} disabled={disabled} aria-invalid={!!error} aria-describedby="email-verification-note" onChange={event => onChange(event.target.value.replace(/\D/g, '').slice(0, 6))} /><button type="button" className="verification-send" disabled={disabled || sending || remaining > 0} onClick={() => { void request(); }}>{sending ? '发送中…' : remaining ? remaining + 's 后重发' : sent ? '重新发送' : '获取验证码'}</button></div>
    <p id="email-verification-note" className="account-field-error" role={error || message ? 'alert' : 'status'}>{error || message}</p>
  </div>;
}

export function AccountEmailVerification({ api, email, verified, disabled, onVerified }: { api: Transport; email: string; verified: boolean; disabled: boolean; onVerified: () => void }) {
  const [open, setOpen] = useState(false), [code, setCode] = useState(''), [challenge, setChallenge] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  if (verified) return <span className="email-verified">邮箱已验证</span>;
  return <div className="email-verification-panel">
    {!open ? <button type="button" className="secondary-button" disabled={disabled} onClick={() => setOpen(true)}>验证邮箱</button> : <>
      <VerificationCodeField identity={email} value={code} error={error} disabled={disabled || busy} onChange={value => { setCode(value); setError(''); }} onChallenge={setChallenge} send={async signal => (await api.request<EmailChallenge>('/auth/email-verification-requests', { method: 'POST', body: {}, signal })).data} />
      <button type="button" className="secondary-button" disabled={disabled || busy || !challenge || code.length !== 6} onClick={() => {
        setBusy(true); setError('');
        void api.request('/auth/email-verifications', { method: 'POST', body: { challengeId: challenge, verificationCode: code } }).then(() => onVerified()).catch(cause => setError(cause instanceof Error ? cause.message : '验证失败，请重试')).finally(() => setBusy(false));
      }}>{busy ? '验证中…' : '确认验证'}</button>
    </>}
  </div>;
}
