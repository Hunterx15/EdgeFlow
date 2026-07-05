/**
 * EdgeFlow - Upstream utilities
 *
 * Helpers for normalizing the upstream_targets array on a service.
 *   { url: 'http://user-svc:3001', weight: 1, healthy: true }
 */

function normalizeUpstreamTargets(input) {
  if (!input) throw new Error('upstreamTargets is required');
  const arr = Array.isArray(input) ? input : [input];
  if (arr.length === 0) throw new Error('At least one upstream target is required');
  const seen = new Set();
  return arr.map((t, idx) => {
    const url = typeof t === 'string' ? t : t?.url;
    if (!url || !isValidHttpUrl(url)) throw new Error(`Invalid upstream URL at index ${idx}: ${url}`);
    if (seen.has(url)) throw new Error(`Duplicate upstream URL: ${url}`);
    seen.add(url);
    const weight = Number.isFinite(t?.weight) ? Math.max(1, Math.floor(t.weight)) : 1;
    return { url, weight, healthy: typeof t?.healthy === 'boolean' ? t.healthy : true };
  });
}

function isValidHttpUrl(s) {
  try { const u = new URL(s); return u.protocol === 'http:' || u.protocol === 'https:'; } catch { return false; }
}

function healthyTargetsOnly(targets) {
  return (targets || []).filter((t) => t.healthy !== false);
}

module.exports = { normalizeUpstreamTargets, isValidHttpUrl, healthyTargetsOnly };
