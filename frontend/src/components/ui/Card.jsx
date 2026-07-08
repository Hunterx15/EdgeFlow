import React from 'react';
import { classNames } from '../../utils/format';

export default function Card({ title, subtitle, action, children, className, bodyClassName, noPadding }) {
  return (
    <section className={classNames('card', className)}>
      {(title || action) && (
        <header className="flex items-start justify-between gap-3 px-5 py-4 border-b border-slate-800/60">
          <div className="min-w-0">
            {title && <h3 className="text-sm font-semibold text-slate-100">{title}</h3>}
            {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
          </div>
          {action}
        </header>
      )}
      <div className={noPadding ? '' : 'p-5 ' + (bodyClassName || '')}>{children}</div>
    </section>
  );
}
