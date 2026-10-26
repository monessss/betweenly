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
  try {
    const image = await window.webContents.capturePage();
    await writeFile(join(directory, 'desktop-settings.png'), image.toPNG());
  } catch { report.captureUnavailable = true; /* Hidden windows may have no compositor surface. */ }
  report.photoUiOk = await window.webContents.executeJavaScript(`(async () => {
    const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
    async function until(read, label) { for (let i = 0; i < 100; i++) { const value = read(); if (value) return value; await delay(50); } throw new Error(label); }
    const request = async (path, method = 'GET', body, headers = {}) => {
      const response = await fetch('betweenly://app/api/v1' + path, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
      if (!response.ok) throw new Error('Photo smoke API ' + response.status);
      return response.status === 204 ? null : (await response.json()).data;
    };
    document.querySelector('button[aria-label="关闭弹窗"]').click(); await delay(200);
    document.querySelector('button[aria-label="添加联系人"]').click();
    const label = await until(() => document.querySelector('input[name="label"]'), 'contact form missing'); label.value = '图片验收';
    document.querySelector('dialog form button.primary-button').click();
    await until(() => [...document.querySelectorAll('.contact-link')].find(e => e.textContent.includes('图片验收')), 'contact missing');
    const contact = (await request('/contacts')).find(e => e.label === '图片验收');
    try {
      [...document.querySelectorAll('.contact-link')].find(e => e.textContent.includes('图片验收')).click();
      await until(() => document.querySelector('summary[aria-label="添加记录"]'), 'record menu missing');
      await delay(300);
      document.querySelector('summary[aria-label="添加记录"]').click();
      [...document.querySelectorAll('.record-import-menu button')].find(e => e.textContent.includes('添加文字')).click();
      const input = await until(() => document.querySelector('input[type="file"][aria-label="上传图片"]'), 'file input missing');
      const canvas = document.createElement('canvas'); canvas.width = 400; canvas.height = 300;
      const ctx = canvas.getContext('2d'); ctx.fillStyle = '#eee4cf'; ctx.fillRect(0, 0, 400, 300);
      ctx.fillStyle = '#a26437'; ctx.fillRect(120, 70, 160, 160); ctx.fillStyle = '#353333'; ctx.font = '24px sans-serif'; ctx.fillText('Betweenly', 135, 270);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
      const transfer = new DataTransfer(); transfer.items.add(new File([blob], 'test-photo.png', { type: 'image/png' }));
      input.files = transfer.files; input.dispatchEvent(new Event('change', { bubbles: true }));
      await until(() => document.querySelector('input[name="image"]').value && !document.querySelector('input[name="imageProcessing"]').value, 'photo conversion failed');
      const photo = JSON.parse(document.querySelector('input[name="image"]').value);
      if (!photo.dataUrl.startsWith('data:image/jpeg;base64,') || document.querySelector('textarea[name="text"]').required) throw new Error('photo normalization failed');
      document.querySelector('dialog form button.primary-button').click();
      const thumbnail = await until(() => document.querySelector('button[aria-label="查看图片"] img'), 'saved thumbnail missing');
      await until(() => thumbnail.complete && thumbnail.naturalWidth > 0, 'thumbnail decode failed');
      thumbnail.parentElement.click();
      await until(() => document.querySelector('img.photo-preview')?.naturalWidth > 0, 'photo preview missing');
      document.querySelector('button[aria-label="关闭弹窗"]').click(); await delay(200);
      document.querySelector('.chat-message-menu summary').click();
      [...document.querySelectorAll('.chat-message-menu button')].find(e => e.textContent === '编辑').click();
      await until(() => document.querySelector('button[aria-label="移除图片"]'), 'edit photo missing');
      document.querySelector('button[aria-label="移除图片"]').click();
      await until(() => !document.querySelector('input[name="image"]').value && document.querySelector('textarea[name="text"]').required, 'photo removal failed');
      document.querySelector('button[aria-label="关闭弹窗"]').click(); await delay(200);
      return true;
    } finally { await request('/contacts/' + contact.contactId, 'DELETE', undefined, { 'If-Match': '1' }); }
  })()`);
  report.passed = report.nodeIsolated && report.contactsOk && report.keysPresent && report.desktopSettings && report.directGatewayBlocked && report.themeIconsOk && report.photoUiOk && report.origin === 'betweenly://app';
  if (!report.passed) throw new Error('桌面验收未通过：' + JSON.stringify(report));
  return report;
}
