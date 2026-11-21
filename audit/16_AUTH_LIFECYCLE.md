# Authentication Lifecycle

Scope: registration, login, session refresh, logout, password reset, and the session
cookie contract.

---

## 1. Pages

| Route | HTTP | Purpose |
|---|---|---|
| `/login` | 200 | sign in |
| `/register` | 200 | create an account |
| `/forgot-password` | 200 | request a reset link (renders outside the app shell — no landmarks) |
| `/reset-password` | 200 | set a new password |
| `/auth/callback` | — | Supabase auth callback (public route) |

## 2. Checks

| ID | Check | Expected | Observed | Status |
|---|---|---|---|---|
| AUTH-01 | an unauthenticated page request redirects to the login page | 302 → `/login?redirectTo=…` | 302 | PASS |
| AUTH-02 | an unauthenticated API request returns JSON, never an HTML redirect | 401 JSON | 401 JSON on every route | PASS |
| AUTH-03 | an authenticated user opening `/login` is moved on | 302 → `/dashboard` | 302 | PASS |
| AUTH-04 | the `redirectTo` parameter cannot be used for an open redirect | the target must be a local path | the parameter is used as an internal path; an absolute URL would be rejected by `new URL(redirectTo, request.url)` only if it is validated — **not explicitly validated** | PARTIAL |
| AUTH-05 | a forged cookie is rejected | 401 | 401 | PASS |
| AUTH-06 | the session cookie is `httpOnly` | yes | the cookie is written by `@supabase/ssr` with `httpOnly` | PASS |
| AUTH-07 | the session cookie is `Secure` / `SameSite=Lax` | yes | yes in production | PASS |
| AUTH-08 | the payload is signed by Supabase and verified server-side | yes | `auth.getUser()` calls the Auth server; a self-signed token fails | PASS |
| AUTH-09 | an expired token is rejected | yes | the verification is server-side | PASS |
| AUTH-10 | the server never refreshes the session | yes | the middleware reads the cookie only, to avoid the refresh-token race | PASS |
| AUTH-11 | the refresh token is single-use | yes | enforced by Supabase Auth | PASS |
| AUTH-12 | the login form validates before sending | yes | the client validates the e-mail and the password length | PASS |
| AUTH-13 | the login endpoint is rate limited | 10/minute | the `auth` class applies | PASS |
| AUTH-14 | the registration endpoint is rate limited | 10/minute | yes | PASS |
| AUTH-15 | a registration creates only the requested profile | yes | the role is assigned server-side; the client cannot choose it | PASS |
| AUTH-16 | the password-reset flow does not disclose whether an account exists | no enumeration | the response is generic | PASS |
| AUTH-17 | the reset link cannot be replayed | single use | enforced by Supabase Auth | PASS |
| AUTH-18 | logout clears the session | yes | `signOut()` removes the cookies | PASS |

## 3. How sessions are obtained in this audit

The audit never typed a password into a form. Sessions were minted through Supabase's own
admin flow:

```
POST /auth/v1/admin/generate_link   { type: "magiclink", email }      (service role)
POST /auth/v1/verify                 { type: "magiclink", token_hash }  → session
cookie: sb-<ref>-auth-token = base64-<base64url(JSON session)>
```

The cookie envelope must be **base64url** without padding — `@supabase/ssr` decodes it with
`stringFromBase64URL()` and silently treats a standard-base64 payload as absent, which
produces a misleading 401. This cost a debugging cycle during the audit and is documented
here so the next person does not repeat it.

| Identity | Role | Status |
|---|---|---|
| `an2s.q.11@gmail.com` | admin | kept |
| `an2s.q.3@gmail.com` | employee | kept |
| `audit-probe-viewer@elnour.test` | viewer | temporary — **deleted at the end of the run** |
| forged / malformed cookie | — | negative test |

## 4. The registration path — what was *not* executed

| Area | Status | Reason |
|---|---|---|
| creating a new account through `/register` | **NOT EXECUTED** | it would create a user in the production Auth project; the audit avoided creating accounts beyond the one temporary viewer |
| the e-mail confirmation flow | NOT EXECUTED | same reason |
| the "forgot password" e-mail delivery | NOT EXECUTED | the message would be sent to a real mailbox |
| the reset-password screen | partially executed | the screen was loaded (HTTP 200) and its semantics inspected; the actual token flow was not driven |

The validation and rate-limit behaviour of the auth endpoints was exercised through the
probe harness (malformed payloads → 400/401), but no account was created.

## 5. Residual risks

1. **`redirectTo` is not validated against an allow-list.** `new URL(redirectTo, request.url)`
   keeps a relative path local, but a value like `//evil.example` could resolve to another
   host. Low impact (it requires a crafted link and the session cookie does not leak to
   the other host), but a one-line check (`startsWith('/') && !startsWith('//')`) closes it.
2. **No multi-factor authentication.** The admin role can configure integrations and
   disconnect them; a second factor would raise the cost of a stolen admin session.
3. **The temporary viewer account must be deleted.** It is the only artefact of the audit
   that still lives in the Auth project; the deletion is the last step of the run.
4. The application never calls `getUser()` in the middleware, which is correct, but it
   means the edge gate trusts the cookie's *presence*. A forged cookie reaches the route
   handler (and is rejected there with 401) — the defence in depth is intact.
