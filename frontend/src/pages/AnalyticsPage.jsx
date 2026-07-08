/**
 * EdgeFlow - Analytics page
 */

import React, { useEffect, useState, useCallback } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line } from 'recharts';
import { analyticsApi } from '../api/endpoints';
import ChartCard from '../components/charts/ChartCard';
import LiveRequestsChart from '../components/charts/LiveRequestsChart';
import StatusCodeChart from '../components/charts/StatusCodeChart';
import Card from '../components/ui/Card';
import EmptyState from '../components/ui/EmptyState';
import { BarChart3 } from 'lucide-react';
import { formatNumber, formatMs } from '../utils/format';

const tooltipStyle = { backgroundColor: 'rgb(15 23 42)', border: '1px solid rgb(51 65 85)', borderRadius: 8, fontSize: 12, color: 'rgb(226 232 240)' };

export default function AnalyticsPage() {
  const [windowMinutes, setWindowMinutes] = useState(60);
  const [perMin, setPerMin] = useState([]);
  const [perSvc, setPerSvc] = useState([]);
  const [topRoutes, setTopRoutes] = useState([]);
  const [statusBreakdown, setStatusBreakdown] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [pm, ps, tr, sb] = await Promise.all([
        analyticsApi.perMinute(windowMinutes), analyticsApi.perService(windowMinutes),
        analyticsApi.topRoutes(windowMinutes), analyticsApi.statusBreakdown(windowMinutes),
      ]);
      setPerMin(pm); setPerSvc(ps); setTopRoutes(tr); setStatusBreakdown(sb);
    } catch {} finally { setLoading(false); }
  }, [windowMinutes]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div><h2 className="text-xl font-semibold text-slate-100">Analytics</h2><p className="text-sm text-slate-500 mt-1">Aggregated rollups across all proxied traffic.</p></div>
        <select className="input w-auto" value={windowMinutes} onChange={(e) => setWindowMinutes(parseInt(e.target.value, 10))}>
          <option value={15}>Last 15 minutes</option>
          <option value={60}>Last hour</option>
          <option value={360}>Last 6 hours</option>
          <option value={1440}>Last 24 hours</option>
        </select>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <LiveRequestsChart data={perMin} loading={loading} />
        <ChartCard title="Average Latency" subtitle="Per-minute average response time (ms)" loading={loading}>
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={perMin} margin={{ top: 10, right: 8, left: -16, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgb(30 41 59)" />
              <XAxis dataKey="label" stroke="rgb(100 116 139)" fontSize={11} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={40} />
              <YAxis stroke="rgb(100 116 139)" fontSize={11} tickLine={false} axisLine={false} tickFormatter={(v) => `${v}ms`} />
              <Tooltip contentStyle={tooltipStyle} formatter={(v) => [`${Math.round(v)}ms`, 'Avg latency']} />
              <Line type="monotone" dataKey="avgLatencyMs" stroke="#0ea5e9" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartCard title="Requests by Service" subtitle={`Top services in the last ${windowMinutes}m`} loading={loading}>
          {perSvc.length === 0 ? <div className="h-[260px] flex items-center justify-center text-sm text-slate-500">No service-level traffic yet</div> : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={perSvc} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgb(30 41 59)" horizontal={false} />
                <XAxis type="number" stroke="rgb(100 116 139)" fontSize={11} tickLine={false} axisLine={false} />
                <YAxis type="category" dataKey="name" stroke="rgb(100 116 139)" fontSize={11} tickLine={false} axisLine={false} width={120} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v, n) => [formatNumber(v), n === 'requests' ? 'Requests' : n]} />
                <Bar dataKey="requests" fill="#22d3ee" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
        <StatusCodeChart data={statusBreakdown} loading={loading} />
      </div>

      <Card title="Top Routes" subtitle={`Most-used API paths in the last ${windowMinutes}m`} noPadding>
        {topRoutes.length === 0 ? <EmptyState icon={BarChart3} title="No route-level traffic yet" description="Top routes will appear here once the gateway has proxied a few requests." /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs uppercase tracking-wider text-slate-500 border-b border-slate-800">
                <th className="px-4 py-3 font-medium">Method</th>
                <th className="px-4 py-3 font-medium">Path</th>
                <th className="px-4 py-3 font-medium text-right">Requests</th>
                <th className="px-4 py-3 font-medium text-right">Avg Latency</th>
                <th className="px-4 py-3 font-medium text-right">Errors</th>
              </tr></thead>
              <tbody>
                {topRoutes.map((r, i) => (
                  <tr key={i} className="table-row">
                    <td className="px-4 py-3"><span className="badge-neutral font-mono">{r.method}</span></td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-300">{r.public_path}</td>
                    <td className="px-4 py-3 text-right text-slate-100 font-medium">{formatNumber(r.requests)}</td>
                    <td className="px-4 py-3 text-right text-slate-300">{formatMs(r.avg_latency_ms)}</td>
                    <td className="px-4 py-3 text-right"><span className={r.errors > 0 ? 'text-rose-400' : 'text-slate-500'}>{formatNumber(r.errors)}</span></td>
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
