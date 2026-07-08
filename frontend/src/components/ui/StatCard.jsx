import React from 'react';
import { classNames, formatNumber, formatPercent } from '../../utils/format';

export default function StatCard({
  label, value, icon: Icon, accent = 'brand',
  delta, deltaLabel, goodWhenUp = true, suffix, isLoading, tooltip,
}) {
  const accents = {
    brand: 'from-brand-500/20 to-brand-700/5 text-brand-300',
    sky: 'from-sky-500/20 to-sky-700/5 text-sky-300',
    amber: 'from-amber-500/20 to-amber-700/5 text-amber-300',
    rose: 'from-rose-500/20 to-rose-700/5 text-rose-300',
    violet: 'from-violet-500/20 to-violet-700/5 text-violet-300',
    emerald: 'from-emerald-500/20 to-emerald-700/5 text-emerald-300',
  };
  const deltaColor = delta === null || delta === undefined ? 'text-slate-500'
    : (goodWhenUp ? (delta >= 0 ? 'text-brand-400' : 'text-rose-400')
       : (delta >= 0 ? 'text-rose-400' : 'text-brand-400'));
  return (
    <div className="card card-hover p-5 relative overflow-hidden" title={tooltip}>
      <div className="flex items-start justify-between">
        <div className="min-w-0">
          <div className="text-xs font-medium text-slate-400 uppercase tracking-wider">{label}</div>
          {isLoading ? <div className="skeleton h-8 w-24 mt-2" /> : (
            <div className="mt-2 text-2xl font-bold text-slate-100">
              {typeof value === 'number' ? formatNumber(value) : value}
              {suffix && <span className="text-base font-normal text-slate-500 ml-1">{suffix}</span>}
            </div>
          )}
          {(delta !== undefined && delta !== null) && (
            <div className={classNames('mt-1 text-xs flex items-center gap-1', deltaColor)}>
              <span>{delta >= 0 ? '▲' : '▼'} {formatPercent(Math.abs(delta))}</span>
              {deltaLabel && <span className="text-slate-500">{deltaLabel}</span>}
            </div>
          )}
        </div>
        {Icon && (
          <div className={classNames('w-10 h-10 rounded-lg bg-gradient-to-br flex items-center justify-center shrink-0', accents[accent])}>
            <Icon size={18} />
          </div>
        )}
      </div>
    </div>
  );
}
