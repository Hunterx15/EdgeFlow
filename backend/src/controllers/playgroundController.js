/**
 * EdgeFlow - API Playground controller
 *
 * Lets the dashboard send a test request THROUGH EdgeFlow and capture
 * the pipeline stages + response metadata. The frontend uses this to
 * power the built-in Postman-like tester.
 *
 * Internally we just fire the request at our own /gateway/* endpoint
 * via http.request so we can capture timing + status + headers + body
 * without exposing axios to the browser.
 *
 * COOKIE JAR:
 *   The Playground maintains a per-dashboard-user cookie jar so that
 *   authenticated flows work the same way they do in Postman. A login
 *   request that returns Set-Cookie: token=... is stored, and the next
 *   request (e.g. GET /user/profile) automatically sends Cookie: token=...
 *
 *   Cookies are keyed by req.user.id (the EdgeFlow dashboard user), so
 *   two dashboard users never share authentication. The jar honours
 *   Set-Cookie attributes (Path, Expires, Max-Age, HttpOnly) and auto-
 *   expires after SESSION_TTL_MS of inactivity. See
 *   services/playgroundCookieStore.js for the full implementation.
 *
 *   The jar lives in-process. If you deploy multiple EdgeFlow replicas,
 *   either pin a user to a replica (sticky sessions) or move the jar to
 *   Redis. For a single-replica dashboard this is sufficient and avoids
 *   a network round-trip on every Playground call.
 */

const http = require('http');
const config = require('../config');
const { ok } = require('../utils/http');
const { generateRequestId } = require('../utils/http');
const cookieStore = require('../services/playgroundCookieStore');

async function send(req, res, next) {
  try {
    const { method, url, headers = {}, body = null } = req.body;
    if (!method || !url) {
      return res.status(400).json({
        success: false,
        error: { code: 'BAD_REQUEST', message: 'method and url are required' },
      });
    }

    // The dashboard user's id is the session key. requireAuth (mounted on
    // /api/v1/playground) guarantees req.user is populated. Two dashboard
    // users get separate cookie jars.
    const sessionId = req.user?.id;
    if (!sessionId) {
      return res.status(401).json({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Playground requires authentication' },
      });
    }

    // SECURITY: Only allow requests to /gateway/* paths — prevent internal
    // SSRF where the Playground could call /api/v1/api-keys or other
    // management endpoints directly (bypassing the gateway proxy).
    const targetPath = url.startsWith('/') ? url : '/' + url;
    const gatewayPrefix = config.server.gatewayPrefix;
    if (!targetPath.startsWith(gatewayPrefix + '/')) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'BAD_REQUEST',
          message: `Playground requests must start with ${gatewayPrefix}/`,
        },
      });
    }
    const start = process.hrtime.bigint();

    // ── Build the outgoing request headers ──
    //
    // We MUST NOT use a single global cookie for every user. The cookie
    // jar is keyed by sessionId (the dashboard user's id) and only
    // cookies whose Path matches targetPath are attached.
    //
    // Caller-provided headers take precedence over the jar — if the user
    // explicitly sets a Cookie header in the Playground UI, we use that
    // instead of the jar's value. This matches Postman's behavior.
    const outgoingHeaders = { ...headers };

    // Auto-attach Content-Type for request bodies if the caller didn't set one.
    const hasBody = body && method.toUpperCase() !== 'GET' && method.toUpperCase() !== 'HEAD';
    if (hasBody && !outgoingHeaders['Content-Type'] && !outgoingHeaders['content-type']) {
      outgoingHeaders['Content-Type'] = 'application/json';
    }

    // If the caller didn't manually set a Cookie header, attach the jar's
    // cookies for this session + path.
    const hasManualCookie =
      'cookie' in outgoingHeaders || 'Cookie' in outgoingHeaders;
    if (!hasManualCookie) {
      const jarCookie = cookieStore.buildCookieHeader(sessionId, targetPath);
      if (jarCookie) {
        outgoingHeaders['Cookie'] = jarCookie;
      }
    }

    const responsePayload = await new Promise((resolve) => {
      const requestBody = hasBody
        ? typeof body === 'string'
          ? body
          : JSON.stringify(body)
        : null;

      const options = {
        method: method.toUpperCase(),
        hostname: '127.0.0.1',
        port: config.server.port,
        path: targetPath,
        headers: {
          ...outgoingHeaders,
          ...(requestBody ? { 'Content-Length': Buffer.byteLength(requestBody) } : {}),
          'X-EdgeFlow-Playground': 'true',
          'X-Request-Id': generateRequestId(),
        },
        timeout: config.gateway.requestTimeoutMs,
      };

      const r = http.request(options, (proxyRes) => {
        const chunks = [];
        proxyRes.on('data', (c) => chunks.push(c));
        proxyRes.on('end', () => {
          const rawBody = Buffer.concat(chunks).toString('utf-8');
          let parsedBody;
          try { parsedBody = JSON.parse(rawBody); } catch { parsedBody = rawBody; }

          // ── Capture Set-Cookie into the session jar ──
          //
          // proxyRes.headers['set-cookie'] is an array of Set-Cookie header
          // values (one per cookie). Each entry is parsed by the store and
          // stored under the session id. Max-Age=0 / past-Expires deletes.
          //
          // We store BEFORE resolving so a subsequent request in the same
          // session sees the new cookies immediately.
          const setCookie = proxyRes.headers['set-cookie'];
          if (setCookie && setCookie.length > 0) {
            cookieStore.storeResponseCookies(sessionId, setCookie);
          }

          resolve({
            status: proxyRes.statusCode || 0,
            statusText: proxyRes.statusMessage || '',
            headers: proxyRes.headers,
            body: parsedBody,
            bodySize: Buffer.byteLength(rawBody),
          });
        });
      });
      r.on('error', (err) => resolve({ status: 0, error: err.message }));
      r.on('timeout', () => { r.destroy(); resolve({ status: 0, error: 'timeout' }); });
      if (requestBody) r.write(requestBody);
      r.end();
    });

    const latencyMs = Math.round(Number(process.hrtime.bigint() - start) / 1e6);

    // Echo the cookies that were sent + the jar's current state so the
    // frontend can show them in the Playground UI (like Postman's Cookies tab).
    //
    // SECURITY: We only expose cookie NAMES (not values) for HttpOnly
    // cookies. This lets the UI show "token (HttpOnly)" without leaking
    // the actual token value to browser-side JavaScript. Non-HttpOnly
    // cookies show their value (truncated) since those are already
    // accessible to JS.
    const cookiesSent = outgoingHeaders['Cookie'] || outgoingHeaders['cookie'] || '';
    const jarSnapshot = cookieStore.snapshot(sessionId);

    return ok(res, {
      ...responsePayload,
      latencyMs,
      request: { method: method.toUpperCase(), url: targetPath, headers: outgoingHeaders, body },
      cookies: {
        // Only show cookie names that were sent, not values (for security).
        // The full values are visible in the jar snapshot below, but only
        // for non-HttpOnly cookies.
        sent: cookiesSent
          ? cookiesSent.split('; ').map((c) => c.split('=')[0]).join('; ')
          : '',
        stored: jarSnapshot.cookies,
      },
    });
  } catch (err) { next(err); }
}

module.exports = { send };
