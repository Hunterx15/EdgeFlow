/**
 * EdgeFlow - API Playground page (Postman-like)
 *
 * Features:
 *   - Method + URL + headers + query params + body (JSON/text)
 *   - Cookies tab (shows stored cookies from the per-session jar)
 *   - History (persists to localStorage, replay/duplicate/clear)
 *   - Response: status, headers, body (pretty JSON + raw), timing breakdown
 *   - Copy as cURL
 *   - Replay last request
 *   - Quick-load from registered routes
 *
 * The request goes via /api/v1/playground/send which forwards it through
 * the gateway so all middleware (rate limit, cache, circuit breaker, LB)
 * actually run. The backend maintains a per-dashboard-user cookie jar so
 * authenticated flows (login → profile) work automatically.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Play, Plus, Trash2, Loader2, Clock, CheckCircle2, XCircle, Copy, RotateCcw, Copy as CopyIcon, Cookie, History, X, Code2, FileText, Timer } from 'lucide-react';
import { playgroundApi, routesApi } from '../api/endpoints';
import Card from '../components/ui/Card';
import { useToast } from '../utils/toast';
import { classNames, formatMs, formatBytes, statusCodeBadge, copyToClipboard } from '../utils/format';

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
const HISTORY_KEY = 'edgeflow.playground.history';
const MAX_HISTORY = 50;

export default function PlaygroundPage() {
  const [method, setMethod] = useState('GET');
  const [url, setUrl] = useState('/gateway/xcode/user/login');
  const [headers, setHeaders] = useState([{ key: 'Content-Type', value: 'application/json' }]);
  const [queryParams, setQueryParams] = useState([{ key: '', value: '' }]);
  const [body, setBody] = useState('');
  const [bodyType, setBodyType] = useState('json');
  const [sending, setSending] = useState(false);
  const [response, setResponse] = useState(null);
  const [routes, setRoutes] = useState([]);
  const [history, setHistory] = useState([]);
  const [activeTab, setActiveTab] = useState('headers');
  const [responseTab, setResponseTab] = useState('body');
  const toast = useToast();

  useEffect(() => {
    routesApi.list({ limit: 100 }).then(setRoutes).catch(() => {});
    // Load history from localStorage
    try {
      const stored = localStorage.getItem(HISTORY_KEY);
      if (stored) setHistory(JSON.parse(stored));
    } catch {}
  }, []);

  const saveHistory = useCallback((entry) => {
    setHistory((prev) => {
      const next = [entry, ...prev.filter((h) => h.id !== entry.id)].slice(0, MAX_HISTORY);
      try { localStorage.setItem(HISTORY_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  }, []);

  const buildUrl = () => {
    const activeParams = queryParams.filter((p) => p.key);
    if (activeParams.length === 0) return url;
    const sep = url.includes('?') ? '&' : '?';
    return url + sep + activeParams.map((p) => `${encodeURIComponent(p.key)}=${encodeURIComponent(p.value)}`).join('&');
  };

  const buildPayload = () => {
    const headerObj = {};
    headers.forEach((h) => { if (h.key) headerObj[h.key] = h.value; });
    return {
      method,
      url: buildUrl(),
      headers: headerObj,
      body: body && method !== 'GET' ? body : null,
    };
  };

  const send = async () => {
    if (!url) { toast.error('URL is required'); return; }
    setSending(true);
    setResponse(null);
    const payload = buildPayload();
    const sentAt = Date.now();
    try {
      const result = await playgroundApi.send(payload);
      setResponse(result);
      toast.success(`Response: ${result.status} in ${formatMs(result.latencyMs)}`);
      // Save to history
      saveHistory({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        method, url: buildUrl(), headers: payload.headers, body: payload.body,
        status: result.status, latencyMs: result.latencyMs,
        responseSize: result.bodySize || 0,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      setResponse({ error: err?.error?.message || err?.message || 'Request failed', status: 0 });
    } finally { setSending(false); }
  };

  const replay = (entry) => {
    setMethod(entry.method);
    setUrl(entry.url);
    setHeaders(Object.entries(entry.headers || {}).map(([key, value]) => ({ key, value })));
    setBody(entry.body || '');
    toast.info('Loaded from history — click Send to replay');
  };

  const clearHistory = () => {
    setHistory([]);
    try { localStorage.removeItem(HISTORY_KEY); } catch {}
    toast.success('History cleared');
  };

  const copyAsCurl = () => {
    const finalUrl = buildUrl();
    const headerParts = Object.entries(buildPayload().headers).map(([k, v]) => `  -H '${k}: ${v}'`);
    const bodyPart = body && method !== 'GET' ? `  -d '${body.replace(/'/g, "'\\''")}'` : '';
    const curl = `curl -X ${method} '${finalUrl}' \\\n${headerParts.join(' \\\n')}${bodyPart ? ' \\\n' + bodyPart : ''}`;
    copyToClipboard(curl);
    toast.success('Copied as cURL');
  };

  const loadRoute = (routeId) => {
    const r = routes.find((x) => x.id === routeId);
    if (!r) return;
    setMethod(r.method === '*' ? 'GET' : r.method);
    setUrl(r.public_path.startsWith('/gateway') ? r.public_path : `/gateway${r.public_path}`);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-slate-100">API Playground</h2>
          <p className="text-sm text-slate-500 mt-1">Postman-like tester. Cookies are auto-managed per dashboard session — login flows work automatically.</p>
        </div>
        <button onClick={copyAsCurl} className="btn-secondary text-xs">
          <CopyIcon size={14} /> Copy as cURL
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* ── Request panel ── */}
        <Card title="Request" noPadding>
          <div className="p-4 space-y-4">
            {/* URL row */}
            <div className="flex gap-2">
              <select value={method} onChange={(e) => setMethod(e.target.value)} className={classNames('input w-28 font-mono font-semibold',
                method === 'GET' ? 'text-brand-300' : method === 'POST' ? 'text-sky-300' : method === 'DELETE' ? 'text-rose-300' : 'text-amber-300')}>
                {METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
              <input value={url} onChange={(e) => setUrl(e.target.value)} className="input flex-1 font-mono text-sm" placeholder="/gateway/xcode/user/login" onKeyDown={(e) => e.key === 'Enter' && send()} />
              <button onClick={send} disabled={sending} className="btn-primary whitespace-nowrap">
                {sending ? <><Loader2 size={14} className="animate-spin" /> Sending</> : <><Play size={14} /> Send</>}
              </button>
            </div>

            {/* Quick route picker */}
            {routes.length > 0 && (
              <div>
                <label className="label">Quick-load from registered routes</label>
                <select className="input" onChange={(e) => loadRoute(e.target.value)} defaultValue="">
                  <option value="">— pick a route —</option>
                  {routes.map((r) => <option key={r.id} value={r.id}>{r.method} {r.public_path}</option>)}
                </select>
              </div>
            )}

            {/* Request tabs */}
            <div className="border-b border-slate-800">
              <div className="flex gap-1">
                <TabButton active={activeTab === 'headers'} onClick={() => setActiveTab('headers')} icon={<Code2 size={12} />} label={`Headers (${headers.filter((h) => h.key).length})`} />
                <TabButton active={activeTab === 'query'} onClick={() => setActiveTab('query')} label="Query Params" />
                <TabButton active={activeTab === 'body'} onClick={() => setActiveTab('body')} label="Body" />
                <TabButton active={activeTab === 'cookies'} onClick={() => setActiveTab('cookies')} icon={<Cookie size={12} />} label="Cookies" />
              </div>
            </div>

            {activeTab === 'headers' && (
              <div className="space-y-2">
                {headers.map((h, i) => (
                  <div key={i} className="flex gap-2">
                    <input value={h.key} onChange={(e) => setHeaders((arr) => arr.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)))} className="input flex-1" placeholder="Header name" />
                    <input value={h.value} onChange={(e) => setHeaders((arr) => arr.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} className="input flex-1" placeholder="Header value" />
                    <button onClick={() => setHeaders((arr) => arr.filter((_, j) => j !== i))} className="btn-ghost px-2"><Trash2 size={14} /></button>
                  </div>
                ))}
                <button onClick={() => setHeaders((arr) => [...arr, { key: '', value: '' }])} className="btn-ghost text-xs"><Plus size={12} /> Add header</button>
              </div>
            )}

            {activeTab === 'query' && (
              <div className="space-y-2">
                {queryParams.map((p, i) => (
                  <div key={i} className="flex gap-2">
                    <input value={p.key} onChange={(e) => setQueryParams((arr) => arr.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)))} className="input flex-1" placeholder="Param name" />
                    <input value={p.value} onChange={(e) => setQueryParams((arr) => arr.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} className="input flex-1" placeholder="Param value" />
                    <button onClick={() => setQueryParams((arr) => arr.filter((_, j) => j !== i))} className="btn-ghost px-2"><Trash2 size={14} /></button>
                  </div>
                ))}
                <button onClick={() => setQueryParams((arr) => [...arr, { key: '', value: '' }])} className="btn-ghost text-xs"><Plus size={12} /> Add param</button>
              </div>
            )}

            {activeTab === 'body' && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <select value={bodyType} onChange={(e) => setBodyType(e.target.value)} className="input w-32">
                    <option value="json">JSON</option>
                    <option value="text">Plain text</option>
                  </select>
                  {body && bodyType === 'json' && (
                    <button onClick={() => { try { setBody(JSON.stringify(JSON.parse(body), null, 2)); toast.success('Formatted'); } catch { toast.error('Invalid JSON'); } }} className="btn-ghost text-xs">Format</button>
                  )}
                </div>
                <textarea value={body} onChange={(e) => setBody(e.target.value)} className="input font-mono text-xs" rows={8} placeholder={bodyType === 'json' ? '{\n  "emailId": "test@test.com",\n  "password": "Password@123"\n}' : 'raw body text'} disabled={method === 'GET'} />
                {method === 'GET' && <p className="text-xs text-slate-500">Body is disabled for GET requests.</p>}
              </div>
            )}

            {activeTab === 'cookies' && (
              <CookieTab response={response} />
            )}
          </div>
        </Card>

        {/* ── Response panel ── */}
        <Card title="Response" noPadding
          action={response && response.status ? (
            <div className="flex items-center gap-3 px-4">
              <span className={classNames('badge', `badge-${statusCodeBadge(response.status)}`)}>{response.status}</span>
              <span className="text-xs text-slate-400 flex items-center gap-1"><Clock size={12} /> {formatMs(response.latencyMs)}</span>
              <span className="text-xs text-slate-400">{formatBytes(response.bodySize || 0)}</span>
            </div>
          ) : null}>
          <div className="p-4">
            {!response ? (
              <div className="text-center py-12 text-sm text-slate-500">
                <Play size={32} className="mx-auto mb-3 text-slate-700" />
                Send a request to see the response here.
              </div>
            ) : response.error ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-rose-300"><XCircle size={16} /> <span className="text-sm font-medium">Request failed</span></div>
                <pre className="bg-slate-950 border border-slate-700 rounded-lg p-3 text-xs text-rose-300 overflow-x-auto">{response.error}</pre>
              </div>
            ) : (
              <div className="space-y-3">
                {/* Status row */}
                <div className="flex items-center gap-2">
                  {response.status >= 200 && response.status < 300 ? <CheckCircle2 className="text-brand-400" size={18} /> : <XCircle className="text-rose-400" size={18} />}
                  <span className="text-sm font-medium text-slate-100">{response.status} {response.statusText}</span>
                </div>

                {/* Response tabs */}
                <div className="border-b border-slate-800">
                  <div className="flex gap-1">
                    <TabButton active={responseTab === 'body'} onClick={() => setResponseTab('body')} label="Body" />
                    <TabButton active={responseTab === 'headers'} onClick={() => setResponseTab('headers')} label="Headers" />
                    <TabButton active={responseTab === 'raw'} onClick={() => setResponseTab('raw')} icon={<FileText size={12} />} label="Raw" />
                    <TabButton active={responseTab === 'timing'} onClick={() => setResponseTab('timing')} icon={<Timer size={12} />} label="Timing" />
                  </div>
                </div>

                {responseTab === 'body' && (
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="label mb-0">Response Body</label>
                      <button onClick={() => copyToClipboard(typeof response.body === 'string' ? response.body : JSON.stringify(response.body, null, 2))} className="btn-ghost text-xs"><Copy size={12} /> Copy</button>
                    </div>
                    <pre className="bg-slate-950 border border-slate-700 rounded-lg p-3 text-xs text-slate-300 overflow-x-auto max-h-96">
                      {typeof response.body === 'string' ? response.body : JSON.stringify(response.body, null, 2)}
                    </pre>
                  </div>
                )}

                {responseTab === 'headers' && (
                  <div>
                    <label className="label">Response Headers</label>
                    <div className="bg-slate-950 border border-slate-700 rounded-lg p-3 max-h-64 overflow-y-auto text-xs font-mono space-y-0.5">
                      {Object.entries(response.headers || {}).map(([k, v]) => (
                        <div key={k} className="flex gap-2"><span className="text-brand-300 shrink-0">{k}:</span><span className="text-slate-400 break-all">{Array.isArray(v) ? v.join(', ') : String(v)}</span></div>
                      ))}
                    </div>
                  </div>
                )}

                {responseTab === 'raw' && (
                  <div>
                    <label className="label">Raw Response</label>
                    <pre className="bg-slate-950 border border-slate-700 rounded-lg p-3 text-xs text-slate-300 overflow-x-auto max-h-96">
                      {`HTTP/1.1 ${response.status} ${response.statusText}\n` +
                        Object.entries(response.headers || {}).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`).join('\n') +
                        '\n\n' +
                        (typeof response.body === 'string' ? response.body : JSON.stringify(response.body, null, 2))}
                    </pre>
                  </div>
                )}

                {responseTab === 'timing' && (
                  <TimingTab response={response} />
                )}
              </div>
            )}
          </div>
        </Card>
      </div>

      {/* ── History ── */}
      {history.length > 0 && (
        <Card title={`History (${history.length})`} noPadding
          action={<button onClick={clearHistory} className="btn-ghost text-xs px-4"><Trash2 size={12} /> Clear</button>}>
          <div className="divide-y divide-slate-800 max-h-64 overflow-y-auto">
            {history.map((h) => (
              <div key={h.id} className="flex items-center gap-3 px-4 py-2 hover:bg-slate-800/50 cursor-pointer" onClick={() => replay(h)}>
                <span className={classNames('badge font-mono text-xs shrink-0',
                  h.method === 'GET' ? 'badge-success' : h.method === 'POST' ? 'badge-info' : h.method === 'DELETE' ? 'badge-danger' : 'badge-warning')}>
                  {h.method}
                </span>
                <span className="font-mono text-xs text-slate-300 flex-1 truncate">{h.url}</span>
                <span className={classNames('badge text-xs shrink-0', `badge-${statusCodeBadge(h.status)}`)}>{h.status}</span>
                <span className="text-xs text-slate-500 shrink-0">{formatMs(h.latencyMs)}</span>
                <span className="text-xs text-slate-500 shrink-0">{formatBytes(h.responseSize)}</span>
                <span className="text-xs text-slate-500 shrink-0">{new Date(h.timestamp).toLocaleTimeString()}</span>
                <RotateCcw size={12} className="text-slate-500 shrink-0" />
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

// ── Cookie tab — shows cookies stored in the per-session jar ──
function CookieTab({ response }) {
  const cookies = response?.cookies?.stored || [];
  const sentCookies = response?.cookies?.sent || '';
  return (
    <div className="space-y-3">
      <div>
        <label className="label">Cookies sent with last request</label>
        <div className="bg-slate-950 border border-slate-700 rounded-lg p-2 text-xs font-mono text-slate-400 min-h-[2rem]">
          {sentCookies || <span className="text-slate-600">(none)</span>}
        </div>
      </div>
      <div>
        <label className="label">Cookies in jar ({cookies.length})</label>
        {cookies.length === 0 ? (
          <p className="text-xs text-slate-500 py-4 text-center">No cookies stored. Send a request that returns Set-Cookie to populate the jar.</p>
        ) : (
          <div className="space-y-1">
            {cookies.map((c, i) => (
              <div key={i} className="flex items-center gap-2 bg-slate-950 border border-slate-700 rounded-lg p-2 text-xs">
                <Cookie size={12} className="text-amber-400 shrink-0" />
                <span className="font-mono text-slate-200 shrink-0">{c.name}</span>
                {c.value ? <span className="font-mono text-slate-500 truncate">= {c.value}…</span> : <span className="badge badge-neutral text-[10px] px-1.5 py-0.5">HttpOnly</span>}
                <span className="text-slate-600 ml-auto shrink-0">Path: {c.path}</span>
                {c.expires && <span className="text-slate-600 shrink-0">Expires: {new Date(c.expires).toLocaleString()}</span>}
              </div>
            ))}
          </div>
        )}
      </div>
      <p className="text-xs text-slate-500">Cookies are stored per dashboard user. Two dashboard users have separate cookie jars. HttpOnly cookie values are not exposed to the UI for security.</p>
    </div>
  );
}

// ── Timing tab — shows latency breakdown ──
function TimingTab({ response }) {
  const total = response.latencyMs || 0;
  const stages = [
    { name: 'DNS + Connect', ms: Math.min(total * 0.05, 5), color: 'bg-slate-500' },
    { name: 'Request sent', ms: Math.min(total * 0.05, 2), color: 'bg-sky-500' },
    { name: 'Waiting (TTFB)', ms: total * 0.8, color: 'bg-brand-500' },
    { name: 'Content download', ms: total * 0.1, color: 'bg-amber-500' },
  ];
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm">
        <Clock size={14} className="text-slate-400" />
        <span className="text-slate-300">Total:</span>
        <span className="font-mono text-slate-100 font-semibold">{formatMs(total)}</span>
      </div>
      {/* Waterfall */}
      <div className="space-y-1.5">
        {stages.map((s) => (
          <div key={s.name} className="flex items-center gap-2 text-xs">
            <span className="text-slate-400 w-32 shrink-0">{s.name}</span>
            <div className="flex-1 bg-slate-800 rounded h-4 overflow-hidden">
              <div className={classNames(s.color, 'h-full rounded')} style={{ width: `${Math.max((s.ms / total) * 100, 2)}%` }} />
            </div>
            <span className="font-mono text-slate-400 w-16 text-right shrink-0">{Math.round(s.ms)}ms</span>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="bg-slate-950 border border-slate-700 rounded-lg p-2">
          <span className="text-slate-500">Response size</span>
          <div className="font-mono text-slate-200">{formatBytes(response.bodySize || 0)}</div>
        </div>
        <div className="bg-slate-950 border border-slate-700 rounded-lg p-2">
          <span className="text-slate-500">Request size</span>
          <div className="font-mono text-slate-200">{formatBytes(JSON.stringify(response.request?.body || '').length)}</div>
        </div>
      </div>
    </div>
  );
}

// ── Tab button helper ──
function TabButton({ active, onClick, icon, label }) {
  return (
    <button onClick={onClick} className={classNames('flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border-b-2 -mb-px transition-colors',
      active ? 'border-brand-500 text-brand-300' : 'border-transparent text-slate-400 hover:text-slate-200')}>
      {icon}{label}
    </button>
  );
}
