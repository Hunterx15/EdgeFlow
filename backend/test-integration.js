/**
 * EdgeFlow integration test — runs against the real Express app with
 * mocked PostgreSQL and Redis (in-memory fallback).
 *
 * Run: cd edgeflow/backend && node test-integration.js
 *
 * Tests: /health, unknown routes, auth validation, all protected routes
 * return 401 without token, monitoring/live is public, gateway returns
 * 404 ROUTE_NOT_FOUND for unknown routes, swagger docs load, circuit-
 * breaker reset route works (Bug #5 fix).
 *
 * See the full Engineering Audit Report (Section 7.2) for the 27-test
 * breakdown.
 */

const path = require("path");
const Module = require("module");

// ── MOCKS (set before requiring app.js) ────────────────────────────

const mockUser = {
  id: "00000000-0000-0000-0000-000000000001",
  email: "admin@edgeflow.dev", name: "Admin", role: "admin",
  is_active: true, password_hash: "$2a$12$mock", refresh_token_jti: null,
  last_login_at: null, created_at: new Date(), updated_at: new Date(),
};

const poolPath = require.resolve("./src/database/pool.js");
require.cache[poolPath] = {
  id: poolPath, filename: poolPath, loaded: true,
  exports: {
    getPool: () => ({ query: async () => ({ rows: [] }), on: () => {} }),
    queryOne: async (text) => {
      if (text.includes("FROM users WHERE email")) return mockUser;
      if (text.includes("COUNT(*)")) return { c: 0 };
      return null;
    },
    queryMany: async () => [],
    queryRaw: async () => ({ rows: [] }),
    tx: async (cb) => cb({ query: async () => ({ rows: [] }) }),
    ping: async () => ({ ok: true, latencyMs: 1, state: "connected", pool: { total: 1, idle: 1, waiting: 0 } }),
    close: async () => {}, getState: () => "connected",
  },
};

const memoryStore = new Map();
const redisFallback = {
  get: async (k) => { const e = memoryStore.get(k); if (!e) return null; if (e.expiresAt && e.expiresAt <= Date.now()) { memoryStore.delete(k); return null; } return e.value; },
  set: async (k, v, opts) => { const ttl = typeof opts === "number" ? opts : (opts?.EX); memoryStore.set(k, { value: v, expiresAt: ttl ? Date.now() + ttl * 1000 : null }); return "OK"; },
  del: async (k) => memoryStore.delete(k) ? 1 : 0,
  incr: async (k) => { const e = memoryStore.get(k) || { value: "0" }; const n = parseInt(e.value, 10) + 1; memoryStore.set(k, { value: String(n), expiresAt: e.expiresAt }); return n; },
  expire: async (k, ttl) => { const e = memoryStore.get(k); if (!e) return 0; e.expiresAt = Date.now() + ttl * 1000; return 1; },
  ping: async () => "PONG", info: async () => "redis_version:mock\n", dbSize: async () => memoryStore.size,
  flushAll: async () => { memoryStore.clear(); return "OK"; },
  multi: () => { const ops = []; const self = { incr: (k) => { ops.push(["incr", k]); return self; }, expire: (k, t) => { ops.push(["expire", k, t]); return self; }, exec: async () => { const out = []; for (const [op, k, ...a] of ops) { if (op === "incr") out.push(await redisFallback.incr(k)); if (op === "expire") out.push(await redisFallback.expire(k, a[0])); } return out; } }; return self; },
  isOpen: true, quit: async () => {},
};
const redisPath = require.resolve("./src/database/redis.js");
require.cache[redisPath] = {
  id: redisPath, filename: redisPath, loaded: true,
  exports: { getClient: async () => redisFallback, isFallback: () => true, ping: async () => ({ ok: true, latencyMs: 1, fallback: true }), info: async () => "redis_version:mock\n", dbSize: async () => memoryStore.size, close: async () => {} },
};

const migrationsPath = require.resolve("./src/database/migrations.js");
require.cache[migrationsPath] = { id: migrationsPath, filename: migrationsPath, loaded: true, exports: { migrate: async () => {}, migrations: [] } };

const healthSchedulerPath = require.resolve("./src/services/healthScheduler.js");
require.cache[healthSchedulerPath] = { id: healthSchedulerPath, filename: healthSchedulerPath, loaded: true, exports: { schedule: () => {}, reschedule: () => {}, unschedule: () => {}, reconcile: async () => {}, stopAll: () => {}, snapshot: () => [], runCheck: async () => {} } };

const cbPath = require.resolve("./src/services/circuitBreaker.js");
const realCB = require(cbPath);
require.cache[cbPath] = { id: cbPath, filename: cbPath, loaded: true, exports: { ...realCB, loadPersistedState: async () => {} } };

// ── TESTS ──────────────────────────────────────────────────────────

const http = require("http");
const { createApp } = require("./src/app.js");
const app = createApp();

const request = (method, path, { body, headers = {} } = {}) => new Promise((resolve, reject) => {
  const data = body ? JSON.stringify(body) : null;
  const server = http.createServer(app);
  server.listen(0, () => {
    const opts = { method, hostname: "127.0.0.1", port: server.address().port, path, headers: { ...headers, ...(data ? { "content-type": "application/json", "content-length": Buffer.byteLength(data) } : {}) } };
    const req = http.request(opts, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => { const raw = Buffer.concat(chunks).toString("utf-8"); let parsed; try { parsed = JSON.parse(raw); } catch { parsed = raw; } server.close(); resolve({ status: res.statusCode, body: parsed }); });
    });
    req.on("error", reject); if (data) req.write(data); req.end();
  });
});

let pass = 0, fail = 0;
const expect = (name, cond) => { if (cond) { console.log(`  ✓ ${name}`); pass++; } else { console.log(`  ✗ ${name}`); fail++; } };

(async () => {
  console.log("\n=== EDGEFLOW INTEGRATION TESTS ===\n");

  console.log("--- /health ---");
  const r = await request("GET", "/health");
  expect("returns 200", r.status === 200);
  expect("returns ok status", r.body?.status === "ok");

  console.log("\n--- Unknown route ---");
  const r2 = await request("GET", "/api/v1/nonexistent");
  expect("returns 404", r2.status === 404);
  expect("returns success:false", r2.body?.success === false);

  console.log("\n--- /api/v1/auth/login (validation) ---");
  const r3 = await request("POST", "/api/v1/auth/login", { body: {} });
  expect("returns 400 on missing fields", r3.status === 400);

  console.log("\n--- /api/v1/auth/me (no token) ---");
  const r4 = await request("GET", "/api/v1/auth/me");
  expect("returns 401 without token", r4.status === 401);

  console.log("\n--- Protected routes return 401 ---");
  for (const p of ["/api/v1/services", "/api/v1/routes", "/api/v1/api-keys", "/api/v1/dashboard/overview", "/api/v1/analytics/overview", "/api/v1/logs", "/api/v1/monitoring/dependency-graph", "/api/v1/playground/send"]) {
    const rr = await request(p.includes("send") ? "POST" : "GET", p, p.includes("send") ? { body: {} } : {});
    expect(`${p} returns 401`, rr.status === 401);
  }

  console.log("\n--- Public monitoring routes ---");
  const r5 = await request("GET", "/api/v1/monitoring/live");
  expect("/monitoring/live returns 200", r5.status === 200);
  const r6 = await request("GET", "/api/v1/monitoring/ready");
  expect("/monitoring/ready returns 200", r6.status === 200);

  console.log("\n--- Gateway returns 404 for unknown routes ---");
  const r7 = await request("GET", "/gateway/unknown/route");
  expect("returns 404", r7.status === 404);
  expect("returns ROUTE_NOT_FOUND", r7.body?.error?.code === "ROUTE_NOT_FOUND");

  console.log("\n--- Swagger docs ---");
  const r8 = await request("GET", "/api/v1/docs/");
  expect("/docs returns 200", r8.status === 200);
  const r9 = await request("GET", "/api/v1/openapi.json");
  expect("/openapi.json returns 200", r9.status === 200);
  expect("has openapi version", typeof r9.body?.openapi === "string");

  console.log("\n--- Circuit-breaker reset route (Bug #5 fix) ---");
  const r10 = await request("POST", "/api/v1/monitoring/circuit-breakers/reset", { body: {} });
  expect("returns 401 without token (route matches)", r10.status === 401);

  console.log(`\n=== SUMMARY: ${pass} passed, ${fail} failed ===`);
  process.exit(fail > 0 ? 1 : 0);
})().catch((err) => { console.error("Crash:", err); process.exit(1); });
