/**
 * EdgeFlow - Settings page
 *
 * Displays user profile, system information, and configuration overview.
 */

import React, { useEffect, useState } from 'react';
import { User, Server, Shield, Settings as SettingsIcon, Database, Zap, Clock, ExternalLink } from 'lucide-react';
import { authApi, monitoringApi } from '../api/endpoints';
import Card from '../components/ui/Card';
import { classNames, formatUptime } from '../utils/format';

export default function SettingsPage() {
  const [user, setUser] = useState(null);
  const [systemInfo, setSystemInfo] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [me, ready] = await Promise.all([
          authApi.me().catch(() => null),
          monitoringApi.ready().catch(() => null),
        ]);
        setUser(me?.user || null);
        setSystemInfo(ready);
      } finally { setLoading(false); }
    })();
  }, []);

  if (loading) return <div className="animate-pulse text-slate-500">Loading settings...</div>;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold text-slate-100">Settings</h2>
        <p className="text-sm text-slate-500 mt-1">Profile, system information, and configuration overview.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* User profile */}
        <Card title="Profile">
          {user ? (
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-brand-500/20 flex items-center justify-center text-brand-400 font-semibold">
                  {user.firstName?.[0] || user.email?.[0]?.toUpperCase() || 'A'}
                </div>
                <div>
                  <div className="text-sm font-medium text-slate-100">{user.name || user.email}</div>
                  <div className="text-xs text-slate-500">{user.email}</div>
                </div>
              </div>
              <div className="space-y-1.5 text-xs">
                <Row label="Role" value={<span className="badge badge-info">{user.role}</span>} />
                <Row label="Status" value={<span className="badge badge-success">Active</span>} />
                <Row label="User ID" value={<code className="text-slate-400 font-mono">{user.id}</code>} />
              </div>
            </div>
          ) : <p className="text-sm text-slate-500">Unable to load profile.</p>}
        </Card>

        {/* System info */}
        <Card title="System Information">
          {systemInfo ? (
            <div className="space-y-1.5 text-xs">
              <Row label="Status" value={<span className={classNames('badge', systemInfo.status === 'ok' ? 'badge-success' : 'badge-warning')}>{systemInfo.status}</span>} />
              <Row label="Uptime" value={formatUptime(systemInfo.uptimeSec)} />
              <Row label="Database" value={systemInfo.subsystems?.database?.status === 'ok' ? <span className="text-brand-400">Connected</span> : <span className="text-rose-400">Error</span>} />
              <Row label="Redis" value={systemInfo.subsystems?.redis?.fallback ? <span className="text-amber-400">Fallback mode</span> : <span className="text-brand-400">Connected</span>} />
              <Row label="Routes cached" value={systemInfo.subsystems?.routeCache?.routes || 0} />
              <Row label="Services" value={`${systemInfo.subsystems?.services?.healthy || 0} healthy / ${systemInfo.subsystems?.services?.total || 0} total`} />
              <Row label="Circuit breakers" value={`${systemInfo.subsystems?.circuitBreakers?.closedCount || 0} closed / ${systemInfo.subsystems?.circuitBreakers?.openCount || 0} open`} />
            </div>
          ) : <p className="text-sm text-slate-500">Unable to load system info.</p>}
        </Card>

        {/* Configuration */}
        <Card title="Configuration">
          <div className="space-y-1.5 text-xs">
            <Row label="Gateway prefix" value={<code className="text-slate-400 font-mono">/gateway</code>} />
            <Row label="API prefix" value={<code className="text-slate-400 font-mono">/api/v1</code>} />
            <Row label="Body limit" value="1 MB" />
            <Row label="Rate limit" value="100 req/min (default)" />
            <Row label="Cache TTL" value="Per-route (default: 0 = off)" />
            <Row label="Circuit breaker" value="5 failures → 30s open" />
            <Row label="Health check" value="30s interval, 3 failures" />
            <Row label="JWT access" value="15 min expiry" />
            <Row label="JWT refresh" value="7 day expiry, httpOnly cookie" />
          </div>
        </Card>

        {/* Links */}
        <Card title="Resources">
          <div className="space-y-2">
            <LinkRow icon={SettingsIcon} label="Swagger UI" href="/api/v1/docs" />
            <LinkRow icon={Database} label="OpenAPI Spec" href="/api/v1/openapi.json" />
            <LinkRow icon={Shield} label="Health Check" href="/health" />
            <LinkRow icon={Zap} label="Liveness Probe" href="/api/v1/monitoring/live" />
            <LinkRow icon={Server} label="Readiness Probe" href="/api/v1/monitoring/ready" />
          </div>
        </Card>
      </div>
    </div>
  );
}

function Row({ label, value }) {
  return <div className="flex items-center justify-between"><span className="text-slate-500">{label}</span><span className="text-slate-200">{value}</span></div>;
}

function LinkRow({ icon: Icon, label, href }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-sm text-slate-300 hover:text-brand-300 transition-colors">
      <Icon size={14} className="text-slate-500" />
      <span>{label}</span>
      <ExternalLink size={12} className="ml-auto text-slate-600" />
    </a>
  );
}
