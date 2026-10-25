import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { nativeTheme } from 'electron';

async function checkThemeIcons(window, directory) {
  const original = window.setIcon;
  const previousTheme = nativeTheme.themeSource;
  let applied;
  window.setIcon = function (icon) { applied = icon; return original.call(this, icon); };
  try {
    for (const theme of ['light', 'dark']) {
      nativeTheme.themeSource = theme === 'light' ? 'dark' : 'light'; await delay(100);
      applied = null; nativeTheme.themeSource = theme;
      for (let count = 0; count < 20 && !applied; count++) await delay(50);
      if (!applied || applied.isEmpty()) throw new Error('窗口图标未跟随系统主题更新：' + theme);
      const pixels = applied.toBitmap(); let total = 0, count = 0;
      for (let index = 0; index < pixels.length; index += 4) if (pixels[index + 3] > 240) { total += (pixels[index] + pixels[index + 1] + pixels[index + 2]) / 3; count++; }
      const brightness = count ? total / count : -1;
      if (theme === 'dark' ? brightness < 200 : brightness < 0 || brightness > 70) throw new Error('窗口图标颜色与主题不匹配：' + theme);
      await writeFile(join(directory, 'native-icon-' + theme + '.png'), applied.toPNG());
    }
    return true;
  } finally { window.setIcon = original; nativeTheme.themeSource = previousTheme; }
}

export async function smoke(window, runtime, directory) {
  await mkdir(directory, { recursive: true });
  for (let count = 0; count < 40; count++) {
    if (await window.webContents.executeJavaScript(`!!document.querySelector('button[aria-label="设置"]') && !document.querySelector('main.loading-view')`)) break;
    await delay(100);
  }
  const report = await window.webContents.executeJavaScript(`(async () => {
    const response = await fetch('betweenly://app/api/v1/contacts');
    const contacts = await response.json();
    document.querySelector('button[aria-label="设置"]').click();
    await new Promise(resolve => setTimeout(resolve, 250));
    return { title: document.title, origin: location.origin, nodeIsolated: typeof process === 'undefined' && typeof require === 'undefined', contactsOk: response.ok && Array.isArray(contacts.data), keysPresent: !!document.querySelector('input[name="deepseekApiKey"]') && !!document.querySelector('input[name="jevApiKey"]'), desktopSettings: !document.querySelector('input[name="baseUrl"]') };
  })()`);
  const unauthorized = await fetch(runtime.gatewayUrl + '/api/v1/contacts', { headers: { 'X-Dev-User-Id': '7bc4918a-9079-4ea2-9e8e-369ad79a9f20' } });
  report.directGatewayBlocked = unauthorized.status === 401;
  report.themeIconsOk = await checkThemeIcons(window, directory);
  const image = await window.webContents.capturePage();
  await writeFile(join(directory, 'desktop-settings.png'), image.toPNG());
  report.passed = report.nodeIsolated && report.contactsOk && report.keysPresent && report.desktopSettings && report.directGatewayBlocked && report.themeIconsOk && report.origin === 'betweenly://app';
  if (!report.passed) throw new Error('桌面验收未通过：' + JSON.stringify(report));
  return report;
}
