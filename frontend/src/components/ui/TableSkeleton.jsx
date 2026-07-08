import React from 'react';

export default function TableSkeleton({ rows = 5, cols = 4 }) {
  return (
    <div className="divide-y divide-slate-800/60">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 px-4 py-3">
          {Array.from({ length: cols }).map((_, j) => (
            <div key={j} className="skeleton h-4 flex-1" style={{ maxWidth: 200 }} />
          ))}
        </div>
      ))}
    </div>
  );
}
