import type { Settings } from './contracts.ts';

export const isDesktop = typeof window !== 'undefined' && window.location.protocol === 'betweenly:';
const apiOrigin = isDesktop ? 'betweenly://app' : typeof window === 'undefined' ? 'http://127.0.0.1:3000' : window.location.origin;
export const defaultSettings: Settings = { baseUrl: apiOrigin + '/api/v1', devUserId: '7bc4918a-9079-4ea2-9e8e-369ad79a9f20', token: '' };

// Migrate previous settings, including demo mode, without restoring a persisted token.
export function restoreSettings(raw: string | null): Settings {
  if (isDesktop) return { ...defaultSettings };
  try {
    const stored: unknown = JSON.parse(raw ?? '{}');
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return { ...defaultSettings };
    const value = stored as Record<string, unknown>;
    // Move the previous local Gateway default behind the frontend proxy.
    if (typeof value.baseUrl === 'string' && /^http:\/\/(127\.0\.0\.1|localhost):5080\/api\/v1\/?$/.test(value.baseUrl)) value.baseUrl = defaultSettings.baseUrl;
    return { baseUrl: typeof value.baseUrl === 'string' ? value.baseUrl : defaultSettings.baseUrl, devUserId: typeof value.devUserId === 'string' ? value.devUserId : defaultSettings.devUserId, token: '' };
  } catch { return { ...defaultSettings }; }
}
