/**
 * EdgeFlow - Monitoring page
 *
 * Real-time health of every EdgeFlow subsystem:
 *   - PostgreSQL (pool usage, latency)
 *   - Redis (memory, connections, uptime, ops/sec)
 *   - Node.js runtime (heap, RSS, CPU, event loop lag, active handles)
 *   - Route cache (size, last refresh)
 *   - Service registry (healthy/unhealthy/total)
 *   - Circuit breakers (open/half-open/closed + per-upstream details)
 *   - Live metrics (P50/P95/P99 latency, active requests, RPS)
 *
 * Auto-refreshes every 15s.
 */

import React, { useEffect, useState, useCallback } from 'react';
import { Activity, Database, Server, Zap, ShieldAlert, RefreshCw, Trash2, Power, AlertTriangle, Cpu, HardDrive, Timer } from 'lucide-react';
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

  const handleFlush = async () => { try { await monitoringApi.cacheFlush(); toast.success('Cache flushed (cache:* keys only)'); load(); } catch {} };
  const handleResetBreaker = async (url) => { try { await monitoringApi.resetCircuit(url); toast.success(`Circuit breaker reset for ${url}`); load(); } catch {} };

  const sub = status?.subsystems || {};

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div><h2 className="text-xl font-semibold text-slate-100">System Monitoring</h2><p className="text-sm text-slate-500 mt-1">Real-time health of every EdgeFlow subsystem. Auto-refreshes every 15s.</p></div>
        <button onClick={load} className="btn-secondary"><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh</button>
      </div>

      {/* Overall status banner */}
      <div className={classNames('card p-5 flex items-center gap-4 border-l-4', status?.status === 'ok' ? 'border-l-brand-500' : status?.status === 'degraded' ? 'border-l-amber-500' : 'border-l-rose-500')}>
        {status?.status === 'ok' ? <Activity className="text-brand-400" size={28} />
          : status?.status === 'degraded' ? <AlertTriangle className="text-amber-400" size={28} />
          : <AlertTriangle className="text-rose-400" size={28} />}
        <div className="flex-1">
          <div className="text-lg font-semibold text-slate-100 uppercase">{status?.status || 'unknown'}</div>
          <div className="text-xs text-slate-500">Uptime: {formatUptime(status?.uptimeSec)} · Updated {formatRelative(status?.timestamp)}</div>
        </div>
        {/* Live metrics mini-bar */}
        <div className="flex gap-6">
          <MiniMetric label="P95" value={formatMs(sub.live?.p95LatencyMs)} />
          <MiniMetric label="Active" value={formatNumber(sub.live?.activeRequests)} />
          <MiniMetric label="RPS" value={(sub.live?.requestsPerSecond || 0).toFixed(1)} />
        </div>
      </div>

      {/* Latency percentiles */}
      <Card title="Latency Percentiles (last 60 min)" subtitle="P50 / P95 / P99 — real data from request_logs">
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <Metric label="P50" value={formatMs(sub.live?.p50LatencyMs)} color="text-emerald-400" />
          <Metric label="P95" value={formatMs(sub.live?.p95LatencyMs)} color="text-amber-400" />
          <Metric label="P99" value={formatMs(sub.live?.p99LatencyMs)} color="text-rose-400" />
          <Metric label="Avg" value={formatMs(sub.live?.avgLatencyMs)} />
          <Metric label="Max" value={formatMs(sub.live?.maxLatencyMs)} />
        </div>
      </Card>

      {/* Subsystem grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {/* PostgreSQL */}
        <SubsystemCard title="PostgreSQL" icon={Database} status={sub.database?.status} rows={[
          ['Latency', formatMs(sub.database?.latencyMs)],
          ['Pool total', formatNumber(sub.database?.pool?.total)],
          ['Pool idle', formatNumber(sub.database?.pool?.idle)],
          ['Pool waiting', formatNumber(sub.database?.pool?.waiting)],
          ['State', sub.database?.error ? `Error: ${sub.database.error}` : 'Connected'],
        ]} />

        {/* Redis — enhanced */}
        <SubsystemCard title="Redis" icon={Zap} status={sub.redis?.status} rows={[
          ['Latency', formatMs(sub.redis?.latencyMs)],
          ['Mode', sub.redis?.fallback ? 'Fallback (in-memory)' : 'Live'],
          ['Memory used', formatBytes(sub.redis?.memoryUsed)],
          ['Memory peak', formatBytes(sub.redis?.memoryPeak)],
          ['Connected clients', formatNumber(sub.redis?.connectedClients)],
          ['Uptime', formatUptime(sub.redis?.uptimeSec)],
          ['Ops/sec', formatNumber(sub.redis?.opsPerSec)],
          ['DB size (keys)', formatNumber(sub.redis?.dbSize)],
        ]} />

        {/* Node.js runtime — NEW */}
        <SubsystemCard title="Node.js Runtime" icon={Cpu} status="ok" rows={[
          ['Heap used', `${formatBytes(sub.node?.heapUsed)} (${sub.node?.heapUsedMB}MB)`],
          ['Heap total', `${formatBytes(sub.node?.heapTotal)} (${sub.node?.heapTotalMB}MB)`],
          ['RSS (resident)', `${formatBytes(sub.node?.rss)} (${sub.node?.rssMB}MB)`],
          ['External mem', formatBytes(sub.node?.external)],
          ['Event loop lag', formatMs(sub.node?.eventLoopLagMs)],
          ['Active handles', formatNumber(sub.node?.activeHandles)],
          ['Active requests', formatNumber(sub.node?.activeRequests)],
          ['Process uptime', formatUptime(sub.node?.uptimeSec)],
        ]} />

        {/* Route Cache */}
        <SubsystemCard title="Route Cache" icon={Server} status={sub.routeCache?.status} rows={[
          ['Routes cached', formatNumber(sub.routeCache?.routes)],
          ['Last refresh', formatRelative(sub.routeCache?.lastRefreshedAt)],
        ]} />

        {/* Service Registry */}
        <SubsystemCard title="Service Registry" icon={Activity} status={sub.services?.status} rows={[
          ['Healthy', formatNumber(sub.services?.healthy)],
          ['Unhealthy', formatNumber(sub.services?.unhealthy)],
          ['Unknown', formatNumber(sub.services?.unknown)],
          ['Total', formatNumber(sub.services?.total)],
        ]} />

        {/* Circuit Breakers summary */}
        <SubsystemCard title="Circuit Breakers" icon={ShieldAlert} status={sub.circuitBreakers?.status} rows={[
          ['Closed', formatNumber(sub.circuitBreakers?.closedCount)],
          ['Open', formatNumber(sub.circuitBreakers?.openCount)],
          ['Half-open', formatNumber(sub.circuitBreakers?.halfOpenCount)],
        ]} />
      </div>

      {/* Memory usage bar chart */}
      {sub.node && (
        <Card title="Node.js Memory Usage" subtitle="Heap vs RSS vs External">
          <MemoryBarChart
            heapUsed={sub.node?.heapUsed}
            heapTotal={sub.node?.heapTotal}
            rss={sub.node?.rss}
            external={sub.node?.external}
          />
        </Card>
      )}

      {/* Response cache management */}
      <Card title="Response Cache" subtitle="Redis-backed response cache. Flush only clears cache:* keys (not rate-limit or circuit-breaker keys)." action={<button onClick={handleFlush} className="btn-danger"><Trash2 size={14} /> Flush cache:*</button>}>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Metric label="Keys in Redis" value={formatNumber(sub.redis?.dbSize >= 0 ? sub.redis.dbSize : '—')} />
          <Metric label="Redis mode" value={sub.redis?.fallback ? 'Fallback' : 'Live'} />
          <Metric label="Default TTL" value="60s" />
          <Metric label="Total routes" value={formatNumber(sub.counters?.totalRoutes)} />
        </div>
      </Card>

      {/* Circuit breaker details */}
      <Card title="Circuit Breaker States" subtitle="Per-upstream-URL circuit states. Reset to force-close (moves to CLOSED and resets counters)." noPadding>
        {breakers.length === 0 ? <div className="p-6 text-center text-sm text-slate-500">No circuit breakers active yet. They appear here after the gateway starts tracking upstream failures.</div> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs uppercase tracking-wider text-slate-500 border-b border-slate-800">
                <th className="px-4 py-3 font-medium">Upstream URL</th>
                <th className="px-4 py-3 font-medium">State</th>
                <th className="px-4 py-3 font-medium">Failures</th>
                <th className="px-4 py-3 font-medium">Successes</th>
                <th className="px-4 py-3 font-medium">Opened At</th>
                <th className="px-4 py-3 font-medium">Last Transition</th>
                <th className="px-4 py-3 font-medium text-right">Action</th>
              </tr></thead>
              <tbody>
                {breakers.map((b) => (
                  <tr key={b.upstreamUrl} className="table-row">
                    <td className="px-4 py-3 font-mono text-xs text-slate-300">{b.upstreamUrl}</td>
                    <td className="px-4 py-3"><span className={classNames('badge', b.state === 'closed' ? 'badge-success' : b.state === 'half_open' ? 'badge-warning' : 'badge-danger')}>{b.state}</span></td>
                    <td className="px-4 py-3 text-slate-300">{b.failureCount}</td>
                    <td className="px-4 py-3 text-slate-300">{b.successCount}</td>
                    <td className="px-4 py-3 text-xs text-slate-500">{b.openedAt ? formatRelative(b.openedAt) : '—'}</td>
                    <td className="px-4 py-3 text-xs text-slate-500">{b.lastTransitionAt ? formatRelative(b.lastTransitionAt) : '—'}</td>
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

// ── Memory bar chart ──
function MemoryBarChart({ heapUsed, heapTotal, rss, external }) {
  const max = Math.max(heapTotal || 0, rss || 0, external || 0, 1);
  const bars = [
    { label: 'Heap Used', value: heapUsed || 0, color: 'bg-brand-500', display: formatBytes(heapUsed) },
    { label: 'Heap Total', value: heapTotal || 0, color: 'bg-sky-500', display: formatBytes(heapTotal) },
    { label: 'RSS', value: rss || 0, color: 'bg-amber-500', display: formatBytes(rss) },
    { label: 'External', value: external || 0, color: 'bg-purple-500', display: formatBytes(external) },
  ];
  return (
    <div className="space-y-2">
      {bars.map((b) => (
        <div key={b.label} className="flex items-center gap-3 text-xs">
          <span className="text-slate-400 w-24 shrink-0">{b.label}</span>
          <div className="flex-1 bg-slate-800 rounded h-5 overflow-hidden">
            <div className={classNames(b.color, 'h-full rounded flex items-center justify-end px-2')} style={{ width: `${Math.max((b.value / max) * 100, 2)}%` }}>
              <span className="text-[10px] text-white font-mono">{b.display}</span>
            </div>
          </div>
        </div>
      ))}
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
          <div key={k} className="flex items-center justify-between text-xs"><span className="text-slate-500">{k}</span><span className="text-slate-200 font-mono text-right max-w-[60%] truncate">{v}</span></div>
        ))}
      </div>
    </div>
  );
}

function Metric({ label, value, color }) {
  return (
    <div className="bg-slate-900/40 rounded-lg p-3">
      <div className="text-xs text-slate-500 uppercase tracking-wider">{label}</div>
      <div className={classNames('text-lg font-semibold mt-1', color || 'text-slate-100')}>{value}</div>
    </div>
  );
}

function MiniMetric({ label, value }) {
  return (
    <div className="text-center">
      <div className="text-xs text-slate-500 uppercase">{label}</div>
      <div className="text-sm font-mono text-slate-200">{value}</div>
    </div>
  );
}
