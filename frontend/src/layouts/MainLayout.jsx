/**
 * EdgeFlow - Main authenticated layout
 */

import React, { useEffect, useState } from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from "../components/layout/Sidebar";
import Topbar from "../components/layout/Topbar";
import { monitoringApi } from '../api/endpoints';

export default function MainLayout() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [systemStatus, setSystemStatus] = useState('ok');

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const data = await monitoringApi.ready();
        if (!cancelled) setSystemStatus(data?.status || 'ok');
      } catch { if (!cancelled) setSystemStatus('down'); }
    };
    poll();
    const id = setInterval(poll, 30000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar systemStatus={systemStatus} />
      {drawerOpen && (
        <div className="lg:hidden fixed inset-0 z-40 flex">
          <div className="absolute inset-0 bg-slate-950/70 backdrop-blur-sm" onClick={() => setDrawerOpen(false)} />
          <div className="relative z-10 animate-slide-up"><Sidebar systemStatus={systemStatus} /></div>
        </div>
      )}
      <div className="flex-1 flex flex-col overflow-hidden">
        <Topbar onMenuClick={() => setDrawerOpen(true)} />
        <main className="flex-1 overflow-y-auto p-4 lg:p-6">
          <div className="max-w-7xl mx-auto animate-fade-in"><Outlet /></div>
        </main>
      </div>
    </div>
  );
}
