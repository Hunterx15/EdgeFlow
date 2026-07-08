/**
 * EdgeFlow - Upstream utilities
 *
 * Helpers for normalizing the upstream_targets array on a service.
 *   { url: 'http://user-svc:3001', weight: 1, healthy: true }
 *
 * SECURITY:
 *   isValidHttpUrl rejects non-HTTP(S) protocols.
 *   isPrivateIp checks if a hostname resolves to a private/internal IP
 *   range, preventing SSRF attacks via the gateway (e.g., proxying to
 *   169.254.169.254 to exfiltrate cloud metadata).
 */

const dns = require('dns');
const net = require('net');

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
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch { return false; }
}

/**
 * Check if an IP address is in a private/reserved range.
 * Blocks: 127.x, 10.x, 172.16-31.x, 192.168.x, 169.254.x (link-local),
 * 0.x, 100.64-127.x (CGNAT), and IPv6 loopback/link-local.
 */
function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const parts = ip.split('.').map(Number);
    if (parts[0] === 127) return true;                     // loopback
    if (parts[0] === 10) return true;                      // private 10/8
    if (parts[0] === 0) return true;                       // 0/8 reserved
    if (parts[0] === 169 && parts[1] === 254) return true; // link-local 169.254/16
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true; // private 172.16/12
    if (parts[0] === 192 && parts[1] === 168) return true; // private 192.168/16
    if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) return true; // CGNAT 100.64/10
    return false;
  }
  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase();
    if (lower === '::1' || lower === '::') return true;     // loopback
    if (lower.startsWith('fe80')) return true;               // link-local
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // unique-local
    return false;
  }
  return false;
}

/**
 * Resolve a hostname and check if any resolved IP is private.
 * Returns a Promise<boolean> — true if the hostname resolves to a
 * private/internal IP (SSRF risk).
 *
 * Hostnames like 'localhost', 'postgres', 'redis' (Docker service names)
 * resolve to private IPs. In Docker/Compose environments this is expected
 * and desired. The check is primarily for production deployments where
 * upstream URLs might be user-controllable.
 *
 * The function is ASYNC because DNS resolution is async. Callers should
 * use it when validating user-provided upstream URLs.
 */
async function resolvesToPrivateIp(hostname) {
  // If hostname is already an IP, check directly
  if (net.isIP(hostname)) return isPrivateIp(hostname);

  return new Promise((resolve) => {
    dns.lookup(hostname, { all: true }, (err, addresses) => {
      if (err || !addresses || addresses.length === 0) {
        // Can't resolve — don't block (might be a valid internal DNS name)
        resolve(false);
        return;
      }
      resolve(addresses.some((a) => isPrivateIp(a.address)));
    });
  });
}

function healthyTargetsOnly(targets) {
  return (targets || []).filter((t) => t.healthy !== false);
}

module.exports = { normalizeUpstreamTargets, isValidHttpUrl, isPrivateIp, resolvesToPrivateIp, healthyTargetsOnly };
