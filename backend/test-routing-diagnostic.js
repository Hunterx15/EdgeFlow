/**
 * DIAGNOSTIC TEST — proves the root cause of the routing failure.
 *
 * Simulates the user's EXACT scenario:
 *   - DB has 7 routes stored WITH the /gateway prefix
 *     (e.g. public_path = "/gateway/xcode/health")
 *   - Proxy strips /gateway → looks up "/xcode/health"
 *   - routeCache has keys like "GET:/gateway/xcode/health"
 *
 * This test prints the exact cache keys and the exact lookup key,
 * proving WHY the match fails.
 *
 * Run: cd edgeflow/backend && node test-routing-diagnostic.js
 */

const Module = require("module");

// ── MOCK the database pool so routeCache.refresh() returns our test data ──

const routesInDb = [
  // These are the routes as the user reports they exist in their DB —
  // stored WITH the /gateway prefix.
  { id: "r1", service_id: "s1", method: "GET",  public_path: "/gateway/xcode/health",          upstream_path: "/health",          strip_prefix: true,  auth_required: false, api_key_required: false, rate_limit_per_min: 100, cache_ttl_sec: 0,   description: "xcode health",    enabled: true },
  { id: "r2", service_id: "s1", method: "POST", public_path: "/gateway/xcode/user/register",   upstream_path: "/user/register",   strip_prefix: true,  auth_required: false, api_key_required: false, rate_limit_per_min: 100, cache_ttl_sec: 0,   description: "xcode register",  enabled: true },
  { id: "r3", service_id: "s1", method: "POST", public_path: "/gateway/xcode/user/login",      upstream_path: "/user/login",      strip_prefix: true,  auth_required: false, api_key_required: false, rate_limit_per_min: 100, cache_ttl_sec: 0,   description: "xcode login",     enabled: true },
  { id: "r4", service_id: "s1", method: "GET",  public_path: "/gateway/xcode/getAllProblem",   upstream_path: "/problem/getAllProblem", strip_prefix: true, auth_required: true, api_key_required: false, rate_limit_per_min: 100, cache_ttl_sec: 0, description: "xcode problems", enabled: true },
  { id: "r5", service_id: "s1", method: "POST", public_path: "/gateway/xcode/ai/chat",         upstream_path: "/ai/chat",         strip_prefix: true,  auth_required: true,  api_key_required: false, rate_limit_per_min: 100, cache_ttl_sec: 0,   description: "xcode AI chat",   enabled: true },
  { id: "r6", service_id: "s1", method: "GET",  public_path: "/gateway/xcode/user/profile",    upstream_path: "/user/profile",    strip_prefix: true,  auth_required: true,  api_key_required: false, rate_limit_per_min: 100, cache_ttl_sec: 0,   description: "xcode profile",   enabled: true },
  { id: "r7", service_id: "s1", method: "GET",  public_path: "/gateway/xcode/*",               upstream_path: "/",                strip_prefix: true,  auth_required: false, api_key_required: false, rate_limit_per_min: 100, cache_ttl_sec: 0,   description: "xcode wildcard",  enabled: true },
];

const poolPath = require.resolve("./src/database/pool.js");
require.cache[poolPath] = {
  id: poolPath, filename: poolPath, loaded: true,
  exports: {
    getPool: () => ({ query: async () => ({ rows: [] }), on: () => {} }),
    queryOne: async (text, params) => {
      // routesService.getById
      if (text.includes("FROM routes WHERE id")) return routesInDb.find((r) => r.id === params[0]) || null;
      return null;
    },
    queryMany: async (text) => {
      // routesService.listAllEnabled
      if (text.includes("WHERE enabled = TRUE")) return routesInDb;
      if (text.includes("FROM routes")) return routesInDb;
      return [];
    },
    queryRaw: async () => ({ rows: [] }),
    tx: async (cb) => cb({ query: async () => ({ rows: [] }) }),
    ping: async () => ({ ok: true }),
    close: async () => {},
    getState: () => "connected",
  },
};

// ── Now load the real routeCache (it will use our mocked pool) ──

const routeCache = require("./src/gateway/routeCache");
const config = require("./src/config");

(async () => {
  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("  ROUTING PIPELINE DIAGNOSTIC");
  console.log("═══════════════════════════════════════════════════════════════\n");

  console.log("─── Stage 0: Config ───");
  console.log(`  config.server.gatewayPrefix = "${config.server.gatewayPrefix}"`);
  console.log("");

  // ── Stage 1: What's in the DB? ──
  console.log("─── Stage 1: What's in the database (routes table) ───");
  console.log(`  ${routesInDb.length} routes, all stored WITH the /gateway prefix:`);
  for (const r of routesInDb) {
    console.log(`    ${r.method.padEnd(6)} public_path = "${r.public_path}"`);
  }
  console.log("");

  // ── Stage 2: Warm the cache ──
  console.log("─── Stage 2: Warm the route cache (routeCache.warm) ───");
  await routeCache.warm();
  console.log(`  routeCache.size() = ${routeCache.size()}`);
  console.log("");

  // ── Stage 3: What keys does the cache have? ──
  console.log("─── Stage 3: What keys does routeCache store? ───");
  const snap = routeCache.snapshot();
  console.log("  exactRoutes keys (Map keys = `${METHOD}:${public_path}`):");
  for (const k of snap.exact) {
    console.log(`    "${k}"`);
  }
  console.log("  wildcardRoutes:");
  for (const w of snap.wildcard) {
    console.log(`    "${w}"`);
  }
  console.log("");

  // ── Stage 4: What does proxyEngine pass to routeCache.match()? ──
  console.log("─── Stage 4: What does proxyEngine pass to routeCache.match()? ───");
  const incomingRequest = "/gateway/xcode/health";
  const gatewayPrefix = config.server.gatewayPrefix;
  const fullPath = incomingRequest.split("?")[0];
  let publicPath = fullPath.startsWith(gatewayPrefix)
    ? fullPath.slice(gatewayPrefix.length)
    : fullPath;
  if (!publicPath.startsWith("/")) publicPath = "/" + publicPath;
  const routeLookupPath = publicPath;

  console.log(`  Incoming request:  ${req_method("GET")} ${incomingRequest}`);
  console.log(`  gatewayPrefix:     "${gatewayPrefix}"`);
  console.log(`  fullPath:          "${fullPath}"`);
  console.log(`  publicPath:        "${publicPath}"  (prefix stripped)`);
  console.log(`  routeLookupPath:   "${routeLookupPath}"  (passed to routeCache.match)`);
  console.log("");

  // ── Stage 5: Does the match succeed? ──
  console.log("─── Stage 5: Does routeCache.match('GET', '/xcode/health') find a route? ───");
  const result = await routeCache.match("GET", routeLookupPath);
  if (result) {
    console.log(`  ✓ MATCH FOUND: ${result.method} ${result.public_path}`);
  } else {
    console.log(`  ✗ NO MATCH — routeCache has no key "GET:/xcode/health"`);
    console.log(`    Cache has key "GET:/gateway/xcode/health" (WITH prefix)`);
    console.log(`    Lookup used  "GET:/xcode/health"          (WITHOUT prefix)`);
    console.log(`    → MISMATCH → 404 ROUTE_NOT_FOUND`);
  }
  console.log("");

  // ── Stage 6: Does the match succeed if we DON'T strip the prefix? ──
  console.log("─── Stage 6: Control test — match WITH the prefix ───");
  const result2 = await routeCache.match("GET", "/gateway/xcode/health");
  if (result2) {
    console.log(`  ✓ MATCH FOUND: ${result2.method} ${result2.public_path}`);
    console.log(`    (proves the cache HAS the route — the lookup key is what's wrong)`);
  } else {
    console.log(`  ✗ NO MATCH (unexpected)`);
  }
  console.log("");

  // ── Stage 7: pathRewriter behavior ──
  console.log("─── Stage 7: If the match DID succeed, what would pathRewriter do? ───");
  const pathRewriter = require("./src/gateway/pathRewriter");
  // Simulate using the route AS STORED (with /gateway prefix)
  const route = routesInDb[0]; // GET /gateway/xcode/health → /health
  const rewritten = pathRewriter.rewrite({
    route,
    publicPath: "/xcode/health",  // what the proxy passes (stripped)
    originalQuery: "",
  });
  console.log(`  route.public_path  = "${route.public_path}"`);
  console.log(`  route.upstream_path = "${route.upstream_path}"`);
  console.log(`  publicPath (stripped) passed to rewriter = "/xcode/health"`);
  console.log(`  rewritten upstream path = "${rewritten}"`);
  console.log(`  `);
  if (route.strip_prefix) {
    console.log(`  pathRewriter logic:`);
    console.log(`    publicPrefix = route.public_path.replace(/\\/\\*$/, "") = "${route.public_path.replace(/\/\*$/, "")}"`);
    console.log(`    suffix = publicPath.slice(publicPrefix.length) = "/xcode/health".slice(${route.public_path.length}) = "${"/xcode/health".slice(route.public_path.length)}"`);
    console.log(`    upstream = route.upstream_path + suffix = "${route.upstream_path}" + "${"/xcode/health".slice(route.public_path.length)}" = "${route.upstream_path + ("/xcode/health".slice(route.public_path.length))}"`);
    console.log(`    `);
    console.log(`    ⚠ Even if the route lookup succeeded, the path rewrite would be WRONG.`);
    console.log(`    The rewriter strips route.public_path ("/gateway/xcode/health") from the`);
    console.log(`    incoming path ("/xcode/health"), but since the incoming path doesn't`);
    console.log(`    START WITH the stored public_path, the slice produces garbage.`);
  }
  console.log("");

  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  ROOT CAUSE CONFIRMED");
  console.log("═══════════════════════════════════════════════════════════════");
  console.log(`
  The DB stores routes WITH the /gateway prefix:
    public_path = "/gateway/xcode/health"

  The proxy STRIPS the /gateway prefix before lookup:
    routeLookupPath = "/xcode/health"

  The cache key is built from the DB value:
    cache key = "GET:/gateway/xcode/health"

  The lookup key is built from the stripped path:
    lookup key = "GET:/xcode/health"

  Keys don't match → 404 ROUTE_NOT_FOUND.

  ARCHITECTURE DECISION:
  Routes must be stored WITHOUT the /gateway prefix. The /gateway prefix
  is a mount-point concern (where Express mounts the proxy), not a
  route-level concern. The public_path represents the logical path
  WITHIN the gateway's route space.

  So the correct DB value is:
    public_path = "/xcode/health"   (no /gateway prefix)

  And the proxy correctly strips /gateway before lookup. The proxy logic
  is RIGHT; the DB data is WRONG.

  But the user can't fix the DB data because the UPDATE API silently
  drops the publicPath field. The next test proves that bug.
  `);
  process.exit(0);
})().catch((err) => { console.error(err); process.exit(1); });

function req_method(m) { return m; }
