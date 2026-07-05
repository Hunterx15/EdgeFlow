/**
 * EdgeFlow - Service Dependency Graph page
 *
 * Visualizes the gateway + every registered service as a tree:
 *
 *   EdgeFlow Gateway
 *   ├── User Service        🟢 healthy
 *   ├── Payment Service     🟡 degraded (half-open circuit)
 *   ├── Inventory Service   🟢 healthy
 *   └── Notification Service 🔴 down
 *
 * Uses an SVG-based tree layout with animated edges. Health status is
 * pulled from /api/v1/monitoring/dependency-graph.
 */

import React, { useEffect, useState, useCallback } from 'react';
import { RefreshCw, Network, Server, Activity } from 'lucide-react';
import { monitoringApi } from '../api/endpoints';
import Card from '../components/ui/Card';
import EmptyState from '../components/ui/EmptyState';
import { classNames, formatRelative, statusBadge } from '../utils/format';

export default function DependencyGraphPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await monitoringApi.dependencyGraph()); } catch {} finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); const id = setInterval(load, 15000); return () => clearInterval(id); }, [load]);

  const services = data?.services || [];
  const healthyCount = services.filter((s) => s.status === 'healthy').length;
  const unhealthyCount = services.filter((s) => s.status === 'unhealthy').length;
  const unknownCount = services.filter((s) => s.status === 'unknown' || !s.status).length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div><h2 className="text-xl font-semibold text-slate-100">Service Dependency Graph</h2><p className="text-sm text-slate-500 mt-1">Visualize the gateway and every backend service with live health.</p></div>
        <button onClick={load} className="btn-secondary"><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh</button>
      </div>

      {/* Summary tiles */}
      <div className="grid grid-cols-3 gap-4">
        <SummaryTile label="Healthy" count={healthyCount} dotClass="bg-brand-400" />
        <SummaryTile label="Unhealthy" count={unhealthyCount} dotClass="bg-rose-400" />
        <SummaryTile label="Unknown" count={unknownCount} dotClass="bg-slate-500" />
      </div>

      <Card title="Dependency Tree" subtitle="EdgeFlow gateway → backend services">
        {loading ? <div className="skeleton h-96 w-full" /> : services.length === 0 ? (
          <EmptyState icon={Network} title="No services registered" description="Register services to see them in the dependency graph." />
        ) : (
          <DependencyTree gateway={data?.gateway} services={services} />
        )}
      </Card>
    </div>
  );
}

function SummaryTile({ label, count, dotClass }) {
  return (
    <div className="card p-4 flex items-center gap-3">
      <span className={classNames('w-3 h-3 rounded-full', dotClass)} />
      <div>
        <div className="text-2xl font-bold text-slate-100">{count}</div>
        <div className="text-xs text-slate-500 uppercase tracking-wider">{label}</div>
      </div>
    </div>
  );
}

function DependencyTree({ gateway, services }) {
  return (
    <div className="overflow-x-auto">
      <div className="min-w-[600px] p-6">
        {/* Gateway node */}
        <div className="flex justify-center mb-8">
          <GatewayNode />
        </div>

        {/* Connector line down */}
        <div className="flex justify-center mb-2">
          <div className="w-px h-6 bg-slate-700" />
        </div>

        {/* Horizontal connector */}
        {services.length > 1 && (
          <div className="relative h-6">
            <div className="absolute left-1/2 -translate-x-1/2 top-0 h-px bg-slate-700"
              style={{ width: `${Math.min(80, services.length * 18)}%` }} />
          </div>
        )}

        {/* Service nodes */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {services.map((svc, idx) => (
            <ServiceNode key={svc.id} svc={svc} index={idx} />
          ))}
        </div>
      </div>
    </div>
  );
}

function GatewayNode() {
  return (
    <div className="relative">
      {/* Pulsing ring */}
      <div className="absolute inset-0 rounded-xl bg-brand-500/20 animate-ping" />
      <div className="relative card p-4 flex items-center gap-3 border-brand-500/40" style={{ minWidth: 240 }}>
        <div className="w-12 h-12 rounded-lg flex items-center justify-center" style={{ background: '#083344', border: '1px solid #155e75' }}>
          <svg width="24" height="24" viewBox="0 0 64 64" fill="none">
            <path d="M14 22 L32 12 L50 22 L50 42 L32 52 L14 42 Z" stroke="#22d3ee" strokeWidth="3" fill="none" strokeLinejoin="round" />
            <path d="M14 22 L32 32 L50 22" stroke="#22d3ee" strokeWidth="3" strokeLinejoin="round" />
            <path d="M32 32 L32 52" stroke="#67e8f9" strokeWidth="3" strokeLinecap="round" />
            <circle cx="32" cy="32" r="3" fill="#67e8f9" />
          </svg>
        </div>
        <div>
          <div className="text-sm font-semibold text-slate-100">EdgeFlow Gateway</div>
          <div className="text-xs text-slate-500">API Gateway · Port 4000</div>
          <div className="mt-1 flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-brand-400 animate-pulse" />
            <span className="text-[10px] text-brand-300 uppercase tracking-wider">Healthy</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function ServiceNode({ svc, index }) {
  const isHealthy = svc.status === 'healthy';
  const isUnhealthy = svc.status === 'unhealthy';
  const isUnknown = !svc.status || svc.status === 'unknown';
  const dotColor = isHealthy ? 'bg-brand-400' : isUnhealthy ? 'bg-rose-400' : 'bg-slate-500';
  const borderColor = isHealthy ? 'border-brand-500/40' : isUnhealthy ? 'border-rose-500/40' : 'border-slate-700';
  const statusColor = isHealthy ? 'text-brand-300' : isUnhealthy ? 'text-rose-300' : 'text-slate-500';

  return (
    <div className="relative">
      {/* Vertical connector from horizontal line */}
      <div className="absolute -top-4 left-1/2 -translate-x-1/2 w-px h-4 bg-slate-700" />
      <div className={classNames('card p-3 transition-all hover:scale-105', borderColor)}>
        <div className="flex items-start gap-2">
          <div className={classNames('w-8 h-8 rounded-lg flex items-center justify-center shrink-0',
            isHealthy ? 'bg-brand-500/15 text-brand-300' : isUnhealthy ? 'bg-rose-500/15 text-rose-300' : 'bg-slate-800 text-slate-500')}>
            <Server size={14} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-slate-100 truncate">{svc.name}</div>
            <div className="text-[10px] text-slate-500 font-mono truncate">{svc.slug} · {svc.version}</div>
          </div>
        </div>
        {/* Status row */}
        <div className="mt-2 flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <span className={classNames('w-2 h-2 rounded-full', dotColor, isHealthy && 'animate-pulse')} />
            <span className={classNames('text-[10px] uppercase tracking-wider font-medium', statusColor)}>{svc.status || 'unknown'}</span>
            {!svc.enabled && <span className="badge-neutral text-[9px]">disabled</span>}
          </div>
        </div>
        {/* Upstream targets */}
        <div className="mt-2 space-y-0.5">
          {(svc.upstreamTargets || []).map((t, i) => (
            <div key={i} className="flex items-center gap-1.5 text-[10px]">
              <span className={classNames('w-1 h-1 rounded-full', t.healthy !== false ? 'bg-brand-400' : 'bg-rose-400')} />
              <code className="font-mono text-slate-500 truncate">{t.url}</code>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
