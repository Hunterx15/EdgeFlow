/**
 * EdgeFlow - Request Logs page (auto-refreshing)
 */

import React, { useEffect, useState, useCallback } from 'react';
import { Pause, Play, Filter, ScrollText } from 'lucide-react';
import { logsApi, servicesApi } from '../api/endpoints';
import Card from '../components/ui/Card';
import EmptyState from '../components/ui/EmptyState';
import TableSkeleton from '../components/ui/TableSkeleton';
import { formatRelative, formatDate, statusCodeBadge, classNames, formatMs, formatBytes } from '../utils/format';

export default function LogsPage() {
  const [items, setItems] = useState([]);
  const [services, setServices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState({ serviceId: '', statusCode: '', limit: 50, offset: 0 });
  const [autoRefresh, setAutoRefresh] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = { limit: filter.limit, offset: filter.offset };
      if (filter.serviceId) params.serviceId = filter.serviceId;
      if (filter.statusCode) params.statusCode = filter.statusCode;
      setItems(await logsApi.list(params));
    } catch {} finally { setLoading(false); }
  }, [filter]);

  useEffect(() => { servicesApi.list({ limit: 200 }).then(setServices).catch(() => {}); }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (!autoRefresh) return; const id = setInterval(load, 15000); return () => clearInterval(id); }, [autoRefresh, load]);

  const serviceName = (id) => services.find((s) => s.id === id)?.name || '—';

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div><h2 className="text-xl font-semibold text-slate-100">Request Logs</h2><p className="text-sm text-slate-500 mt-1">Every proxied request, in reverse-chronological order.</p></div>
        <button onClick={() => setAutoRefresh((v) => !v)} className={classNames('btn-secondary', autoRefresh && 'text-brand-300')} title="Toggle auto-refresh">
          {autoRefresh ? <Pause size={14} /> : <Play size={14} />} {autoRefresh ? 'Auto (15s)' : 'Paused'}
        </button>
      </div>

      <Card>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[200px]"><label className="label">Filter by service</label>
            <select className="input" value={filter.serviceId} onChange={(e) => setFilter((f) => ({ ...f, serviceId: e.target.value, offset: 0 }))}>
              <option value="">All services</option>
              {services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div className="flex-1 min-w-[150px]"><label className="label">Status code</label>
            <select className="input" value={filter.statusCode} onChange={(e) => setFilter((f) => ({ ...f, statusCode: e.target.value, offset: 0 }))}>
              <option value="">All</option>
              <option value="200">2xx Success</option>
              <option value="300">3xx Redirect</option>
              <option value="400">4xx Client error</option>
              <option value="500">5xx Server error</option>
            </select>
          </div>
          <button onClick={load} className="btn-secondary"><Filter size={14} /> Refresh</button>
        </div>
      </Card>

      <Card noPadding>
        {loading ? <TableSkeleton rows={8} cols={7} /> : items.length === 0 ? (
          <EmptyState icon={ScrollText} title="No logs yet" description="Send a few requests through the gateway (e.g. /gateway/<your-path>) to see them here." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs uppercase tracking-wider text-slate-500 border-b border-slate-800">
                <th className="px-4 py-3 font-medium">Time</th>
                <th className="px-4 py-3 font-medium">Method</th>
                <th className="px-4 py-3 font-medium">Path</th>
                <th className="px-4 py-3 font-medium">Service</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Latency</th>
                <th className="px-4 py-3 font-medium">Cache</th>
                <th className="px-4 py-3 font-medium">Request ID</th>
              </tr></thead>
              <tbody>
                {items.map((l) => (
                  <tr key={l.id} className="table-row">
                    <td className="px-4 py-3 text-xs text-slate-400" title={formatDate(l.created_at)}>{formatRelative(l.created_at)}</td>
                    <td className="px-4 py-3"><span className={classNames('badge font-mono', l.method === 'GET' ? 'badge-success' : l.method === 'POST' ? 'badge-info' : l.method === 'DELETE' ? 'badge-danger' : 'badge-warning')}>{l.method}</span></td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-300 max-w-xs truncate" title={l.public_path}>{l.public_path}</td>
                    <td className="px-4 py-3 text-slate-300">{serviceName(l.service_id)}</td>
                    <td className="px-4 py-3"><span className={classNames('badge', `badge-${statusCodeBadge(l.status_code)}`)}>{l.status_code || '—'}</span>
                      {l.retry_count > 0 && <span className="ml-1 text-xs text-amber-400">↻{l.retry_count}</span>}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-400">{formatMs(l.latency_ms)}</td>
                    <td className="px-4 py-3">{l.cache_hit ? <span className="badge-success">HIT</span> : <span className="text-slate-600">—</span>}</td>
                    <td className="px-4 py-3 font-mono text-[10px] text-slate-600 truncate max-w-[120px]" title={l.request_id}>{l.request_id?.slice(0, 16)}…</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {items.length > 0 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-slate-800 text-xs text-slate-500">
            <div>Showing {items.length} logs
              {filter.offset > 0 && <button className="text-brand-400 hover:underline ml-2" onClick={() => setFilter((f) => ({ ...f, offset: Math.max(0, f.offset - f.limit) }))}>← Prev</button>}
              {items.length === filter.limit && <button className="text-brand-400 hover:underline ml-2" onClick={() => setFilter((f) => ({ ...f, offset: f.offset + f.limit }))}>Next →</button>}
            </div>
            {items[0] && <div>Response size: {formatBytes(items[0]?.response_size)}</div>}
          </div>
        )}
      </Card>
    </div>
  );
}
