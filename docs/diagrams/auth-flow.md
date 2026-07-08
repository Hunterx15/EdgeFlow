# EdgeFlow - Authentication Flow

EdgeFlow has two distinct auth surfaces: dashboard admins use JWT, API consumers use opaque API keys.

## 1. JWT (Dashboard Admins)

```
┌─────────┐                            ┌──────────┐                       ┌──────────┐
│ Browser │                            │ EdgeFlow │                       │ PostgreSQL│
└────┬────┘                            └────┬─────┘                       └────┬─────┘
     │                                      │                                  │
     │ 1. POST /api/v1/auth/login           │                                  │
     │    { email, password }               │                                  │
     ├─────────────────────────────────────▶│                                  │
     │                                      │ 2. SELECT * FROM users WHERE     │
     │                                      │       email = $1                 │
     │                                      ├─────────────────────────────────▶│
     │                                      │  ◀──── user row ─────────────────│
     │                                      │                                  │
     │                                      │ 3. bcrypt.compare(password,      │
     │                                      │              user.password_hash) │
     │                                      │                                  │
     │                                      │ 4. jwt.signAccessToken(user)     │
     │                                      │    jwt.signRefreshToken(user)    │
     │                                      │    + random jti                  │
     │                                      │                                  │
     │                                      │ 5. UPDATE users SET              │
     │                                      │    refresh_token_jti = $jti,     │
     │                                      │    last_login_at = NOW()         │
     │                                      ├─────────────────────────────────▶│
     │                                      │                                  │
     │ 6. 200 OK                            │                                  │
     │    Set-Cookie: refreshToken          │                                  │
     │      (httpOnly, SameSite=strict,     │                                  │
     │       maxAge=7d)                     │                                  │
     │    Body: { user, accessToken }       │                                  │
     │◀─────────────────────────────────────┤                                  │
     │                                      │                                  │
     │ 7. Subsequent request:               │                                  │
     │    Authorization: Bearer <accessToken>                                  │
     ├─────────────────────────────────────▶│                                  │
     │                                      │ 8. jwt.verifyAccessToken()       │
     │                                      │    (HS256, 15m expiry check)     │
     │                                      │    req.user = { id, email, role }│
     │                                      │                                  │
     │ 9. 200 OK + response data            │                                  │
     │◀─────────────────────────────────────┤                                  │
     │                                      │                                  │
     │ 10. Access token expired → 401       │                                  │
     │◀─────────────────────────────────────┤                                  │
     │                                      │                                  │
     │ 11. POST /api/v1/auth/refresh        │                                  │
     │     (cookie sent automatically)      │                                  │
     ├─────────────────────────────────────▶│                                  │
     │                                      │ 12. jwt.verifyRefreshToken()     │
     │                                      │     → decoded.sub, decoded.jti   │
     │                                      │                                  │
     │                                      │ 13. SELECT * FROM users WHERE    │
     │                                      │     id = $1                      │
     │                                      ├─────────────────────────────────▶│
     │                                      │  ◀──── user row ─────────────────│
     │                                      │                                  │
     │                                      │ 14. if user.refresh_token_jti    │
     │                                      │     !== decoded.jti              │
     │                                      │     → REPLAY ATTACK DETECTED     │
     │                                      │     → revoke all sessions (401)  │
     │                                      │                                  │
     │                                      │ 15. Issue NEW access + refresh   │
     │                                      │     tokens, NEW jti              │
     │                                      │     UPDATE users SET             │
     │                                      │     refresh_token_jti = $newJti  │
     │                                      ├─────────────────────────────────▶│
     │                                      │                                  │
     │ 16. 200 OK                           │                                  │
     │     Set-Cookie: new refreshToken     │                                  │
     │     Body: { user, accessToken }      │                                  │
     │◀─────────────────────────────────────┤                                  │
```

### Why two tokens?

- **Access token** (15m, stateless) — verified by HS256 signature only. No DB lookup needed. Fast.
- **Refresh token** (7d, stateful via jti) — long-lived but revocable. Stored as `users.refresh_token_jti` so we can detect theft: if a stolen token is replayed after the legitimate user refreshed, the jti won't match → revoke all sessions.

This is the same pattern described in RFC 6749 §10.4 (refresh token rotation).

## 2. API Keys (API Consumers)

```
Client                       EdgeFlow                    PostgreSQL
  │                             │                           │
  │ GET /gateway/users/123      │                           │
  │ X-API-Key: ef_live_xxx.yyy  │                           │
  ├────────────────────────────▶│                           │
  │                             │ 1. parse X-API-Key:       │
  │                             │    split on '.' →         │
  │                             │    (keyId, secret)        │
  │                             │    hashSecret(secret)     │
  │                             │                           │
  │                             │ 2. SELECT * FROM api_keys │
  │                             │    WHERE key_id = $1      │
  │                             │      AND key_hash = $2    │
  │                             │      AND enabled = TRUE   │
  │                             ├──────────────────────────▶│
  │                             │  ◀──── api_key row ───────│
  │                             │                           │
  │                             │ 3. if expires_at < NOW()  │
  │                             │    → 401 "API key expired"│
  │                             │                           │
  │                             │ 4. UPDATE api_keys SET    │
  │                             │    last_used_at = NOW(),  │
  │                             │    total_requests += 1    │
  │                             ├──────────────────────────▶│
  │                             │                           │
  │                             │ 5. Continue to rate limit │
  │                             │    + cache + LB + proxy   │
  │                             │                           │
  │ 200 OK + proxied response   │                           │
  │◀────────────────────────────┤                           │
```

### Why SHA-256 instead of bcrypt for API keys?

- API keys are 32 bytes of cryptographic random — already high-entropy.
- Brute-force is infeasible even with a fast hash.
- We need O(log n) lookup by `(key_id, key_hash)` — bcrypt would add ~250ms per authenticated request.
- Bcrypt is for low-entropy human passwords; SHA-256 is fine for high-entropy machine credentials.

This is the same approach used by Stripe and GitHub personal access tokens.
