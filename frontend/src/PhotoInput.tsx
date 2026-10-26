import { useRef, useState } from 'react';
import { Icon } from './components.tsx';
import type { MessageImage } from './lib/contracts.ts';
import { preparePhoto } from './lib/images.ts';

export function PhotoInput({ initial, disabled, onChange }: { initial?: MessageImage | null; disabled: boolean; onChange: (image: MessageImage | null) => void }) {
  const [image, setImage] = useState(initial ?? null);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const generation = useRef(0);
  return <div className="photo-input">
    <input type="hidden" name="image" value={image ? JSON.stringify(image) : ''} />
    <input type="hidden" name="imageProcessing" value={processing ? '1' : ''} />
    <input ref={input} className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" aria-label="上传图片" disabled={disabled || processing} onChange={event => {
      const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; if (!file) return;
      const current = ++generation.current; setProcessing(true); setError('');
      void preparePhoto(file).then(photo => { if (generation.current === current) { setImage(photo); onChange(photo); } }).catch(cause => { if (generation.current === current) setError(cause instanceof Error ? cause.message : '图片处理失败'); }).finally(() => { if (generation.current === current) setProcessing(false); });
    }} />
    {image ? <div className="photo-attachment"><img src={image.dataUrl} alt="待保存的图片" /><button type="button" className="icon-button" aria-label="移除图片" disabled={disabled || processing} onClick={() => { setImage(null); onChange(null); }}><Icon name="close" size={16} /></button></div> : null}
    <button type="button" className="secondary-button" disabled={disabled || processing} onClick={() => input.current?.click()}><Icon name="image" size={16} />{processing ? '处理图片中…' : image ? '更换图片' : '上传图片'}</button>
    {error && <p className="form-error" role="alert">{error}</p>}
  </div>;
}
