import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

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
  const image = await window.webContents.capturePage();
  await writeFile(join(directory, 'desktop-settings.png'), image.toPNG());
  report.passed = report.nodeIsolated && report.contactsOk && report.keysPresent && report.desktopSettings && report.directGatewayBlocked && report.origin === 'betweenly://app';
  if (!report.passed) throw new Error('桌面验收未通过：' + JSON.stringify(report));
  return report;
}
