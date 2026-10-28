import { useEffect, useState } from 'react';
import App from './App.tsx';
import { AuthPage } from './AuthPage.tsx';
import { ForgotPasswordPage } from './ForgotPasswordPage.tsx';
import { AdminPanel } from './AdminPanel.tsx';
import { AccountClient } from './lib/auth.ts';
import type { AccountProfile, AccountView } from './lib/auth.ts';
import { defaultSettings, isDesktop } from './lib/settings.ts';

function authView(): AccountView { return window.location.hash === '#/register' ? 'register' : window.location.hash === '#/forgot-password' ? 'forgot-password' : 'login'; }

export default function BetweenlyRoot() {
  const [view, setView] = useState<AccountView>(authView);
  const [profile, setProfile] = useState<AccountProfile | null>(null);
  const [notice, setNotice] = useState('');
  const [client] = useState(() => new AccountClient(defaultSettings.baseUrl, () => { setProfile(null); setNotice('会话已失效，请重新登录'); if (!isDesktop) window.location.hash = '/login'; }));
  useEffect(() => {
    const changed = () => setView(authView());
    window.addEventListener('hashchange', changed);
    return () => window.removeEventListener('hashchange', changed);
  }, []);
  function navigate(next: AccountView) { setNotice(''); setView(next); window.location.hash = '/' + next; }
  async function logout() {
    let message = '已退出登录';
    try { await client.logout(); } catch { message = '已清除当前页面的登录状态'; }
    setProfile(null); setNotice(message); setView('login'); window.location.hash = '/login';
  }
  // Explicit local development mode; production builds always retain login.
  const localMvp = import.meta.env.DEV && import.meta.env.VITE_LOCAL_MVP === '1' && ['127.0.0.1', 'localhost', '[::1]'].includes(window.location.hostname);
  if (isDesktop || localMvp) return <App />;
  if (!profile && view === 'forgot-password') return <ForgotPasswordPage client={client} onLogin={() => navigate('login')} onComplete={() => { navigate('login'); setNotice('密码已更新，请使用新密码登录'); }} />;
  if (!profile) return <AuthPage view={view === 'register' ? 'register' : 'login'} client={client} notice={notice} onNavigate={navigate} onAuthenticated={account => { setProfile(account); setNotice(''); window.location.hash = account.role === 'ADMIN' ? '/admin' : '/workspace'; document.title = 'Betweenly · 之间'; }} />;
  if (profile.role === 'ADMIN') return <AdminPanel api={client} profile={profile} onLogout={logout} onSelfReset={async () => { await logout(); setNotice('密码已更新，请重新登录'); }} />;
  return <App account={{ api: client, profile, onVerified: () => setProfile(current => current ? { ...current, emailVerified: true } : null), onLogout: logout }} />;
}
