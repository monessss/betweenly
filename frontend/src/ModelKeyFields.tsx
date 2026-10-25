import { useEffect, useState } from 'react';
import type { Transport } from './lib/contracts.ts';

interface KeyStatus { deepseekConfigured: boolean; jevConfigured: boolean }

export function ModelKeyFields({ api, disabled }: { api: Transport; disabled: boolean }) {
  const [status, setStatus] = useState<KeyStatus | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    api.request<KeyStatus>('/me/model-credentials', { signal: controller.signal }).then(response => {
      if (typeof response.data?.deepseekConfigured !== 'boolean' || typeof response.data?.jevConfigured !== 'boolean') throw new Error('模型密钥配置响应无效');
      if (!controller.signal.aborted) setStatus(response.data);
    }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '无法读取密钥配置状态'); });
    return () => controller.abort();
  }, [api]);
  return <>
    <label className="field"><span>DeepSeek API Key</span><input name="deepseekApiKey" type="password" maxLength={512} autoComplete="off" spellCheck={false} disabled={disabled} placeholder={status?.deepseekConfigured ? '已配置，留空保持不变' : status ? '填写 DeepSeek API Key' : '留空保持现有密钥'} /></label>
    <label className="field"><span>Jev API Key</span><input name="jevApiKey" type="password" maxLength={512} autoComplete="off" spellCheck={false} disabled={disabled} placeholder={status?.jevConfigured ? '已配置，留空保持不变' : status ? '填写 TypeSafe API Key' : '留空保持现有密钥'} /></label>
    {error && <p className="form-error" role="status">{error}</p>}
  </>;
}
