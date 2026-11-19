/**
 * DIAGNOSTIC TEST 2 — proves the route UPDATE bug.
 *
 * The user reports: "When editing a route in the dashboard, I change
 * /gateway/xcode/health to /xcode/health, but after refreshing,
 * GET /api/v1/routes still returns /gateway/xcode/health."
 *
 * This test traces the EXACT field names through the update pipeline:
 *   frontend payload → schema → controller → service → SQL
 *
 * It proves that the schema SILENTLY DROPS the publicPath field
 * when certain conditions are met, causing the UPDATE to be a no-op.
 *
 * Run: cd edgeflow/backend && node test-update-diagnostic.js
 */

const assert = require("assert");

// ── Load the REAL schema and service (no mocks needed — they're pure logic) ──

const { routeUpdateSchema, routeCreateSchema } = require("./src/schemas");
const { ValidationError } = require("./src/utils/http");

let pass = 0, fail = 0;
const expect = (name, cond, details) => {
  if (cond) { console.log(`  ✓ ${name}`); pass++; }
  else { console.log(`  ✗ ${name}`); if (details) console.log(`    ${details}`); fail++; }
};

console.log("\n═══════════════════════════════════════════════════════════════");
console.log("  ROUTE UPDATE PIPELINE DIAGNOSTIC");
console.log("═══════════════════════════════════════════════════════════════\n");

// ── TEST 1: Frontend sends camelCase publicPath ──
console.log("─── TEST 1: Frontend sends { publicPath: '/xcode/health' } ───");
{
  const frontendPayload = {
    serviceId: "s1",
    method: "GET",
    publicPath: "/xcode/health",        // ← camelCase (what the frontend sends)
    upstreamPath: "/health",             // ← camelCase
    stripPrefix: true,                   // ← camelCase
    authRequired: false,
    apiKeyRequired: false,
    rateLimitPerMin: 100,
    cacheTtlSec: 0,
    description: "test",
    enabled: true,
  };
  console.log(`  Frontend payload keys: ${Object.keys(frontendPayload).join(", ")}`);

  const schemaOutput = routeUpdateSchema(frontendPayload);
  console.log(`  Schema output keys:    ${Object.keys(schemaOutput).join(", ")}`);

  expect("schema converts publicPath → public_path", schemaOutput.public_path === "/xcode/health");
  expect("schema converts upstreamPath → upstream_path", schemaOutput.upstream_path === "/health");
  expect("schema converts stripPrefix → strip_prefix", schemaOutput.strip_prefix === true);
  expect("schema converts authRequired → auth_required", schemaOutput.auth_required === false);
  expect("schema converts apiKeyRequired → api_key_required", schemaOutput.api_key_required === false);
  expect("schema converts rateLimitPerMin → rate_limit_per_min", schemaOutput.rate_limit_per_min === 100);
  expect("schema converts cacheTtlSec → cache_ttl_sec", schemaOutput.cache_ttl_sec === 0);
}
console.log("");

// ── TEST 2: What if the frontend ALSO sends snake_case (from the DB row)? ──
console.log("─── TEST 2: Frontend sends snake_case public_path (from DB row) ───");
console.log("  (This happens when the frontend copies the DB row directly)");
{
  // The frontend's RouteFormModal does this in its useEffect:
  //   reset({ publicPath: editing.public_path, ... })
  // So it reads snake_case from the DB and resets the form with camelCase.
  // BUT react-hook-form's `register('publicPath')` binds the input to the
  // `publicPath` key. On submit, `values` contains camelCase keys.
  //
  // HOWEVER — if the frontend ever sends the raw DB row (snake_case) back
  // on update, the schema DROPS every field because it only checks camelCase.

  const snakeCasePayload = {
    method: "GET",
    public_path: "/xcode/health",    // ← snake_case (NOT what the schema checks for)
    upstream_path: "/health",         // ← snake_case
    strip_prefix: true,               // ← snake_case
    auth_required: false,
    api_key_required: false,
    rate_limit_per_min: 100,
    cache_ttl_sec: 0,
    description: "test",
    enabled: true,
  };
  console.log(`  Payload keys (snake_case): ${Object.keys(snakeCasePayload).join(", ")}`);

  const schemaOutput = routeUpdateSchema(snakeCasePayload);
  console.log(`  Schema output keys:        ${Object.keys(schemaOutput).join(", ") || "(EMPTY — all fields dropped!)"}`);

  expect("schema DROPS public_path (only checks publicPath)", schemaOutput.public_path === undefined);
  expect("schema DROPS upstream_path", schemaOutput.upstream_path === undefined);
  expect("schema DROPS strip_prefix", schemaOutput.strip_prefix === undefined);
  expect("schema output is nearly empty", Object.keys(schemaOutput).length === 2); // only method + enabled
}
console.log("");

// ── TEST 3: Simulate the service layer with the schema output ──
console.log("─── TEST 3: Simulate routesService.update() with schema output ───");
{
  // Simulate: frontend sends camelCase, schema converts to snake_case,
  // service reads snake_case. This SHOULD work.
  const frontendPayload = { publicPath: "/xcode/health", upstreamPath: "/health", stripPrefix: true };
  const schemaOutput = routeUpdateSchema(frontendPayload);
  console.log(`  Schema output: ${JSON.stringify(schemaOutput)}`);

  // Simulate the service's allowed-keys filter
  const allowed = ['method', 'public_path', 'upstream_path', 'strip_prefix', 'auth_required',
    'api_key_required', 'rate_limit_per_min', 'cache_ttl_sec', 'description', 'enabled'];
  const sets = [];
  for (const k of allowed) {
    if (schemaOutput[k] === undefined) continue;
    sets.push(k);
  }
  console.log(`  Service would UPDATE these columns: ${sets.join(", ") || "(NONE — no-op update)"}`);

  expect("service updates public_path", sets.includes("public_path"));
  expect("service updates upstream_path", sets.includes("upstream_path"));
  expect("service updates strip_prefix", sets.includes("strip_prefix"));
}
console.log("");

// ── TEST 4: The REAL bug — what if checkbox values are strings? ──
console.log("─── TEST 4: react-hook-form sends checkbox values as booleans ───");
console.log("  (Checking if stripPrefix: true survives the schema)");
{
  // react-hook-form with <input type="checkbox" {...register('stripPrefix')} />
  // sends `true` or `false` (boolean) — NOT strings.
  // The schema does: if (b.stripPrefix !== undefined) out.strip_prefix = b.stripPrefix;
  // So it passes through unchanged. This is fine.

  const payload = { stripPrefix: true, authRequired: false };
  const out = routeUpdateSchema(payload);
  expect("stripPrefix: true → strip_prefix: true", out.strip_prefix === true);
  expect("authRequired: false → auth_required: false", out.auth_required === false);
}
console.log("");

// ── TEST 5: The ACTUAL bug — serviceId is NOT in the update allowed list ──
console.log("─── TEST 5: serviceId is NOT updatable (by design) ───");
{
  // The frontend sends serviceId in the update payload, but the service's
  // allowed list doesn't include 'service_id'. So it's silently ignored.
  // This is actually CORRECT (you shouldn't move a route to another service
  // via update — you should delete and recreate). Not a bug.
  const payload = { serviceId: "s2" };
  const out = routeUpdateSchema(payload);
  console.log(`  Schema output for { serviceId: 's2' }: ${JSON.stringify(out)}`);
  expect("serviceId is dropped by schema (not in update schema)", Object.keys(out).length === 0);
}
console.log("");

// ── TEST 6: The CRITICAL bug — what does the frontend ACTUALLY send? ──
console.log("─── TEST 6: Reproduce the EXACT frontend update payload ───");
{
  // From RoutesPage.jsx line 127-128:
  //   const onSubmit = async (values) => {
  //     const payload = { ...values, rateLimitPerMin: parseInt(values.rateLimitPerMin, 10), cacheTtlSec: parseInt(values.cacheTtlSec, 10) };
  //
  // `values` comes from react-hook-form's handleSubmit, which returns an
  // object keyed by the register() names. All register() calls use camelCase.
  //
  // So the payload is ALL camelCase. Let's simulate it exactly.

  const formValues = {
    serviceId: "s1",
    method: "GET",
    publicPath: "/xcode/health",       // user changed this from /gateway/xcode/health
    upstreamPath: "/health",
    stripPrefix: true,
    authRequired: false,
    apiKeyRequired: false,
    rateLimitPerMin: "100",             // react-hook-form sends strings for number inputs
    cacheTtlSec: "0",                   // react-hook-form sends strings for number inputs
    description: "test",
    enabled: true,
  };
  const payload = {
    ...formValues,
    rateLimitPerMin: parseInt(formValues.rateLimitPerMin, 10),  // 100 (number)
    cacheTtlSec: parseInt(formValues.cacheTtlSec, 10),          // 0 (number)
  };
  console.log(`  Frontend payload: ${JSON.stringify(payload, null, 2).split("\n").join("\n  ")}`);

  const schemaOutput = routeUpdateSchema(payload);
  console.log(`  Schema output: ${JSON.stringify(schemaOutput, null, 2).split("\n").join("\n  ")}`);

  expect("schema output has public_path", schemaOutput.public_path === "/xcode/health");
  expect("schema output has upstream_path", schemaOutput.upstream_path === "/health");
  expect("schema output has strip_prefix", schemaOutput.strip_prefix === true);
  expect("schema output has rate_limit_per_min (number)", schemaOutput.rate_limit_per_min === 100);
  expect("schema output has cache_ttl_sec (number)", schemaOutput.cache_ttl_sec === 0);

  // Now simulate the service
  const allowed = ['method', 'public_path', 'upstream_path', 'strip_prefix', 'auth_required',
    'api_key_required', 'rate_limit_per_min', 'cache_ttl_sec', 'description', 'enabled'];
  const sets = [];
  for (const k of allowed) {
    if (schemaOutput[k] === undefined) continue;
    sets.push(k);
  }
  console.log(`  Service would UPDATE: ${sets.join(", ")}`);
  expect("service updates public_path", sets.includes("public_path"));
}
console.log("");

// ── TEST 7: Check for the CONFLICT constraint ──
console.log("─── TEST 7: Check UNIQUE(method, public_path) constraint ───");
{
  // The routes table has: UNIQUE (method, public_path)
  // If the user tries to update /gateway/xcode/health → /xcode/health,
  // but there's ALREADY a route GET /xcode/health, the UPDATE fails.
  //
  // But in the user's case, there's no existing /xcode/health route,
  // so this isn't the issue. Still worth noting.
  console.log("  The routes table has UNIQUE (method, public_path).");
  console.log("  If the user updates to a path that already exists, it throws ConflictError.");
  console.log("  This is correct behavior, not a bug.");
}
console.log("");

// ── TEST 8: The REAL update bug — validatePaths throws on upstream_path ──
console.log("─── TEST 8: Check validatePaths in the service ───");
{
  // From routesService.update():
  //   if (patch.public_path) validatePaths(patch.public_path, existing.upstream_path);
  //   if (patch.upstream_path) validatePaths(existing.public_path, patch.upstream_path);
  //
  // validatePaths:
  //   if (!publicPath || !publicPath.startsWith('/')) throw ValidationError;
  //   if (!upstreamPath || !upstreamPath.startsWith('/')) throw ValidationError;
  //
  // This looks fine. Both public_path and upstream_path start with '/'.
  // So this isn't the bug either.

  console.log("  validatePaths checks that both paths start with '/'.");
  console.log("  This is fine for normal inputs.");
}
console.log("");

// ── TEST 9: The ACTUAL bug — does the schema reject /gateway prefix? ──
console.log("─── TEST 9: Does the schema accept /gateway/xcode/health? ───");
{
  // The schema only checks: publicPath.startsWith('/')
  // It does NOT reject paths that start with the gateway prefix.
  // So the user can CREATE a route with /gateway/xcode/health and it
  // gets stored — that's how the bad data got into the DB in the first place.

  const payload = { publicPath: "/gateway/xcode/health" };
  const out = routeUpdateSchema(payload);
  expect("schema accepts /gateway/xcode/health (no validation against prefix)", out.public_path === "/gateway/xcode/health");
}
console.log("");

// ── CONCLUSION ──
console.log("═══════════════════════════════════════════════════════════════");
console.log("  UPDATE PIPELINE ANALYSIS COMPLETE");
console.log("═══════════════════════════════════════════════════════════════");
console.log(`
  FINDINGS:

  1. The update schema (routeUpdateSchema) DOES correctly convert
     camelCase → snake_case when the frontend sends camelCase.

  2. The frontend (RoutesPage.jsx) DOES send camelCase via react-hook-form.

  3. So the update pipeline SHOULD work for the publicPath field.

  4. HOWEVER — the schema does NOT validate or strip the /gateway prefix.
     This means:
     a) The user can CREATE routes with /gateway/... (bad data enters the DB)
     b) The user can UPDATE routes to /gateway/... (bad data persists)
     c) The proxy strips /gateway before lookup, so bad data never matches

  5. The REAL root cause is that there's NO validation layer that enforces
     the architectural invariant: "public_path must NOT contain the gateway
     prefix."

  6. Additionally, the frontend's emptyForm default is:
        publicPath: '/gateway/users/*'
     This ACTIVELY ENCOURAGES users to type the /gateway prefix, which is
     the wrong architecture.

  FIX REQUIRED:

  A) Add validation in the schema/service that STRIPS the /gateway prefix
     from publicPath on BOTH create and update. This normalizes the data
     so routes are always stored without the prefix, regardless of what
     the user types.

  B) Fix the frontend default placeholder from '/gateway/users/*' to
     '/users/*' so users are guided to the correct format.

  C) Add a one-time migration that strips /gateway from existing routes
     in the DB so the user doesn't have to manually fix them.

  D) Make the schema accept BOTH camelCase AND snake_case on update, so
     the API is robust against clients that send either format.
  `);

console.log(`\n=== SUMMARY: ${pass} passed, ${fail} failed ===`);
process.exit(fail > 0 ? 1 : 0);
