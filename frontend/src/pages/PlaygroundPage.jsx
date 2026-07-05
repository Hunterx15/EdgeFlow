/**
 * EdgeFlow - API Playground page
 *
 * Built-in Postman-like API tester. Lets you send requests through the
 * EdgeFlow gateway and see the response, headers, timing, and pipeline
 * stages. The request goes via /api/v1/playground/send which forwards
 * it through the gateway so all middleware (rate limit, cache, circuit
 * breaker, LB) actually run.
 */

import React, { useState, useEffect } from 'react';
import { Play, Plus, Trash2, Loader2, Clock, CheckCircle2, XCircle, Copy } from 'lucide-react';
import { playgroundApi, routesApi } from '../api/endpoints';
import Card from '../components/ui/Card';
import { useToast } from '../utils/toast';
import { classNames, formatMs, formatBytes, statusCodeBadge, copyToClipboard } from '../utils/format';

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

export default function PlaygroundPage() {
  const [method, setMethod] = useState('GET');
  const [url, setUrl] = useState('/gateway/users/123');
  const [headers, setHeaders] = useState([{ key: 'Accept', value: 'application/json' }]);
  const [queryParams, setQueryParams] = useState([{ key: '', value: '' }]);
  const [body, setBody] = useState('');
  const [bodyType, setBodyType] = useState('json'); // 'json' | 'text'
  const [sending, setSending] = useState(false);
  const [response, setResponse] = useState(null);
  const [routes, setRoutes] = useState([]);
  const toast = useToast();

  useEffect(() => { routesApi.list({ limit: 100 }).then(setRoutes).catch(() => {}); }, []);

  const buildUrl = () => {
    const activeParams = queryParams.filter((p) => p.key);
    if (activeParams.length === 0) return url;
    const sep = url.includes('?') ? '&' : '?';
    return url + sep + activeParams.map((p) => `${encodeURIComponent(p.key)}=${encodeURIComponent(p.value)}`).join('&');
  };

  const send = async () => {
    if (!url) { toast.error('URL is required'); return; }
    setSending(true); setResponse(null);
    try {
      const headerObj = {};
      headers.forEach((h) => { if (h.key) headerObj[h.key] = h.value; });
      const payload = {
        method, url: buildUrl(), headers: headerObj,
        body: body && method !== 'GET' ? body : null,
      };
      const result = await playgroundApi.send(payload);
      setResponse(result);
      toast.success(`Response: ${result.status} in ${formatMs(result.latencyMs)}`);
    } catch (err) {
      setResponse({ error: err?.error?.message || 'Request failed', status: 0 });
    } finally { setSending(false); }
  };

  const loadRoute = (routeId) => {
    const r = routes.find((x) => x.id === routeId);
    if (!r) return;
    setMethod(r.method === '*' ? 'GET' : r.method);
    setUrl(r.public_path);
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold text-slate-100">API Playground</h2>
        <p className="text-sm text-slate-500 mt-1">Send test requests through the EdgeFlow gateway and inspect the response, timing, and pipeline stages.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Request panel */}
        <Card title="Request" noPadding>
          <div className="p-4 space-y-4">
            {/* URL row */}
            <div className="flex gap-2">
              <select value={method} onChange={(e) => setMethod(e.target.value)} className={classNames('input w-32 font-mono font-semibold',
                method === 'GET' ? 'text-brand-300' : method === 'POST' ? 'text-sky-300' : method === 'DELETE' ? 'text-rose-300' : 'text-amber-300')}>
                {METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
              <input value={url} onChange={(e) => setUrl(e.target.value)} className="input flex-1 font-mono text-sm" placeholder="/gateway/users/123" onKeyDown={(e) => e.key === 'Enter' && send()} />
              <button onClick={send} disabled={sending} className="btn-primary">
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

            {/* Tabs: Headers / Query / Body */}
            <Tabs defaultValue="headers">
              <TabsList>
                <TabsTrigger value="headers">Headers ({headers.filter((h) => h.key).length})</TabsTrigger>
                <TabsTrigger value="query">Query Params</TabsTrigger>
                <TabsTrigger value="body">Body</TabsTrigger>
              </TabsList>
              <TabsContent value="headers">
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
              </TabsContent>
              <TabsContent value="query">
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
              </TabsContent>
              <TabsContent value="body">
                <div className="space-y-2">
                  <select value={bodyType} onChange={(e) => setBodyType(e.target.value)} className="input w-40">
                    <option value="json">JSON</option>
                    <option value="text">Plain text</option>
                  </select>
                  <textarea value={body} onChange={(e) => setBody(e.target.value)} className="input font-mono text-xs" rows={8} placeholder={bodyType === 'json' ? '{\n  "key": "value"\n}' : 'raw body text'} disabled={method === 'GET'} />
                  {method === 'GET' && <p className="text-xs text-slate-500">Body is disabled for GET requests.</p>}
                </div>
              </TabsContent>
            </Tabs>
          </div>
        </Card>

        {/* Response panel */}
        <Card title="Response" noPadding
          action={response && response.status ? (
            <div className="flex items-center gap-2 px-4">
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
                {/* Headers */}
                <div>
                  <label className="label">Response Headers</label>
                  <div className="bg-slate-950 border border-slate-700 rounded-lg p-3 max-h-32 overflow-y-auto text-xs font-mono space-y-0.5">
                    {Object.entries(response.headers || {}).map(([k, v]) => (
                      <div key={k} className="flex gap-2"><span className="text-brand-300">{k}:</span><span className="text-slate-400 break-all">{String(v)}</span></div>
                    ))}
                  </div>
                </div>
                {/* Body */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="label mb-0">Response Body</label>
                    <button onClick={() => copyToClipboard(typeof response.body === 'string' ? response.body : JSON.stringify(response.body, null, 2))} className="btn-ghost text-xs"><Copy size={12} /> Copy</button>
                  </div>
                  <pre className="bg-slate-950 border border-slate-700 rounded-lg p-3 text-xs text-slate-300 overflow-x-auto max-h-96">
                    {typeof response.body === 'string' ? response.body : JSON.stringify(response.body, null, 2)}
                  </pre>
                </div>
              </div>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}

/* ---- Tiny inline Tabs (no extra dep) ---- */
function Tabs({ defaultValue, children }) {
  const [val, setVal] = React.useState(defaultValue);
  return React.createElement('div', null, React.Children.map(children, (c) => React.cloneElement(c, { _val: val, _setVal: setVal })));
}
function TabsList({ children, _val, _setVal }) {
  return <div className="flex gap-1 border-b border-slate-800 mb-3">{React.Children.map(children, (c) => React.cloneElement(c, { _val, _setVal }))}</div>;
}
function TabsTrigger({ value, children, _val, _setVal }) {
  const active = _val === value;
  return <button onClick={() => _setVal(value)} className={classNames('px-3 py-1.5 text-xs font-medium border-b-2 -mb-px transition-colors', active ? 'border-brand-500 text-brand-300' : 'border-transparent text-slate-400 hover:text-slate-200')}>{children}</button>;
}
function TabsContent({ value, children, _val }) {
  if (_val !== value) return null;
  return <div>{children}</div>;
}
