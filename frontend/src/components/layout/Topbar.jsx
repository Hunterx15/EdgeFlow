/**
 * EdgeFlow - Top bar with page title + user dropdown
 */

import React, { useState, useRef, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { LogOut, User as UserIcon, ChevronDown, Menu } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { classNames } from '../../utils/format';

const titles = {
  '/': 'Dashboard',
  '/services': 'Services',
  '/routes': 'Routes',
  '/api-keys': 'API Keys',
  '/playground': 'API Playground',
  '/pipeline': 'Pipeline Visualizer',
  '/timeline': 'Gateway Timeline',
  '/dependency-graph': 'Dependency Graph',
  '/logs': 'Request Logs',
  '/analytics': 'Analytics',
  '/monitoring': 'Monitoring',
  '/settings': 'Settings',
};

export default function Topbar({ onMenuClick }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    const handler = (e) => { if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const title = titles[location.pathname] || 'EdgeFlow';
  const handleLogout = async () => { await logout(); navigate('/login'); };

  return (
    <header className="h-16 border-b border-slate-800 bg-slate-950/80 backdrop-blur sticky top-0 z-30 flex items-center px-4 lg:px-6 gap-4">
      <button onClick={onMenuClick} className="lg:hidden text-slate-400 hover:text-slate-100 p-2 -ml-2" aria-label="Open menu">
        <Menu size={20} />
      </button>
      <div className="flex-1">
        <h1 className="text-base lg:text-lg font-semibold text-slate-100">{title}</h1>
      </div>
      <div className="flex items-center gap-3">
        <div className="hidden md:flex items-center gap-2 text-xs text-slate-500">
          <span className="w-1.5 h-1.5 rounded-full bg-brand-400 animate-pulse" /> Live data
        </div>
        <div className="relative" ref={menuRef}>
          <button onClick={() => setMenuOpen((o) => !o)} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-slate-800/60 transition">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center text-slate-950 text-sm font-semibold">
              {user?.name?.charAt(0) || <UserIcon size={16} />}
            </div>
            <div className="hidden sm:block text-left">
              <div className="text-sm font-medium text-slate-100 leading-tight">{user?.name || 'Guest'}</div>
              <div className="text-[11px] text-slate-500 leading-tight">{user?.email || '—'}</div>
            </div>
            <ChevronDown size={14} className={classNames('text-slate-500 transition', menuOpen && 'rotate-180')} />
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-full mt-2 w-56 bg-slate-900 border border-slate-700 rounded-lg shadow-xl py-1 animate-fade-in">
              <div className="px-3 py-2 border-b border-slate-800">
                <div className="text-sm font-medium text-slate-100">{user?.name}</div>
                <div className="text-xs text-slate-500">{user?.email}</div>
                <div className="mt-1"><span className="badge-info">{user?.role || 'admin'}</span></div>
              </div>
              <button onClick={handleLogout} className="w-full flex items-center gap-2 px-3 py-2 text-sm text-rose-300 hover:bg-rose-950/30 transition">
                <LogOut size={16} /> Sign out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
