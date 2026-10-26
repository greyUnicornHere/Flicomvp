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
| Owner manual test on own PC (5-step check) | Pass | Product owner checked and approved Milestone 0 on 2026-10-26 |

## Milestone 1 — 2026-10-26 (branch `milestone-1-dashboard`)

Environment: Linux container, Node 22.22, Chromium (Playwright 1.63).

### Automated

| Suite | Command | Result |
|---|---|---|
| Lint | `npm run lint` | Pass |
| Typecheck | `npm run typecheck` | Pass |
| Unit + API (server: 56, client: 33) | `npm test` | **89 / 89 pass** |
| Production build | `npm run build` | Pass |
| Browser E2E (M0 auth + M1 dashboard) | `npm run test:e2e` | **11 / 11 pass** |
| Dependency audit | `npm audit` | 0 vulnerabilities |

New coverage:
- **Server:** Start-only creation; unsupported creation kinds rejected; owner-only listing sorted by last modified (rename re-sorts); rename trimming and validation; permanent delete (gone from list and detail, second delete 404, row removed); user separation (B can't read/rename/save/delete A's workflow); sign-in required on every workflow route; workflow limit; autosave contract (revision bump, stale save 409 without overwrite, invalid graphs rejected without changing data); migration upgrade from an M0 database and the status CHECK.
- **Client (rendered in StrictMode):** hero and equal cards with no sidebar; empty state replaces table and search; populated table hides the empty state; column headers, order and status text; live case-insensitive search and no-match message; row click opens; Build manually creates and opens; rename (focus, Enter, re-sort, empty-name error); delete Cancel/Escape keeps (focus returns to ⋯); delete confirm removes (last one brings back the empty state, focus moves to the heading); delete failure keeps the dialog open with an error; list-load Retry; account menu items, keyboard and Sign Out; Feedback disabled; Create with AI sends nothing; workflow not-found page; search/sort helpers; `useAutosave` (no initial save, debounce, in-flight queueing, error and Retry, conflict stop, flush on leave).

### Acceptance cases (05_QA M1)

| ID | Case | Result | Evidence |
|---|---|---|---|
| D01 | No workflows: hero + two equal cards; optional example; no table | Pass (example intentionally omitted per owner) | E2E D01; `docs/evidence/m1/01-dashboard-empty-1536.png`, `02-dashboard-empty-1280.png` |
| D02 | Build manually → `Untitled workflow`, Start only, persisted | Pass | E2E D02/D03 (API check of the graph); `05-workflow-placeholder-1536.png` |
| D03 | Back on dashboard: table appears, empty state disappears | Pass | E2E D02/D03, survives reload |
| D04 | 3 workflows + search: live filter, correct status/date columns | Pass | E2E D04; `03-dashboard-populated-1536.png` |
| D05 | Rename from row action, reopen → persists | Pass | E2E D05 (reload); `07-rename-dialog-1536.png` |
| D06 | Delete → Cancel → workflow remains | Pass | E2E D06/D07 (reload); client test with Escape |
| D07 | Delete → confirm → gone, no trash UI | Pass | E2E D06/D07 (reload + API 404); `08-delete-confirmation-1536.png` |
| D08 | Profile menu: Email, Feedback, Sign Out only | Pass (Feedback disabled, "Coming soon", per owner decision) | E2E D04/D08; `04-dashboard-account-menu-1536.png` |
| D09 | 1280 and 1536px: no sidebar, approved logo, centred max-width | Pass | E2E checks no `nav`/`aside`, `main` ≤ 1200px and centred, no horizontal scroll at 1280; `06-dashboard-populated-1280.png` |
| A06 (UI) | User B opens User A's workflow URL | Pass | E2E A06: "Workflow not found", no private name shown, B's dashboard empty |

### Design comparison with `01-dashboard-approved.png`
Matches: centred hero and subtitle, two equal bordered cards with icon circles and right arrows, hover changes only border/background, "Recent workflows" with search on the right, compact table with a pale header row, status pills, ⋯ row actions, and an account dropdown in the same position.
Intentional differences (spec wins): "Build manually" label; no fake dates or names; no empty state under a populated table; no Explore Example; Feedback disabled until M5.
Fixed during review: card arrows were at different heights when the descriptions wrapped differently.

### Bugs found and fixed during Milestone 1
- **Rename dialog lost keyboard focus in the real browser** (React development StrictMode re-ran the dialog's focus-restore code). Fixed. Component tests now run under StrictMode, and the regression test was confirmed to fail without the fix.
- E2E reads after page reloads now wait for the table instead of racing the data load.

### Owner review fix — 2026-10-26
- **Reported:** the ⋯ row menu was not fully visible near the bottom of the screen; it had to be scrolled to.
- **Cause:** menus always opened downward, inside the table's clipped frame.
- **Fix:** menus are drawn in a layer above the page and placed to stay fully on screen: below the button when there's room, otherwise above, and kept inside the window's edges. They are re-placed on scroll and resize. This applies to the row menu and the account menu (design system §5: "flip/shift to remain inside viewport").
- **Evidence:** new E2E `menu-placement.spec.ts` at 1280×720 and 1536×864 (bottom row scrolled to the window edge: menu fully inside the window, both options clickable at their position, page did not scroll, keyboard still works). It failed before the fix (menu bottom at 720.2px in a 720px window) and passes after. Unit tests for the placement rules. Screenshots `docs/evidence/m1/10-row-menu-near-bottom-1280.png` and `-1536.png`.
- **Test environment:** the full browser suite now signs in 12 times from one machine, exceeding the sign-in rate limit (10 per 15 minutes) and failing the last tests at sign-in. The limit is now a setting (`AUTH_RATE_LIMIT`, default 10, unit tested) that only the E2E server raises.
- **Totals after fix:** unit/API **94 / 94**, E2E **13 / 13**, lint, typecheck and build pass.
