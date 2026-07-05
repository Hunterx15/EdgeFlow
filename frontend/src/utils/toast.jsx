/**
 * EdgeFlow - Toast notifications (minimal, dependency-free)
 */

import React, { createContext, useCallback, useContext, useState } from 'react';

const ToastCtx = createContext(null);
let idCounter = 0;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const remove = useCallback((id) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const push = useCallback((level, message, duration = 4000) => {
    const id = ++idCounter;
    setToasts((t) => [...t, { id, level, message }]);
    if (duration > 0) setTimeout(() => remove(id), duration);
    return id;
  }, [remove]);
  const api = {
    success: (m, d) => push('success', m, d),
    error: (m, d) => push('error', m, d || 6000),
    info: (m, d) => push('info', m, d),
    warning: (m, d) => push('warning', m, d),
    remove,
  };
  return (
    <ToastCtx.Provider value={api}>
      {children}
      <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 max-w-sm">
        {toasts.map((t) => (
          <div key={t.id} role="alert"
            className={`animate-slide-up flex items-start gap-3 px-4 py-3 rounded-lg border backdrop-blur shadow-lg ${
              t.level === 'success' ? 'bg-brand-950/90 border-brand-700 text-brand-100'
              : t.level === 'error' ? 'bg-rose-950/90 border-rose-700 text-rose-100'
              : t.level === 'warning' ? 'bg-amber-950/90 border-amber-700 text-amber-100'
              : 'bg-sky-950/90 border-sky-700 text-sky-100'
            }`}>
            <span className="text-sm flex-1">{t.message}</span>
            <button onClick={() => remove(t.id)} className="text-current opacity-60 hover:opacity-100 text-lg leading-none" aria-label="Dismiss">×</button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastCtx);
  if (!ctx) throw new Error('useToast must be used inside ToastProvider');
  return ctx;
}

export const toast = {
  success: (m) => (toast._impl?.success?.(m) ?? console.log('✓', m)),
  error: (m) => (toast._impl?.error?.(m) ?? console.error('✗', m)),
  info: (m) => (toast._impl?.info?.(m) ?? console.info('ℹ', m)),
  warning: (m) => (toast._impl?.warning?.(m) ?? console.warn('⚠', m)),
  _setImpl: (impl) => { toast._impl = impl; },
};
