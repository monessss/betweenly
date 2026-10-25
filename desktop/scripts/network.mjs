import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { EnvHttpProxyAgent, setGlobalDispatcher } from 'undici';

// npm/Node do not inherit Windows Internet Options automatically. Respect the
// user's existing proxy without changing global settings or TLS verification.
export function configureNetwork() {
  if (process.platform === 'win32' && !process.env.HTTPS_PROXY && !process.env.https_proxy) {
    try {
      const value = execFileSync(join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'), ['-NoProfile', '-NonInteractive', '-Command', "$target=[uri]'https://github.com'; $proxy=[System.Net.WebRequest]::DefaultWebProxy.GetProxy($target); if($proxy -ne $target){$proxy.AbsoluteUri}"], { encoding: 'utf8', windowsHide: true, timeout: 10000 }).trim();
      if (value && ['http:', 'https:'].includes(new URL(value).protocol)) {
        process.env.HTTPS_PROXY = value;
        process.env.HTTP_PROXY ??= value;
      }
    } catch { /* Explicit environment proxies or direct connections still work. */ }
  }
  process.env.NO_PROXY ??= 'localhost,127.0.0.1,::1';
  process.env.ELECTRON_GET_USE_PROXY = '1';
  setGlobalDispatcher(new EnvHttpProxyAgent());
}
