import type { MessageImage } from './contracts.ts';

export const MAX_IMAGE_BYTES = 256 * 1024;
export function validatePhotoFile(file: Pick<File, 'size' | 'type'>) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('请选择 JPG、PNG 或 WebP 图片');
  if (file.size <= 0 || file.size > 8 * 1024 * 1024) throw new Error('图片大小应在 8MB 以内');
}
export function photoDimensions(width: number, height: number, maxSide = 1600) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1 || width * height > 40_000_000) throw new Error('图片尺寸过大或无效');
  const scale = Math.min(1, maxSide / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}
export async function preparePhoto(file: File): Promise<MessageImage> {
  validatePhotoFile(file);
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() => { throw new Error('无法读取图片，请更换文件'); });
  try {
    const initial = photoDimensions(bitmap.width, bitmap.height);
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) throw new Error('当前环境无法处理图片');
    // Canvas produces a fresh JPEG without EXIF/GPS metadata or active file content.
    for (const factor of [1, .8, .6, .4]) {
      canvas.width = Math.max(1, Math.round(initial.width * factor)); canvas.height = Math.max(1, Math.round(initial.height * factor));
      context.fillStyle = '#ffffff'; context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      for (const quality of [.86, .72, .56]) {
        const dataUrl = canvas.toDataURL('image/jpeg', quality);
        const encoded = dataUrl.slice(dataUrl.indexOf(',') + 1);
        const bytes = encoded.length * 3 / 4 - (encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0);
        if (dataUrl.startsWith('data:image/jpeg;base64,') && bytes <= MAX_IMAGE_BYTES) return { dataUrl, width: canvas.width, height: canvas.height };
      }
    }
    throw new Error('图片压缩后仍过大，请裁剪后重试');
  } finally { bitmap.close(); }
}
