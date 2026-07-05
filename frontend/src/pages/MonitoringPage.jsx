/**
 * EdgeFlow - Monitoring page
 */

import React, { useEffect, useState, useCallback } from 'react';
import { Activity, Database, Server, Zap, ShieldAlert, RefreshCw, Trash2, Power, AlertTriangle } from 'lucide-react';
import { monitoringApi } from '../api/endpoints';
import Card from '../components/ui/Card';
import { useToast } from '../utils/toast';
import { classNames, formatRelative, formatMs, formatNumber, formatBytes, formatUptime } from '../utils/format';

export default function MonitoringPage() {
  const [status, setStatus] = useState(null);
  const [breakers, setBreakers] = useState([]);
  const [loading, setLoading] = useState(true);
  const toast = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, cb] = await Promise.all([monitoringApi.ready(), monitoringApi.circuitBreakers().catch(() => [])]);
      setStatus(s); setBreakers(cb);
    } catch {} finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); const id = setInterval(load, 15000); return () => clearInterval(id); }, [load]);

  const handleFlush = async () => { try { await monitoringApi.cacheFlush(); toast.success('Cache flushed'); load(); } catch {} };
  const handleResetBreaker = async (url) => { try { await monitoringApi.resetCircuit(url); toast.success(`Circuit breaker reset for ${url}`); load(); } catch {} };

  const sub = status?.subsystems || {};

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div><h2 className="text-xl font-semibold text-slate-100">System Monitoring</h2><p className="text-sm text-slate-500 mt-1">Real-time health of every EdgeFlow subsystem. Auto-refreshes every 15s.</p></div>
        <button onClick={load} className="btn-secondary"><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh</button>
      </div>

      <div className={classNames('card p-5 flex items-center gap-4 border-l-4', status?.status === 'ok' ? 'border-l-brand-500' : status?.status === 'degraded' ? 'border-l-amber-500' : 'border-l-rose-500')}>
        {status?.status === 'ok' ? <Activity className="text-brand-400" size={28} />
          : status?.status === 'degraded' ? <AlertTriangle className="text-amber-400" size={28} />
          : <AlertTriangle className="text-rose-400" size={28} />}
        <div>
          <div className="text-lg font-semibold text-slate-100 uppercase">{status?.status || 'unknown'}</div>
          <div className="text-xs text-slate-500">Uptime: {formatUptime(status?.uptimeSec)} · Updated {formatRelative(status?.timestamp)}</div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <SubsystemCard title="PostgreSQL" icon={Database} status={sub.database?.status} rows={[
          ['State', sub.database?.status || '—'],
          ['Latency', formatMs(sub.database?.latencyMs)],
          ['Pool total', formatNumber(sub.database?.pool?.total)],
          ['Pool idle', formatNumber(sub.database?.pool?.idle)],
          ['Pool waiting', formatNumber(sub.database?.pool?.waiting)],
        ]} />
        <SubsystemCard title="Redis" icon={Zap} status={sub.redis?.status} rows={[
          ['State', sub.redis?.status || '—'],
          ['Latency', formatMs(sub.redis?.latencyMs)],
          ['Fallback mode', sub.redis?.fallback ? 'YES (in-memory)' : 'no'],
          ['Memory used', formatBytes(sub.redis?.memoryUsed)],
          ['Memory peak', formatBytes(sub.redis?.memoryPeak)],
        ]} />
        <SubsystemCard title="Route Cache" icon={Server} status={sub.routeCache?.status} rows={[
          ['Routes cached', formatNumber(sub.routeCache?.routes)],
          ['Last refresh', formatRelative(sub.routeCache?.lastRefreshedAt)],
        ]} />
        <SubsystemCard title="Service Registry" icon={Activity} status={sub.services?.status} rows={[
          ['Healthy', formatNumber(sub.services?.healthy)],
          ['Unhealthy', formatNumber(sub.services?.unhealthy)],
          ['Unknown', formatNumber(sub.services?.unknown)],
          ['Total', formatNumber(sub.services?.total)],
        ]} />
        <SubsystemCard title="Circuit Breakers" icon={ShieldAlert} status={sub.circuitBreakers?.status} rows={[
          ['Closed', formatNumber(sub.circuitBreakers?.closedCount)],
          ['Open', formatNumber(sub.circuitBreakers?.openCount)],
          ['Half-open', formatNumber(sub.circuitBreakers?.halfOpenCount)],
        ]} />
        <SubsystemCard title="Live Metrics" icon={Activity} status="ok" rows={[
          ['P95 latency', formatMs(sub.live?.p95LatencyMs)],
          ['Active requests', formatNumber(sub.live?.activeRequests)],
          ['Requests/sec', (sub.live?.requestsPerSecond || 0).toFixed(2)],
        ]} />
      </div>

      <Card title="Response Cache" subtitle="Redis-backed response cache management" action={<button onClick={handleFlush} className="btn-danger"><Trash2 size={14} /> Flush All</button>}>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Metric label="Keys in cache" value={formatNumber(sub.redis?.dbSize >= 0 ? sub.redis.dbSize : '—')} />
          <Metric label="Redis mode" value={sub.redis?.fallback ? 'Fallback' : 'Live'} />
          <Metric label="Default TTL" value="60s" />
          <Metric label="Hit rate (60m)" value="—" />
        </div>
      </Card>

      <Card title="Circuit Breaker States" subtitle="Per-upstream-URL circuit states. Reset to force-close." noPadding>
        {breakers.length === 0 ? <div className="p-6 text-center text-sm text-slate-500">No circuit breakers active yet. They appear here after the gateway starts tracking upstream failures.</div> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs uppercase tracking-wider text-slate-500 border-b border-slate-800">
                <th className="px-4 py-3 font-medium">Upstream URL</th>
                <th className="px-4 py-3 font-medium">State</th>
                <th className="px-4 py-3 font-medium">Failures</th>
                <th className="px-4 py-3 font-medium">Successes</th>
                <th className="px-4 py-3 font-medium">Opened At</th>
                <th className="px-4 py-3 font-medium text-right">Action</th>
              </tr></thead>
              <tbody>
                {breakers.map((b) => (
                  <tr key={b.upstreamUrl} className="table-row">
                    <td className="px-4 py-3 font-mono text-xs text-slate-300">{b.upstreamUrl}</td>
                    <td className="px-4 py-3"><span className={classNames('badge', b.state === 'closed' ? 'badge-success' : b.state === 'half_open' ? 'badge-warning' : 'badge-danger')}>{b.state}</span></td>
                    <td className="px-4 py-3 text-slate-300">{b.failureCount}</td>
                    <td className="px-4 py-3 text-slate-300">{b.successCount}</td>
                    <td className="px-4 py-3 text-xs text-slate-500">{formatRelative(b.openedAt)}</td>
                    <td className="px-4 py-3 text-right"><button onClick={() => handleResetBreaker(b.upstreamUrl)} className="btn-ghost text-xs"><Power size={12} /> Reset</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function SubsystemCard({ title, icon: Icon, status, rows }) {
  const statusColor = status === 'ok' ? 'text-brand-400' : status === 'degraded' ? 'text-amber-400' : status === 'down' ? 'text-rose-400' : 'text-slate-500';
  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2"><Icon size={16} className="text-slate-400" /><h3 className="text-sm font-semibold text-slate-100">{title}</h3></div>
        <span className={classNames('text-xs font-semibold uppercase', statusColor)}>{status || '—'}</span>
      </div>
      <div className="space-y-1.5">
        {rows.map(([k, v]) => (
          <div key={k} className="flex items-center justify-between text-xs"><span className="text-slate-500">{k}</span><span className="text-slate-200 font-mono">{v}</span></div>
        ))}
      </div>
    </div>
  );
}

function Metric({ label, value }) {
  return <div className="bg-slate-900/40 rounded-lg p-3"><div className="text-xs text-slate-500 uppercase tracking-wider">{label}</div><div className="text-lg font-semibold text-slate-100 mt-1">{value}</div></div>;
}
