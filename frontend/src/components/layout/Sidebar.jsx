/**
 * EdgeFlow - Sidebar navigation
 *
 * Sticky left-side nav with the EdgeFlow logo, primary navigation,
 * and a system status indicator at the bottom.
 */

import React from 'react';
import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard, Server, Route as RouteIcon, KeyRound,
  ScrollText, BarChart3, Activity, Settings, ShieldCheck,
  FlaskConical, GitBranch, Network, Workflow,
} from 'lucide-react';
import { classNames } from '../../utils/format';
import { Logo } from './Logo';

const nav = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/services', label: 'Services', icon: Server },
  { to: '/routes', label: 'Routes', icon: RouteIcon },
  { to: '/api-keys', label: 'API Keys', icon: KeyRound },
  { to: '/playground', label: 'API Playground', icon: FlaskConical, highlight: true },
  { to: '/pipeline', label: 'Pipeline Visualizer', icon: Workflow, highlight: true },
  { to: '/timeline', label: 'Gateway Timeline', icon: GitBranch, highlight: true },
  { to: '/dependency-graph', label: 'Dependency Graph', icon: Network, highlight: true },
  { to: '/logs', label: 'Request Logs', icon: ScrollText },
  { to: '/analytics', label: 'Analytics', icon: BarChart3 },
  { to: '/monitoring', label: 'Monitoring', icon: Activity },
  { to: '/settings', label: 'Settings', icon: Settings },
];

export default function Sidebar({ systemStatus = 'ok' }) {
  return (
    <aside className="hidden lg:flex w-64 shrink-0 flex-col border-r border-slate-800 bg-slate-950/80 backdrop-blur">
      <div className="flex items-center gap-3 px-5 h-16 border-b border-slate-800">
        <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: '#083344', border: '1px solid #155e75' }}>
          <Logo size={20} />
        </div>
        <div>
          <div className="text-base font-semibold tracking-tight">EdgeFlow</div>
          <div className="text-[10px] text-slate-500 uppercase tracking-widest">API Gateway</div>
        </div>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        {nav.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) => classNames(
              'flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
              isActive
                ? 'bg-brand-500/10 text-brand-300 border-l-2 border-brand-500'
                : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800/40',
              item.highlight && !isActive && 'text-brand-300/70'
            )}
          >
            <item.icon size={18} />
            <span>{item.label}</span>
            {item.highlight && <span className="ml-auto text-[9px] bg-brand-500/20 text-brand-300 px-1.5 py-0.5 rounded uppercase tracking-wider">new</span>}
          </NavLink>
        ))}
      </nav>

      <div className="px-4 py-4 border-t border-slate-800 space-y-3">
        <div className="flex items-center gap-2 text-xs">
          <ShieldCheck size={14} className="text-brand-400" />
          <span className="text-slate-400">System</span>
          <span className={classNames(
            'ml-auto badge',
            systemStatus === 'ok' ? 'badge-success' : systemStatus === 'degraded' ? 'badge-warning' : 'badge-danger'
          )}>{systemStatus}</span>
        </div>
        <div className="text-[10px] text-slate-600 leading-relaxed">
          EdgeFlow v2.0.0 · Production API Gateway
        </div>
      </div>
    </aside>
  );
}
