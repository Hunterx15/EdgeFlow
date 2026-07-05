/**
 * EdgeFlow - Gateway Timeline page
 *
 * Vertical timeline of recent requests, each one showing the chain:
 *   12:10:32 Incoming Request → JWT Verified → Rate Limited → Cache Miss
 *   → Service Selected → Forwarded → Response → 200 OK → 41ms
 *
 * Auto-refreshes every 10s so it feels live.
 */

import React, { useEffect, useState, useCallback } from 'react';
import { GitBranch, RefreshCw, Clock, ArrowDown } from 'lucide-react';
import { logsApi } from '../api/endpoints';
import Card from '../components/ui/Card';
import EmptyState from '../components/ui/EmptyState';
import { classNames, formatMs, formatRelative, statusCodeBadge } from '../utils/format';

const STAGE_LABELS = {
  'Route Lookup': 'Route Matched',
  'Service Load': 'Service Loaded',
  'API Key Auth': 'API Key Verified',
  'Rate Limit': 'Rate Limited',
  'Cache Lookup': 'Cache Check',
  'Load Balancer': 'Service Selected',
  'Circuit Breaker': 'Circuit Checked',
  'Path Rewrite': 'Path Rewritten',
  'Reverse Proxy': 'Forwarded',
  'Response': 'Response',
};

function getStageLabel(stage, actual) {
  if (stage.key === 'Cache Lookup') {
    return actual?.result === 'skipped' ? 'Cache Skipped' : 'Cache Miss';
  }
  if (stage.key === 'Rate Limit') {
    return 'Rate Limited';
  }
  if (stage.key === 'Circuit Breaker') {
    return actual?.ok ? 'Circuit Closed' : 'Circuit Open';
  }
  if (stage.key === 'Reverse Proxy') {
    return actual?.ok ? 'Forwarded' : 'Forward Failed';
  }
  return STAGE_LABELS[stage.key] || stage.key;
}

const STAGE_ORDER = ['Route Lookup', 'Service Load', 'API Key Auth', 'Rate Limit', 'Cache Lookup', 'Load Balancer', 'Circuit Breaker', 'Path Rewrite', 'Reverse Proxy', 'Response'];

export default function TimelinePage() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);

  const load = useCallback(async () => {
    try { setLogs(await logsApi.timeline(30)); } catch {} finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); const id = setInterval(() => { if (autoRefresh) load(); }, 10000); return () => clearInterval(id); }, [load, autoRefresh]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div><h2 className="text-xl font-semibold text-slate-100">Gateway Timeline</h2><p className="text-sm text-slate-500 mt-1">Live stream of recent requests with their full pipeline chain.</p></div>
        <div className="flex gap-2">
          <button onClick={() => setAutoRefresh((v) => !v)} className={classNames('btn-secondary', autoRefresh && 'text-brand-300')}>
            <RefreshCw size={14} className={autoRefresh ? 'animate-spin' : ''} /> {autoRefresh ? 'Auto (10s)' : 'Paused'}
          </button>
          <button onClick={load} className="btn-secondary"><RefreshCw size={14} /> Refresh</button>
        </div>
      </div>

      <Card noPadding>
        {loading ? <div className="p-6 space-y-3">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="skeleton h-24 w-full" />)}</div>
          : logs.length === 0 ? <EmptyState icon={GitBranch} title="No requests yet" description="Send a few requests through the gateway to populate the timeline." />
          : (
            <div className="divide-y divide-slate-800/60">
              {logs.map((log) => <TimelineEntry key={log.id} log={log} />)}
            </div>
          )}
      </Card>
    </div>
  );
}

function TimelineEntry({ log }) {
  // Parse pipeline_stages
  let stages = [];
  try {
    stages = typeof log.pipeline_stages === 'string' ? JSON.parse(log.pipeline_stages) : (log.pipeline_stages || []);
  } catch { stages = []; }

  // Sort stages by canonical order so they always render in pipeline order
  stages.sort((a, b) => STAGE_ORDER.indexOf(a.name) - STAGE_ORDER.indexOf(b.name));

  const totalMs = log.latency_ms || 0;
  const timestamp = new Date(log.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  return (
    <div className="px-5 py-4 hover:bg-slate-800/20 transition">
      {/* Header row */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono text-slate-500">{timestamp}</span>
          <span className={classNames('badge font-mono', log.method === 'GET' ? 'badge-success' : log.method === 'POST' ? 'badge-info' : log.method === 'DELETE' ? 'badge-danger' : 'badge-warning')}>{log.method}</span>
          <code className="text-xs font-mono text-slate-300">{log.public_path}</code>
        </div>
        <div className="flex items-center gap-2">
          <span className={classNames('badge', `badge-${statusCodeBadge(log.status_code)}`)}>{log.status_code}</span>
          <span className="text-xs text-slate-400 flex items-center gap-1"><Clock size={10} /> {formatMs(totalMs)}</span>
        </div>
      </div>

      {/* Pipeline chain */}
      <div className="flex flex-wrap items-center gap-1 pl-4">
        <span className="text-[10px] text-slate-500">Incoming</span>
        <ArrowDown size={10} className="text-slate-600 rotate-[-90deg]" />
        {stages.map((stage, i) => (
          <React.Fragment key={i}>
            <span className={classNames('text-[10px] px-1.5 py-0.5 rounded',
              stage.ok ? 'bg-slate-800/60 text-slate-300' : 'bg-rose-950/60 text-rose-300')}>
              {getStageLabel({ key: stage.name }, stage)}
              {stage.durationMs > 0 && <span className="text-slate-600 ml-1">{stage.durationMs}ms</span>}
            </span>
            <ArrowDown size={10} className="text-slate-600 rotate-[-90deg]" />
          </React.Fragment>
        ))}
        <span className={classNames('text-[10px] px-1.5 py-0.5 rounded font-medium',
          log.status_code >= 200 && log.status_code < 300 ? 'bg-brand-500/20 text-brand-300' : 'bg-rose-500/20 text-rose-300')}>
          {log.status_code} {log.status_code >= 200 && log.status_code < 300 ? 'OK' : ''}
        </span>
        <ArrowDown size={10} className="text-slate-600 rotate-[-90deg]" />
        <span className="text-[10px] text-slate-400">{formatMs(totalMs)}</span>
      </div>

      {/* Meta row */}
      <div className="mt-2 pl-4 text-[10px] text-slate-600 flex gap-4">
        <span>Request ID: <code className="font-mono">{log.request_id?.slice(0, 16)}…</code></span>
        {log.cache_hit && <span className="text-brand-400">Cache HIT</span>}
        {log.retry_count > 0 && <span className="text-amber-400">Retried ×{log.retry_count}</span>}
        <span className="ml-auto">{formatRelative(log.created_at)}</span>
      </div>
    </div>
  );
}
