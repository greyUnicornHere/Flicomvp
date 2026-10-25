# Test notes

Results are recorded as `Pass`, `Fail`, `Not built yet` or `Blocked`, with evidence.

## Milestone 0 — 2026-10-25 (branch `milestone-0-foundation`)

Environment: Linux container, Node 22.22, npm 10.9, Chromium (Playwright 1.63).

### Automated

| Suite | Command | Result |
|---|---|---|
| Lint | `npm run lint` | Pass (0 problems) |
| Typecheck (client + server) | `npm run typecheck` | Pass |
| Unit + API (server: 36, client: 10) | `npm test` | **46 / 46 pass** |
| Production build | `npm run build` | Pass |
| Browser E2E (real dev servers, real SQLite file, real invite script) | `npm run test:e2e` | **5 / 5 pass** |
| Dependency audit | `npm audit` | 0 vulnerabilities |

Server tests cover config validation (production refuses dev outbox and non-https URLs, secrets never echoed), migrations (idempotent, foreign keys, rollback on failure), the full magic-link lifecycle (invited, uninvited, normalisation, single-use, expiry, revoked invitation, per-email limit, hashed storage), sessions (cookie flags, `/me`, logout invalidation, expiry, revocation), authorization (401 unauthenticated, forged cookie, owner access, cross-user 404 with no leak), health (OK and degraded), dev outbox absent in production, Origin check, JSON-only bodies, rate limiting, and security headers.

Client tests cover route protection redirect, API-unreachable Retry, sign-in request, empty-email validation, rate-limit message, verify requiring an explicit click, used-link message, account menu keyboard behavior (Enter opens, focus moves to item, Escape closes and returns focus) and sign-out, and the error boundary.

### Acceptance cases (05_QA M0)

| ID | Case | Result | Evidence |
|---|---|---|---|
| A01 | Start app with documented commands; health endpoint; no secrets echoed | Pass | E2E A01; `server/app.test.ts`; `docs/evidence/m0/04-status-1536.png`; setup → invite → dev dry run |
| A02 | App without sign-in: private pages/API inaccessible | Pass | E2E A02; `server/authorization.test.ts`; `01-sign-in-1536.png` |
| A03 | Invite User A, follow one-time link → signed in; link consumed | Pass | E2E A03–A05; `02`, `03`, `05` screenshots |
| A04 | Reopen same link / expired link → cannot sign in; clear message | Pass | E2E (reuse); `auth.api.test.ts` (reuse + expiry); `08-link-already-used-1536.png` |
| A05 | Sign out; revisit protected URL → requires sign-in | Pass | E2E A03–A05; client test "account menu" |
| A06 | User B requests User A's workflow by URL/API → denied, no leak | Pass (API) | E2E A06 (two browser contexts); `authorization.test.ts`. Workflow URLs/UI arrive in M1. |
| A07 | No `.env` secrets in repo; dev outbox disabled in production | Pass | `.env` is git-ignored and only `.env.example` is committed; production run: `/api/dev/outbox` → 404, outbox page absent from bundle, config refuses `dev-outbox` |

### Manual / visual checks

| Check | Result | Notes |
|---|---|---|
| Sign-in, outbox, signed-in home, account menu at 1536px | Pass | Screenshots `01`–`08` |
| Account menu at 1280px | Pass | `07-account-menu-1280.png` |
| 1280px layout at 200% zoom (640 CSS px) | Pass | No horizontal scroll; desktop notice shown and dismissible; `09-sign-in-1280-at-200pct-zoom.png` |
| Keyboard: tab order on sign-in; account menu Enter/Escape/focus return | Pass | Automated in client test and zoom script |
| Logo matches supplied raster | Pass | Byte-identical file (SHA-256 `2c4a3356…3034`); visible off-white box on white header noted as a known limitation |
| Production mode (`npm run build && npm start`) | Pass | Static app served, CSP/HSTS headers present, `/api/auth/me` 401, outbox 404 |
| Real SMTP email delivery | Blocked | No SMTP credentials yet |
| Microsoft Edge | Blocked | Edge not available in the build environment |
