import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { classNames } from '../../utils/format';

export default function Modal({ open, onClose, title, children, footer, size = 'md' }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = ''; };
  }, [open, onClose]);

  if (!open) return null;
  const sizes = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl' };
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm animate-fade-in" onClick={onClose} />
      <div className={classNames('relative w-full bg-slate-900 border border-slate-700 rounded-xl shadow-2xl animate-slide-up max-h-[90vh] flex flex-col', sizes[size])}>
        {title && (
          <header className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
            <h3 className="text-base font-semibold text-slate-100">{title}</h3>
            <button onClick={onClose} className="text-slate-500 hover:text-slate-200 p-1" aria-label="Close"><X size={18} /></button>
          </header>
        )}
        <div className="flex-1 overflow-y-auto p-5">{children}</div>
        {footer && <footer className="px-5 py-4 border-t border-slate-800 flex justify-end gap-2">{footer}</footer>}
      </div>
    </div>,
    document.body
  );
}
