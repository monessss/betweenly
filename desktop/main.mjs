import { app, BrowserWindow, dialog, Menu, protocol, session, nativeTheme } from 'electron';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';
import { DesktopRuntime } from './runtime.mjs';
import { APP_ORIGIN, trustedUrl, makeProtocolHandler } from './protocol.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
app.setName('Betweenly');
app.setAppUserModelId('com.betweenly.desktop');
app.commandLine.appendSwitch('lang', 'zh-CN');
if (process.env.BETWEENLY_DESKTOP_PROFILE) app.setPath('userData', resolve(process.env.BETWEENLY_DESKTOP_PROFILE));
else if (!app.isPackaged) app.setPath('userData', join(root, '.runtime', 'desktop-profile'));
protocol.registerSchemesAsPrivileged([{ scheme: 'betweenly', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);

let window, runtime, finishing = false, startupComplete = false, smokeReport, exitCode = 0;
const smokeFile = process.env.BETWEENLY_DESKTOP_SMOKE;
const locked = app.requestSingleInstanceLock();
if (!locked) app.quit();
app.on('second-instance', () => { if (window) { if (window.isMinimized()) window.restore(); window.show(); window.focus(); } });
app.on('window-all-closed', () => app.quit());
app.on('before-quit', event => {
  if (finishing || !runtime) return;
  event.preventDefault(); finishing = true;
  void runtime.stop().finally(async () => {
    if (smokeFile) {
      await mkdir(dirname(resolve(smokeFile)), { recursive: true });
      await writeFile(resolve(smokeFile), JSON.stringify({ ...smokeReport, stopped: true, pids: runtime.pids, hostPid: runtime.host?.pid, gatewayUrl: runtime.gatewayUrl }, null, 2));
    }
    app.exit(exitCode);
  });
});

async function start() {
  const bundle = app.isPackaged ? join(process.resourcesPath, 'backend') : join(root, '.runtime', 'desktop-bundle');
  runtime = new DesktopRuntime({ bundle, profile: app.getPath('userData') });
  runtime.on('failure', error => {
    if (startupComplete && !finishing) { dialog.showErrorBox('Betweenly', error.message); app.quit(); }
  });
  const local = session.fromPartition('persist:betweenly');
  local.setPermissionCheckHandler((contents, permission) => permission === 'clipboard-sanitized-write' && !!contents && trustedUrl(contents.getURL()));
  local.setPermissionRequestHandler((contents, permission, callback) => callback(permission === 'clipboard-sanitized-write' && trustedUrl(contents.getURL())));
  local.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !trustedUrl(details.url) && !details.url.startsWith('devtools:') }));
  local.protocol.handle('betweenly', makeProtocolHandler({ assets: join(root, 'frontend/dist'), startup: join(root, 'desktop/startup.html'), runtime }));
  Menu.setApplicationMenu(null);
  window = new BrowserWindow({
    width: 1280, height: 820, minWidth: 780, minHeight: 600, title: 'Betweenly',
    icon: join(root, 'frontend/dist/brand/betweenly-icon.png'), backgroundColor: nativeTheme.shouldUseDarkColors ? '#1e1e20' : '#f9f9fa',
    webPreferences: { session: local, nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, devTools: !app.isPackaged }
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => { if (!trustedUrl(url)) event.preventDefault(); });
  window.webContents.on('will-attach-webview', event => event.preventDefault());
  window.webContents.on('render-process-gone', () => { if (!finishing) { exitCode = 1; app.quit(); } });
  window.on('closed', () => { window = null; });
  await window.loadURL(APP_ORIGIN + '/__startup');
  await runtime.start();
  if (finishing || !window) return;
  await window.loadURL(APP_ORIGIN + '/');
  startupComplete = true;
  if (smokeFile) {
    try {
      const { smoke } = await import('./smoke.mjs');
      smokeReport = await smoke(window, runtime, dirname(resolve(smokeFile)));
    } catch (error) { exitCode = 1; smokeReport = { passed: false, message: error.message }; }
    app.quit();
  }
}
if (locked) app.whenReady().then(start).catch(error => {
  exitCode = 1;
  runtime?.log('Startup failed: ' + error.message);
  if (smokeFile) smokeReport = { passed: false, message: error.message };
  else if (!finishing) dialog.showErrorBox('无法启动 Betweenly', error.message + '\n\n日志：' + app.getPath('userData') + '\\logs');
  app.quit();
});
