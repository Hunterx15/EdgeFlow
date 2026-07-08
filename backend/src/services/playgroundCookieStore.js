/**
 * EdgeFlow - Playground cookie store
 *
 * Per-session in-memory cookie jar for the API Playground.
 *
 * Why this exists:
 *   The Playground sends requests THROUGH the EdgeFlow gateway to upstream
 *   services (e.g. XCode). Upstream services authenticate using HttpOnly
 *   cookies. Postman stores these automatically; the Playground previously
 *   discarded Set-Cookie headers, so authenticated endpoints failed with
 *   "Token is not present".
 *
 * Design:
 *   - Cookies are keyed by the EdgeFlow dashboard user's id (req.user.id).
 *     Two dashboard users never share cookies.
 *   - Each session has its own Map of (cookieName -> { value, domain, path,
 *     expires, httpOnly }).
 *   - The store honours Set-Cookie attributes (Path, Expires/Max-Age) so
 *     cookies are only sent on matching paths and auto-expire.
 *   - Sessions auto-expire after SESSION_TTL_MS of inactivity to bound
 *     memory usage. A background sweep runs every SWEEP_INTERVAL_MS.
 *   - The store is process-local. In a multi-replica deployment each
 *     replica would have its own jar; if you need cross-replica sessions,
 *     move the store to Redis. For a single-replica dashboard this is
 *     sufficient and avoids a network round-trip on every Playground call.
 */

// logger is intentionally not imported — this module is pure data
// manipulation with no logging needs.

// sessionId (EdgeFlow dashboard user id) -> Map<cookieName, cookieObj>
const sessions = new Map();

const SESSION_TTL_MS = 60 * 60 * 1000;        // 1 hour of inactivity
const SWEEP_INTERVAL_MS = 5 * 60 * 1000;       // sweep every 5 minutes

// ── Parse a single Set-Cookie header value into a cookie object ──
//
// Set-Cookie headers look like:
//   token=eyJhbG...; Path=/; HttpOnly; SameSite=Lax; Max-Age=3600
//   or
//   token=eyJhbG...; Path=/; HttpOnly; Expires=Thu, 07 Jul 2026 04:00:00 GMT
//
// We extract: name, value, domain, path, expires, httpOnly.
function parseSetCookie(headerValue) {
  if (!headerValue || typeof headerValue !== 'string') return null;
  const parts = headerValue.split(';').map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return null;

  // First part is "name=value"
  const firstEq = parts[0].indexOf('=');
  if (firstEq === -1) return null;
  const name = parts[0].slice(0, firstEq).trim();
  const value = parts[0].slice(firstEq + 1).trim();
  if (!name) return null;

  const cookie = {
    name,
    value,
    domain: '127.0.0.1',     // Playground always targets the local gateway
    path: '/',               // default
    expires: null,           // null = session cookie (lives until TTL sweep)
    httpOnly: false,
  };

  for (let i = 1; i < parts.length; i++) {
    const part = parts[i];
    const eq = part.indexOf('=');
    const attr = (eq === -1 ? part : part.slice(0, eq)).toLowerCase();
    const attrValue = eq === -1 ? '' : part.slice(eq + 1).trim();

    switch (attr) {
      case 'path':
        cookie.path = attrValue || '/';
        break;
      case 'domain':
        cookie.domain = attrValue.toLowerCase();
        break;
      case 'httponly':
        cookie.httpOnly = true;
        break;
      case 'expires':
        // HTTP-date; invalid dates are ignored
        const d = new Date(attrValue);
        if (!isNaN(d.getTime())) cookie.expires = d.getTime();
        break;
      case 'max-age':
        const secs = parseInt(attrValue, 10);
        if (Number.isFinite(secs)) {
          // Max-Age=0 or negative means delete immediately
          cookie.expires = secs <= 0 ? 0 : Date.now() + secs * 1000;
        }
        break;
      // samesite, secure, etc. are not relevant for the server-side jar
    }
  }
  return cookie;
}

// ── Does a stored cookie match the request path? ──
// RFC 6265 §5.1.4 path-matching: the cookie path is a prefix of the
// request path, AND either they're equal OR the cookie path ends with /
// OR the request path char right after the cookie path is /.
function pathMatches(cookiePath, requestPath) {
  if (!cookiePath || cookiePath === '/') return true;
  if (requestPath === cookiePath) return true;
  if (requestPath.startsWith(cookiePath)) {
    return cookiePath.endsWith('/') || requestPath[cookiePath.length] === '/';
  }
  return false;
}

// ── Is a cookie expired? ──
function isExpired(cookie) {
  if (cookie.expires === null) return false;
  return Date.now() >= cookie.expires;
}

// ── Get (or create) the cookie Map for a session ──
function getSession(sessionId) {
  let jar = sessions.get(sessionId);
  if (!jar) {
    jar = { cookies: new Map(), lastAccessed: Date.now() };
    sessions.set(sessionId, jar);
  }
  jar.lastAccessed = Date.now();
  return jar;
}

// ── Store Set-Cookie headers from a response ──
//
// `setCookieHeaders` is the array from node's `http.IncomingMessage.headers['set-cookie']`.
// Each entry is a single Set-Cookie header value (one cookie).
function storeResponseCookies(sessionId, setCookieHeaders) {
  if (!sessionId || !Array.isArray(setCookieHeaders) || setCookieHeaders.length === 0) return;
  const jar = getSession(sessionId);
  for (const headerValue of setCookieHeaders) {
    const cookie = parseSetCookie(headerValue);
    if (!cookie) continue;
    // Max-Age=0 / Expires in the past → delete the cookie
    if (cookie.expires === 0) {
      jar.cookies.delete(cookie.name);
      continue;
    }
    jar.cookies.set(cookie.name, cookie);
  }
}

// ── Build the Cookie header for an outgoing request ──
//
// Returns a string like "token=eyJ...; session=abc" or "" if no cookies.
// Also purges expired cookies as a side-effect.
function buildCookieHeader(sessionId, requestPath) {
  if (!sessionId) return '';
  const jar = sessions.get(sessionId);
  if (!jar || jar.cookies.size === 0) return '';

  jar.lastAccessed = Date.now();
  const parts = [];
  for (const [name, cookie] of jar.cookies) {
    if (isExpired(cookie)) {
      jar.cookies.delete(name);
      continue;
    }
    if (pathMatches(cookie.path, requestPath)) {
      parts.push(`${name}=${cookie.value}`);
    }
  }
  return parts.join('; ');
}

// ── Clear all cookies for a session (logout) ──
function clearSession(sessionId) {
  if (sessionId) sessions.delete(sessionId);
}

// ── Get a snapshot for debugging / dashboard display ──
//
// SECURITY: HttpOnly cookie values are NEVER exposed — only the name and
// metadata (path, expires, httpOnly). This prevents the Playground UI from
// leaking HttpOnly tokens to browser-side JavaScript. Non-HttpOnly cookies
// show a truncated value since those are already accessible to JS.
function snapshot(sessionId) {
  const jar = sessions.get(sessionId);
  if (!jar) return { cookies: [], lastAccessed: null };
  return {
    cookies: Array.from(jar.cookies.values()).map((c) => ({
      name: c.name,
      // Only show truncated value for non-HttpOnly cookies. HttpOnly
      // cookies show null — the value must never reach browser JS.
      value: c.httpOnly ? null : c.value.slice(0, 12) + '...',
      domain: c.domain,
      path: c.path,
      httpOnly: c.httpOnly,
      expires: c.expires,
    })),
    lastAccessed: jar.lastAccessed,
  };
}

// ── Background sweep: drop expired sessions + cookies ──
function sweep() {
  const now = Date.now();
  for (const [sessionId, jar] of sessions) {
    if (now - jar.lastAccessed > SESSION_TTL_MS) {
      sessions.delete(sessionId);
      continue;
    }
    for (const [name, cookie] of jar.cookies) {
      if (isExpired(cookie)) jar.cookies.delete(name);
    }
  }
}

// Start the sweep timer. unref() so it doesn't keep the process alive.
const sweepTimer = setInterval(sweep, SWEEP_INTERVAL_MS);
sweepTimer.unref?.();

module.exports = {
  storeResponseCookies,
  buildCookieHeader,
  clearSession,
  snapshot,
  // Exported for testing
  _internal: { parseSetCookie, pathMatches, isExpired, sessions },
};
