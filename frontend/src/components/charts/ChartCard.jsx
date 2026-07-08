import React from 'react';
import { classNames } from '../../utils/format';

export default function ChartCard({ title, subtitle, action, children, loading, className }) {
  return (
    <section className={classNames('card p-5', className)}>
      <header className="flex items-start justify-between gap-3 mb-4">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-slate-100">{title}</h3>
          {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
        </div>
        {action}
      </header>
      {loading ? <div className="skeleton h-[260px] w-full" /> : children}
    </section>
  );
}
