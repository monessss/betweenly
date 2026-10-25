import { nativeImage } from 'electron';

export function createThemeIcons(path) {
  const light = nativeImage.createFromPath(path);
  if (light.isEmpty()) throw new Error('无法加载 Betweenly 窗口图标。');
  const { width, height } = light.getSize();
  const bitmap = light.toBitmap();
  // Windows native bitmaps use premultiplied alpha. Preserve the silhouette and
  // antialiased edges while making the foreground light on dark native chrome.
  for (let offset = 0; offset < bitmap.length; offset += 4) {
    const color = Math.round(244 * bitmap[offset + 3] / 255);
    bitmap[offset] = color; bitmap[offset + 1] = color; bitmap[offset + 2] = color;
  }
  return { light, dark: nativeImage.createFromBitmap(bitmap, { width, height }) };
}

export function followThemeIcon(window, theme, icons) {
  const update = () => { if (!window.isDestroyed()) window.setIcon(theme.shouldUseDarkColors ? icons.dark : icons.light); };
  theme.on('updated', update);
  window.once('closed', () => theme.removeListener('updated', update));
  update();
}
