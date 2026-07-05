/**
 * EdgeFlow - Dashboard page (Live Metrics Dashboard)
 *
 * Shows the 10 required live metrics:
 *   - Gateway Uptime
 *   - Active Requests
 *   - Requests/sec
 *   - Requests/minute
 *   - P95 Latency
 *   - Error Rate
 *   - Cache Hit Ratio
 *   - Circuit Breaker State
 *   - Redis Memory Usage
 *   - PostgreSQL Connections
 */

import React, { useEffect, useState, useCallback } from 'react';
import {
  Activity, Server, CheckCircle2, AlertTriangle, Zap, Database,
  Gauge, TrendingUp, Clock, Cpu, MemoryStick, GitBranch, Layers,
} from 'lucide-react';
import { dashboardApi, servicesApi } from '../api/endpoints';
import StatCard from '../components/ui/StatCard';
import Card from '../components/ui/Card';
import LiveRequestsChart from '../components/charts/LiveRequestsChart';
import StatusCodeChart from '../components/charts/StatusCodeChart';
import { formatNumber, formatPercent, formatMs, formatRelative, formatBytes, formatUptime, statusBadge, classNames } from '../utils/format';

export default function DashboardPage() {
  const [overview, setOverview] = useState(null);
  const [liveMetrics, setLiveMetrics] = useState(null);
  const [liveGraph, setLiveGraph] = useState([]);
  const [services, setServices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [graphLoading, setGraphLoading] = useState(true);

  const loadOverview = useCallback(async () => {
    try {
      const [ov, svc] = await Promise.all([
        dashboardApi.overview(60),
        servicesApi.list({ limit: 100 }),
      ]);
      setOverview(ov); setServices(svc);
    } catch {} finally { setLoading(false); }
  }, []);

  const loadLive = useCallback(async () => {
    try {
      const [lm, lg] = await Promise.all([
        dashboardApi.liveMetrics(),
        dashboardApi.liveGraph(60),
      ]);
      setLiveMetrics(lm); setLiveGraph(lg);
    } catch {} finally { setGraphLoading(false); }
  }, []);

  useEffect(() => {
    loadOverview(); loadLive();
    const id1 = setInterval(loadLive, 5000);
    const id2 = setInterval(loadOverview, 60000);
    return () => { clearInterval(id1); clearInterval(id2); };
  }, [loadOverview, loadLive]);

  const m = overview?.metrics || {};
  const live = overview?.live || {};
  const svcStats = overview?.services || { healthy: 0, unhealthy: 0, unknown: 0, total: 0 };
  const topServices = overview?.topServices || [];
  const statusData = overview?.statusBreakdown || [];
  const lm = liveMetrics || {};

  return (
    <div className="space-y-6">
      {/* 10 live metric tiles */}
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-4">
        <StatCard label="Uptime" value={formatUptime(live.uptimeSec || m.uptimeSec)} icon={Clock} accent="emerald" isLoading={loading} />
        <StatCard label="Active Requests" value={lm.activeRequests ?? m.activeRequests ?? 0} icon={Activity} accent="sky" isLoading={loading} />
        <StatCard label="Requests/sec" value={(lm.requestsPerSecond ?? m.requestsPerSecond ?? 0).toFixed(1)} icon={Gauge} accent="brand" isLoading={loading} />
        <StatCard label="P95 Latency" value={formatMs(lm.p95LatencyMs ?? m.p95LatencyMs)} icon={Zap} accent="amber" isLoading={loading} goodWhenUp={false} />
        <StatCard label="Error Rate" value={formatPercent(m.errorRate)} icon={AlertTriangle} accent="rose" isLoading={loading} goodWhenUp={false} />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-4">
        <StatCard label="Cache Hit Ratio" value={formatPercent(m.cacheHitRate)} icon={Database} accent="violet" isLoading={loading} />
        <StatCard label="Circuit Breakers" value={`${lm.circuitBreakers?.openCount ?? live.circuitBreakerState?.openCount ?? 0} open`} icon={GitBranch} accent={lm.circuitBreakers?.openCount > 0 ? 'rose' : 'emerald'} isLoading={loading} />
        <StatCard label="Redis Memory" value={formatBytes(lm.redisMemoryUsed ?? live.redisMemoryUsed)} icon={MemoryStick} accent="brand" isLoading={loading} />
        <StatCard label="PG Connections" value={`${lm.pgConnections?.total ?? live.pgConnections?.total ?? 0}/${lm.pgConnections?.idle ?? live.pgConnections?.idle ?? 0}`} icon={Layers} accent="sky" isLoading={loading} />
        <StatCard label="Total Services" value={m.totalServices} icon={Server} accent="brand" isLoading={loading} />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2"><LiveRequestsChart data={liveGraph} loading={graphLoading} /></div>
        <StatusCodeChart data={statusData} loading={loading} />
      </div>

      {/* Service registry + top services + circuit breakers */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card title="Service Registry" subtitle="Health summary across all enabled services">
          <div className="grid grid-cols-3 gap-3 text-center mb-4">
            <HealthTile label="Healthy" value={svcStats.healthy} variant="success" />
            <HealthTile label="Unhealthy" value={svcStats.unhealthy} variant="danger" />
            <HealthTile label="Unknown" value={svcStats.unknown} variant="neutral" />
          </div>
          <div className="mt-4 space-y-2 max-h-72 overflow-y-auto">
            {services.length === 0 ? <p className="text-sm text-slate-500 text-center py-6">No services registered yet.</p> : services.map((s) => (
              <div key={s.id} className="flex items-center justify-between px-3 py-2 rounded-lg bg-slate-900/40 hover:bg-slate-800/40 transition">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-slate-200 truncate">{s.name}</div>
                  <div className="text-xs text-slate-500 font-mono truncate">{s.base_path} · {s.version}</div>
                </div>
                <div className="flex items-center gap-2 ml-2 shrink-0">
                  <span className={classNames('badge', `badge-${statusBadge(s.last_status)}`)}>{s.last_status || 'unknown'}</span>
                  {!s.enabled && <span className="badge-neutral">disabled</span>}
                  <span className="text-[10px] text-slate-600" title={s.last_heartbeat_at}>{formatRelative(s.last_heartbeat_at)}</span>
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card title="Top Services by Requests" subtitle="Highest-traffic services in the last 60 minutes">
          {topServices.length === 0 ? (
            <div className="text-sm text-slate-500 text-center py-12">No traffic yet</div>
          ) : (
            <div className="space-y-3">
              {topServices.map((s) => {
                const pct = topServices[0]?.requests > 0 ? (s.requests / topServices[0].requests) * 100 : 0;
                return (
                  <div key={s.id}>
                    <div className="flex items-center justify-between mb-1">
                      <div className="text-sm font-medium text-slate-200 truncate">{s.name}</div>
                      <div className="text-xs text-slate-400 font-mono">{formatNumber(s.requests)} req</div>
                    </div>
                    <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
                      <div className="h-full bg-gradient-to-r from-brand-600 to-brand-400 rounded-full" style={{ width: `${pct}%` }} />
                    </div>
                    <div className="flex justify-between text-[10px] text-slate-500 mt-0.5">
                      <span>{formatMs(s.avgLatencyMs)} avg</span>
                      <span className={s.errors > 0 ? 'text-rose-400' : ''}>{formatNumber(s.errors)} errors</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        <Card title="Circuit Breaker States" subtitle="Per-upstream circuit states (live)">
          <CircuitBreakerList />
        </Card>
      </div>
    </div>
  );
}

function HealthTile({ label, value, variant }) {
  const colors = { success: 'text-brand-300 bg-brand-500/10', danger: 'text-rose-300 bg-rose-500/10', neutral: 'text-slate-300 bg-slate-700/30' };
  return (
    <div className={`rounded-lg p-3 ${colors[variant]}`}>
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-xs uppercase tracking-wider opacity-80">{label}</div>
    </div>
  );
}

function CircuitBreakerList() {
  const [breakers, setBreakers] = useState([]);
  useEffect(() => {
    const load = async () => {
      try {
        const { monitoringApi } = await import('../api/endpoints');
        setBreakers(await monitoringApi.circuitBreakers());
      } catch {}
    };
    load();
    const id = setInterval(load, 10000);
    return () => clearInterval(id);
  }, []);

  if (breakers.length === 0) {
    return <div className="text-sm text-slate-500 text-center py-12">No circuit breakers active yet</div>;
  }
  return (
    <div className="space-y-2 max-h-72 overflow-y-auto">
      {breakers.map((b) => (
        <div key={b.upstreamUrl} className="px-3 py-2 rounded-lg bg-slate-900/40">
          <div className="flex items-center justify-between gap-2">
            <code className="text-xs text-slate-300 font-mono truncate flex-1">{b.upstreamUrl}</code>
            <span className={classNames('badge', b.state === 'closed' ? 'badge-success' : b.state === 'half_open' ? 'badge-warning' : 'badge-danger')}>{b.state}</span>
          </div>
          <div className="flex justify-between text-[10px] text-slate-500 mt-1">
            <span>Failures: {b.failureCount}</span>
            <span>Successes: {b.successCount}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
