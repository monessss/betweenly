import { ApiError, GatewayApi, isUuid } from './api.ts';
import type { Envelope, RequestOptions, Settings, Transport } from './contracts.ts';

export type AuthView = 'login' | 'register';
export type AccountView = AuthView | 'forgot-password';
export interface AccountProfile { userId: string; email: string; username: string; emailVerified: boolean; role: 'USER' | 'ADMIN' }
export interface AuthValues { username: string; email: string; password: string; verificationCode?: string; challengeId?: string }
export interface EmailChallenge { challengeId: string; expiresAt: string; retryAfterSeconds: number }
export interface PasswordResetValues { email: string; challengeId: string; verificationCode: string; newPassword: string }
export function validatePasswordReset(values: PasswordResetValues) {
  const checked = validateAuth('register', { username: 'unused', email: values.email, password: values.newPassword, challengeId: values.challengeId, verificationCode: values.verificationCode });
  return { ...(checked.email ? { email: checked.email } : {}), ...(checked.password ? { newPassword: checked.password } : {}), ...(checked.verificationCode ? { verificationCode: checked.verificationCode } : {}) };
}
export function validateEmailChallenge(value: EmailChallenge): EmailChallenge {
  if (!value || !isUuid(value.challengeId) || !Number.isFinite(Date.parse(value.expiresAt)) || !Number.isInteger(value.retryAfterSeconds) || value.retryAfterSeconds < 1 || value.retryAfterSeconds > 900) throw new ApiError('验证码响应格式无效，请重试', 'RESPONSE_INVALID');
  return value;
}
export type AuthErrors = Partial<Record<keyof AuthValues, string>>;
interface Tokens { accessToken: string; refreshToken: string; tokenType: 'Bearer'; expiresInSeconds: number }
interface AccountSession { session: { sessionId: string; userId: string; createdAt: string; expiresAt: string }; tokens: Tokens }

export function validateAuth(view: AuthView, values: AuthValues): AuthErrors {
  const errors: AuthErrors = {};
  const username = values.username.trim().normalize('NFKC');
  if (view === 'register' && (username.length < 2 || username.length > 32 || !/^[\p{L}\p{N}_.-]+$/u.test(username))) errors.username = '用户名需为 2–32 位汉字、字母、数字、下划线、点或连字符';
  const email = values.email.trim();
  if (view === 'register' || email.includes('@')) {
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.email = '请输入有效的邮箱地址';
  } else if (email.normalize('NFKC').length < 2 || email.normalize('NFKC').length > 32 || !/^[\p{L}\p{N}_.-]+$/u.test(email.normalize('NFKC'))) errors.email = '请输入邮箱或用户名';
  if (!values.password) errors.password = '请输入密码';
  else if (values.password.length > 128 || /[\u0000-\u001f\u007f-\u009f]/.test(values.password)) errors.password = '密码格式无效';
  else if (view === 'register' && values.password.length < 6) errors.password = '密码至少 6 个字符';
  if (view === 'register') {
    if (!/^\d{6}$/.test(values.verificationCode ?? '')) errors.verificationCode = '请输入 6 位邮箱验证码';
    else if (!isUuid(values.challengeId ?? '')) errors.verificationCode = '请先获取邮箱验证码';
  }
  return errors;
}

function validTokens(value: unknown): value is Tokens {
  if (!value || typeof value !== 'object') return false;
  const tokens = value as Tokens;
  return tokens.tokenType === 'Bearer' && typeof tokens.accessToken === 'string' && /^[A-Za-z0-9_-]{43}$/.test(tokens.accessToken)
    && typeof tokens.refreshToken === 'string' && /^[A-Za-z0-9_-]{43}$/.test(tokens.refreshToken)
    && Number.isInteger(tokens.expiresInSeconds) && tokens.expiresInSeconds > 0 && tokens.expiresInSeconds <= 86400;
}

// Credentials and both rotating tokens stay in memory. Reloading requires sign-in.
export class AccountClient implements Transport {
  private session: AccountSession | null = null;
  private expiresAt = 0;
  private refreshing: Promise<void> | null = null;
  private generation = 0;
  private readonly settings: Settings;
  private readonly onExpired: () => void;
  constructor(baseUrl: string, onExpired: () => void = () => {}) { this.settings = { baseUrl, devUserId: '', token: '' }; this.onExpired = onExpired; }
  get userId() { return this.session?.session.userId ?? ''; }
  private raw() { return new GatewayApi(this.settings); }
  private clear() { this.generation++; this.session = null; this.expiresAt = 0; }

  async sendRegistrationCode(email: string, signal?: AbortSignal): Promise<EmailChallenge> {
    return validateEmailChallenge((await this.raw().request<EmailChallenge>('/auth/registration-codes', { method: 'POST', anonymous: true, body: { email: email.trim() }, signal })).data);
  }

  async sendPasswordResetCode(email: string, signal?: AbortSignal): Promise<EmailChallenge> {
    return validateEmailChallenge((await this.raw().request<EmailChallenge>('/auth/password-reset-codes', { method: 'POST', anonymous: true, body: { email: email.trim() }, signal })).data);
  }

  async resetPassword(values: PasswordResetValues, signal?: AbortSignal): Promise<void> {
    if (Object.keys(validatePasswordReset(values)).length) throw new ApiError('请检查邮箱、验证码和新密码', 'VALIDATION_ERROR');
    await this.raw().request('/auth/password-resets', { method: 'POST', anonymous: true, body: { email: values.email.trim(), challengeId: values.challengeId, verificationCode: values.verificationCode, newPassword: values.newPassword }, signal });
    this.clear();
  }

  async signIn(view: AuthView, values: AuthValues, signal?: AbortSignal): Promise<AccountProfile> {
    if (Object.keys(validateAuth(view, values)).length) throw new ApiError('请检查邮箱、用户名和密码', 'VALIDATION_ERROR');
    const body = { email: values.email.trim(), password: values.password, deviceName: 'Betweenly Web', ...(view === 'register' ? { username: values.username.trim().normalize('NFKC'), challengeId: values.challengeId, verificationCode: values.verificationCode } : {}) };
    const response = await this.raw().request<AccountSession>(view === 'register' ? '/auth/registrations' : '/auth/sessions', { method: 'POST', anonymous: true, body, signal });
    const value = response.data;
    if (!value?.session || !isUuid(value.session.sessionId) || !isUuid(value.session.userId) || !Number.isFinite(Date.parse(value.session.expiresAt)) || !validTokens(value.tokens)) throw new ApiError('登录响应格式无效，请重试', 'RESPONSE_INVALID');
    this.session = value; this.expiresAt = Date.now() + value.tokens.expiresInSeconds * 1000; this.generation++;
    try {
      const profile = (await this.request<AccountProfile>('/auth/account', { signal })).data;
      if (profile?.userId !== value.session.userId || typeof profile.username !== 'string' || typeof profile.email !== 'string' || !['USER', 'ADMIN'].includes(profile.role)) throw new ApiError('账号资料响应无效', 'RESPONSE_INVALID');
      return profile;
    } catch (cause) { this.clear(); throw cause; }
  }

  private async freshToken(): Promise<string> {
    if (!this.session) throw new ApiError('请先登录', 'AUTH_REQUIRED', '', 401);
    if (this.expiresAt - Date.now() <= 30000) {
      if (!this.refreshing) {
        const generation = this.generation, refreshToken = this.session.tokens.refreshToken;
        this.refreshing = (async () => {
          try {
            // Refresh is single-flight and never retried: consumed tokens cannot be replayed.
            const response = await this.raw().request<Tokens>('/auth/tokens', { method: 'POST', anonymous: true, body: { refreshToken } });
            if (!validTokens(response.data)) throw new ApiError('会话刷新响应无效', 'RESPONSE_INVALID');
            if (generation !== this.generation || !this.session) throw new ApiError('会话已结束', 'AUTH_REQUIRED', '', 401);
            this.session = { ...this.session, tokens: response.data };
            this.expiresAt = Date.now() + response.data.expiresInSeconds * 1000;
          } catch (cause) { if (generation === this.generation) { this.clear(); this.onExpired(); } throw cause; }
          finally { this.refreshing = null; }
        })();
      }
      await this.refreshing;
    }
    if (!this.session) throw new ApiError('请重新登录', 'AUTH_REQUIRED', '', 401);
    return this.session.tokens.accessToken;
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<Envelope<T>> {
    const token = await this.freshToken();
    try { return await new GatewayApi({ ...this.settings, token }).request<T>(path, { ...options, anonymous: false }); }
    catch (cause) { if (cause instanceof ApiError && cause.status === 401 && this.session?.tokens.accessToken === token) { this.clear(); this.onExpired(); } throw cause; }
  }

  async logout() { try { if (this.session) await this.request('/auth/logout', { method: 'POST' }); } finally { this.clear(); } }
}
