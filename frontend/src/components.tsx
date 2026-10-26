import { Children, createContext, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

const paths: Record<string, string> = {
  user: 'M20 21v-2a7 7 0 0 0-14 0v2M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z',
  home: 'm3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z',
  users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m20 0v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z',
  history: 'M3 11a9 9 0 1 1 2.6 7M3 4v7h7m2-4v5l3 2',
  style: 'M4 21h16M6 17 12 3l6 14M8 12h8',
  plus: 'M12 5v14M5 12h14', arrow: 'M4 12h16m-6-6 6 6-6 6',
  image: 'M3 3h18v18H3Zm0 13 6-6 6 6m-3-3 4-4 5 5M8 7h.01',
  download: 'M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5',
  chevron: 'm9 5 7 7-7 7', down: 'm6 9 6 6 6-6',
  check: 'm5 12 4 4L19 6', close: 'm6 6 12 12M6 18 18 6',
  settings: 'M9 2h6l.5 2.2 1.6.9 2.2-.6 3 5.2-1.7 1.5v1.8l1.7 1.5-3 5.2-2.2-.6-1.6.9L15 22H9l-.5-2.2-1.6-.9-2.2.6-3-5.2 1.7-1.5v-1.8l-1.7-1.5 3-5.2 2.2.6 1.6-.9L9 2ZM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',
  chat: 'M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5Z',
  leaf: 'M20 4C7 2 2 12 7 17c5 5 15 0 13-13ZM4 21 15 10',
  spark: 'm12 3 2.4 6.6L21 12l-6.6 2.4L12 21l-2.4-6.6L3 12l6.6-2.4ZM20 2v4m-2-2h4',
  shield: 'M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11Zm-4-10 3 3 5-6',
  edit: 'm16 3 5 5M4 20l4-1 13-13-4-4L4 15ZM3 21h18',
  trash: 'M3 6h18M9 6V3h6v3m-10 0 1 15h12l1-15M10 10v7m4-7v7',
  copy: 'M9 9h12v12H9Zm6-4V3H3v12h2',
  clock: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-5v5l3 2',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Zm13 0a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',
  info: 'M12 11v6m0-10v.1M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
  search: 'M21 21l-5-5m2-6a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z',
  menu: 'M4 6h16M4 12h16M4 18h16',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  moon: 'M21 12.8A9 9 0 0 1 11.2 3a9 9 0 1 0 9.8 9.8Z',
  sun: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm0-6v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5',
  refresh: 'M20 7v5h-5M4 17v-5h5m-5 0a8 8 0 0 1 14-5l2 2M4 15l2 2a8 8 0 0 0 14-5',
  flag: 'M4 22V3m0 1c5-4 10 4 16 0v11c-6 4-11-4-16 0',
};
export function Icon({ name, size = 20 }: { name: string; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name] ?? paths.info} /></svg>;
}
const ModalClosing = createContext(false);

// Keep the native dialog in the top layer until its short exit has finished.
export function ModalPresence({ open, children }: { open: boolean; children: ReactNode }) {
  const [retained, setRetained] = useState(children);
  useLayoutEffect(() => { if (open) setRetained(children); }, [open, children]);
  useEffect(() => {
    if (open) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { setRetained(null); return; }
    const timer = window.setTimeout(() => setRetained(null), 140);
    return () => window.clearTimeout(timer);
  }, [open]);
  return <ModalClosing.Provider value={!open}>{open ? children : retained}</ModalClosing.Provider>;
}

export function Modal({ title, children, onClose, wide = false }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const closing = useContext(ModalClosing);
  useEffect(() => { const node = ref.current!; node.showModal(); return () => node.close(); }, []);
  return <dialog ref={ref} inert={closing} className={'modal ' + (wide ? 'wide ' : '') + (closing ? 'is-closing' : '')} onCancel={event => { event.preventDefault(); if (!closing) onClose(); }} onClick={event => { if (!closing && event.target === event.currentTarget) onClose(); }} aria-labelledby="modal-title">
    <div className="modal-head"><h2 id="modal-title">{title}</h2><button className="icon-btn" onClick={onClose} aria-label="关闭弹窗"><Icon name="close" /></button></div>{children}
  </dialog>;
}
export function Empty({ title, children, icon = 'leaf' }: { title: string; children?: ReactNode; icon?: string }) { return <div className="empty"><span className="empty-icon"><Icon name={icon} size={28} /></span><h3>{title}</h3>{children && <p>{children}</p>}</div>; }

export function ActionMenu({ label, children, className = '', icon = 'more' }: { label: string; children: ReactNode; className?: string; icon?: string }) {
  const [position, setPosition] = useState({ top: 0, left: 0 });
  return <details className={'action-menu ' + className} onKeyDown={event => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.currentTarget.removeAttribute('open');
      event.currentTarget.querySelector('summary')?.focus();
    }
  }} onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) event.currentTarget.removeAttribute('open');
  }}>
    <summary aria-label={label} title={label} onClick={event => {
      const rectangle = event.currentTarget.getBoundingClientRect();
      const height = Children.count(children) * 36 + 12;
      setPosition({ top: Math.max(12, Math.min(rectangle.bottom + 6, window.innerHeight - height - 40)), left: Math.max(12, rectangle.right - 176) });
    }}><Icon name={icon} size={20} /></summary>
    <div className="menu-content" style={position} onClick={event => event.currentTarget.closest('details')?.removeAttribute('open')}>{children}</div>
  </details>;
}
