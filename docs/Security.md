# Security

## Authentication

### JWT
- **Access tokens:** 15-minute expiry, signed with `JWT_SECRET` using HS256
- **Refresh tokens:** 7-day expiry, signed with `JWT_REFRESH_SECRET` (separate secret)
- **Type claim verification:** `verifyAccessToken` checks `type === 'access'`; `verifyRefreshToken` checks `type === 'refresh'` — prevents token confusion
- **Algorithm pinning:** `algorithms: ['HS256']` on all verify calls — prevents algorithm-confusion attacks
- **Refresh token rotation:** Each refresh issues a new jti (JWT ID) stored in `users.refresh_token_jti`. Old tokens are invalidated.
- **Replay detection:** If a stolen refresh token is replayed after the legitimate user refreshed, the jti mismatch triggers revocation of all tokens for that user.

### Cookies
- `httpOnly: true` — not accessible to JavaScript
- `Secure` flag always set in production — only sent over HTTPS
- `SameSite: strict` — CSRF protection (cross-site requests cannot send the cookie)
- `Path: /api/v1/auth` — scoped to auth endpoints only

### API Keys
- Format: `ef_live_<12-byte-keyId>.<32-byte-secret>` — 256-bit entropy
- Stored as SHA-256 hash (brute-force infeasible at 2^256 search space)
- Plaintext shown only once on creation
- Per-key rate limit override
- Expiration support via `expires_at`

## Gateway Security

### Route-Level Authorization
- `route.auth_required` — when true, the gateway validates the EdgeFlow dashboard JWT at Stage 3.5 before forwarding
- `route.api_key_required` — when true, the gateway validates the `X-API-Key` header at Stage 3
- Authorization header is stripped before forwarding to upstream (dashboard JWT never leaks)

### SSRF Protection
- Upstream URL validation rejects non-HTTP(S) protocols
- `isPrivateIp()` blocks 169.254.169.254, 10.x, 127.x, 192.168.x, 172.16-31.x
- Health check probe does not follow redirects
- Playground URL validation enforces `/gateway/*` prefix (prevents internal SSRF to management API)

### Input Validation
- All SQL queries use parameterized placeholders (`$1, $2, ...`)
- `pick()` uses `Object.prototype.hasOwnProperty.call()` — prototype-pollution-safe
- All write endpoints have schema validation middleware
- Pagination params clamped to [1, 500]
- Body size limit enforced on both management API and gateway

### HTTP Security Headers
- Helmet: X-Content-Type-Options, X-Frame-Options, HSTS
- `X-Powered-By` disabled
- `trust proxy` configured for correct client IP detection behind reverse proxies

## Known Gaps

| Gap | Risk | Mitigation |
|-----|------|------------|
| Rate limiter fails open on Redis error | DoS during Redis outage | Acceptable tradeoff for availability; document the behavior |
| No CSRF token | Same-site subdomain attacks | `SameSite: strict` mitigates the primary vector |
| No PII redaction in logs | Accidental sensitive data in logs | Callers must manually avoid logging sensitive fields |

## Environment Validation

In production (`NODE_ENV=production`), the config module fails fast if:
- `JWT_SECRET` or `JWT_REFRESH_SECRET` match dev defaults
- `JWT_SECRET` is less than 32 characters
- `SEED_ADMIN_PASSWORD` is the default
- `DATABASE_URL` is not set
