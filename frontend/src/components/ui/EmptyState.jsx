import React from 'react';

export default function EmptyState({ icon: Icon, title, description, action }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
      {Icon && (
        <div className="w-14 h-14 rounded-full bg-slate-800/60 flex items-center justify-center text-slate-500 mb-4">
          <Icon size={24} />
        </div>
      )}
      <h3 className="text-base font-semibold text-slate-200">{title}</h3>
      {description && <p className="text-sm text-slate-500 mt-1 max-w-sm">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
