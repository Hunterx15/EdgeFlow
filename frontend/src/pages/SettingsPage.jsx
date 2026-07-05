/**
 * EdgeFlow - Settings page (with interview Q&A cards)
 */

import React, { useState } from 'react';
import { Database, Zap, Shield, Network, Server, BookOpen, Settings as SettingsIcon } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import Card from '../components/ui/Card';

const INTERVIEW_QA = [
  { icon: Network, q: 'Why use an API Gateway at all?', a: 'It centralizes cross-cutting concerns (auth, rate limiting, caching, analytics, circuit breaking) so backend services can focus on business logic. Clients talk to one stable entry point; we can split / merge backend services without breaking them. EdgeFlow does this with a single Express app that proxies via http-proxy.' },
  { icon: Database, q: 'Why PostgreSQL over MongoDB?', a: 'Gateway config (services, routes, API keys) is highly relational and benefits from foreign keys, unique constraints and transactions. We use JSONB for the few semi-structured fields (upstream_targets, metadata, scopes). Postgres gives us PERCENTILE_CONT for P95 latency, window functions for analytics.' },
  { icon: Zap, q: 'Why Redis? What happens if it goes down?', a: 'Redis gives us O(1) response cache + sliding-window rate-limit counters + circuit-breaker state. If Redis is unreachable, EdgeFlow falls back to an in-memory Map so the gateway keeps serving traffic (logged loudly). In multi-instance deployments this loses accuracy, so we alert on fallback mode.' },
  { icon: Shield, q: 'How does JWT verification work? Why two tokens?', a: 'Access tokens are short-lived (15m) and stateless - we verify them with jsonwebtoken using HS256. Refresh tokens are long-lived (7d) and tracked by jti in Postgres. On each refresh we rotate the jti, so a stolen refresh token can be detected (jti mismatch -> revoke all sessions).' },
  { icon: Server, q: 'How does reverse proxy + load balancing work?', a: 'We use http-proxy to forward the request to the chosen upstream. Load balancing is smooth weighted round-robin (the same algorithm nginx uses): each target has a currentWeight; on each call we add weight to all, pick the max, subtract total. Unhealthy targets are filtered out by the health scheduler.' },
  { icon: Network, q: 'How does rate limiting work?', a: 'Sliding-window approximation: per (identity, route) we keep two counters - a per-minute bucket and a per-hour bucket - in Redis (INCR + EXPIRE). The minute window blocks bursts; the hour window enforces daily quota. If Redis is down we fail OPEN (let traffic through) and rely on the circuit breaker.' },
  { icon: Shield, q: 'What happens when a service is unavailable?', a: 'Three layers: (1) Health scheduler marks unhealthy upstreams every 30s; the LB skips them. (2) If a request still fails, we retry once against the next healthy target. (3) If failures exceed CB_FAILURE_THRESHOLD (5), the circuit opens and we fail fast with 503 until the open-state timeout (30s) elapses.' },
  { icon: Database, q: 'How does caching improve latency?', a: 'For GET routes with cache_ttl_sec > 0, we cache the response in Redis keyed by route+method+url. Subsequent identical requests get a HIT (~1ms) instead of a round-trip (~50-500ms). Non-GET requests automatically invalidate the cache for that path.' },
  { icon: Server, q: 'Why a simpler architecture (no repository pattern)?', a: 'EdgeFlow uses Routes -> Controllers -> Services -> Database directly. For a single-process gateway with limited entity types, the repository layer is over-engineering - it adds indirection without adding testability. Services use parameterized queries directly via the pg Pool. The simpler architecture is easier to reason about and explain in interviews.' },
];

export default function SettingsPage() {
  const { user } = useAuth();
  const [openIdx, setOpenIdx] = useState(0);

  return (
    <div className="space-y-6">
      <div><h2 className="text-xl font-semibold text-slate-100">Settings</h2><p className="text-sm text-slate-500 mt-1">Profile, system info, and engineering decisions worth discussing in an interview.</p></div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card title="Your Profile" subtitle="Signed-in admin user">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-12 h-12 rounded-full bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center text-slate-950 text-lg font-semibold">
              {user?.name?.charAt(0)}
            </div>
            <div>
              <div className="text-base font-semibold text-slate-100">{user?.name}</div>
              <div className="text-xs text-slate-500">{user?.email}</div>
              <div className="mt-1"><span className="badge-info">{user?.role}</span></div>
            </div>
          </div>
          <div className="space-y-1.5 text-xs">
            <div className="flex justify-between"><span className="text-slate-500">Last login</span><span className="text-slate-300">{user?.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString() : '—'}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">Created</span><span className="text-slate-300">{user?.createdAt ? new Date(user.createdAt).toLocaleDateString() : '—'}</span></div>
          </div>
        </Card>

        <Card title="System Information" subtitle="Build & runtime metadata">
          <div className="space-y-1.5 text-xs">
            <Row label="Version" value="1.0.0" />
            <Row label="Stack" value="Node · Express · PG · Redis" />
            <Row label="API prefix" value="/api/v1" />
            <Row label="Gateway prefix" value="/gateway" />
            <Row label="Swagger docs" value="/api/v1/docs" />
            <Row label="License" value="MIT" />
          </div>
        </Card>

        <Card title="Architecture" subtitle="Simpler layered architecture">
          <div className="space-y-2 text-xs">
            <Layer label="Routes" desc="Express routers" />
            <Layer label="Controllers" desc="HTTP request/response" />
            <Layer label="Services" desc="Business logic + DB access" />
            <Layer label="Database" desc="PostgreSQL + Redis" />
          </div>
        </Card>
      </div>

      <Card title="Interview Q&A" subtitle="Engineering decisions worth being able to discuss for 20-30 minutes" noPadding>
        <div className="divide-y divide-slate-800/60">
          {INTERVIEW_QA.map((qa, i) => (
            <div key={i}>
              <button onClick={() => setOpenIdx(openIdx === i ? null : i)} className="w-full flex items-center gap-3 px-5 py-4 hover:bg-slate-800/30 transition text-left">
                <div className="w-9 h-9 rounded-lg bg-slate-800 flex items-center justify-center text-brand-300 shrink-0"><qa.icon size={16} /></div>
                <div className="flex-1 min-w-0"><div className="text-sm font-medium text-slate-100">{qa.q}</div></div>
                <BookOpen size={14} className={`text-slate-500 transition-transform ${openIdx === i ? 'rotate-12' : ''}`} />
              </button>
              {openIdx === i && <div className="px-5 pb-4 pl-[68px] text-sm text-slate-400 leading-relaxed animate-fade-in">{qa.a}</div>}
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

function Row({ label, value }) {
  return <div className="flex items-center justify-between"><span className="text-slate-500">{label}</span><span className="text-slate-300 font-mono text-[11px]">{value}</span></div>;
}
function Layer({ label, desc }) {
  return <div className="flex items-center gap-2 p-2 rounded bg-slate-900/40"><SettingsIcon size={12} className="text-slate-500" /><span className="font-medium text-slate-200">{label}</span><span className="text-slate-500 ml-auto">{desc}</span></div>;
}
