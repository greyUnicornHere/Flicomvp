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

### Owner sign-off
| Check | Result | Notes |
|---|---|---|
| Owner manual test on own PC, including the ⋯ menu fix | Pass | Product owner checked and approved Milestone 1 on 2026-10-26 |

## Milestone 2 — 2026-10-26 (branch `milestone-2-editor`)

Environment: Linux container, Node 22.22, Chromium (Playwright 1.63).

### Automated

| Suite | Command | Result |
|---|---|---|
| Lint | `npm run lint` | Pass |
| Typecheck | `npm run typecheck` | Pass |
| Unit + API (server + shared: 66, client: 84) | `npm test` | **150 / 150 pass** |
| Production build | `npm run build` | Pass (editor loads as a separate chunk) |
| Browser E2E (auth, dashboard, menus, editor) | `npm run test:e2e` | **29 / 29 pass** (16 new editor tests) |
| Dependency audit | `npm audit` | 0 vulnerabilities |

New unit coverage:
- **Graph operations** (deterministic fixtures from 05_QA): insert after a step and on a connection (keeps Yes/No), Finish never placed mid-path, toolbar insertion point; decision with two outcomes, suggested join, one path continuing, blank outcomes left open (never orphaning the next step); join suggestions; connect/remove keeping branch meaning; loop targets and validation of a way out; parallel with and without wait-for-all (shared group, join step); exception with response; delete impact, reconnect keeping Yes, no reconnect for decisions, Start protected, loops removed; detail updates and allowed type changes.
- **Layout:** sequence on one line; Yes above No, symmetric, joins level; parallel stacked; loops ignored for columns; deterministic and connection-preserving; 25-step QA fixture 6 shape without overlaps.
- **Validation:** connected unfinished workflow is clean; QA fixture 7 (dangling, missing branch, unlabelled paths, empty name, disconnected); Start/Finish rules; parallel with one activity; stable issue ids; pre-analysis blockers versus warnings.
- **History** (exact undo/redo, redo branch discarded, naming merged into the add step, 100-step limit); **autosave** under StrictMode; **placement** of the details panel; reduced motion.
- **Server:** rejects Yes paths from non-decisions, duplicate Yes on one decision, and self-connections.

### Acceptance cases (05_QA M2)

| ID | Case | Result | Evidence (E2E `tests/e2e/editor.spec.ts`; screenshots `docs/evidence/m2/`) |
|---|---|---|---|
| E01 | Manual workflow: only Start, visible +, dotted canvas | Pass | E01/E02; `01-start-only-1536.png` |
| E02 | + → Action: block appears, default name selected for editing | Pass | E01/E02 (name focused, value "New action"); `02-insert-menu-1536.png` |
| E03 | Decision: guided question + Yes/No outcomes, two labelled branches | Pass | E03/E04 (stored yes/no edges, labels, group) |
| E04 | Actions on both branches + suggested reconnection | Pass | E03/E04 (Connect dialog pre-selects Finish; both paths join; 0 issues); `03-decision-merge-1536.png` |
| E05 | Branch ends independently | Pass | E05 (no forced reconnection, no warnings) |
| E06 | Guided loop to a previous step persists after reload | Pass | E06–E08 (typed loop edge with label survives reload; routed around steps); `04-loop-parallel-exception-1536.png` |
| E07 | Two parallel activities, both must finish | Pass | E06–E08 (shared group id, "All activities complete" join with matching joinGroupId, continues to Finish) |
| E08 | Exception on an action | Pass | E06–E08 (dashed, labelled exception path + response step) |
| E09 | Select a step → contextual popover with all approved fields | Pass | E09 (all fields persist after reload; Escape returns focus); `05-step-popover-1536.png` |
| E10 | Delete a connected step, Cancel | Pass | E10–E12 (nothing changes) |
| E11 | Confirm delete with affected connections shown; Undo restores exactly | Pass | E10–E12 (both connections listed, reconnect offered; Undo restores identical ids); `06-delete-confirmation-1536.png` |
| E12 | Undo/Redo multiple edits | Pass | E10–E12 (buttons + Ctrl+Z / Ctrl+Shift+Z); history unit tests |
| E13 | Autosave; refresh keeps names, notes, topology, positions | Pass | E13 (dragged position and rename survive reload); E09 (notes) |
| E14 | Save error: durable message + Retry, nothing lost | Pass | E14 (stays visible, Retry saves; second-tab conflict never overwrites); `07-save-error-retry-1536.png` |
| E15 | Incomplete branch: inline marker + header summary point to it | Pass | E15 (marker in label, summary focuses the step, manual fix clears it; AI fix disabled); `08-validation-summary-1536.png` |
| E16 | Pan / zoom / fit / auto-arrange keep semantics | Pass | E16; layout unit tests |
| E17 | Keyboard only: add, edit, delete, confirm, navigate | Pass | E17 (details, + menu with arrows, naming, toolbar arrows, Delete key) |
| E18 | 1280px: header and floating tools don't overlap core controls | Pass | E18 (no horizontal scroll, header fits, toolbar/controls don't cover steps); `10-editor-1280.png` |
| — | Label truncation | Pass | Long name keeps block height; full name in tooltip, screen-reader label and details; `09-label-truncation-1536.png` |
| — | Finish suggested, not auto-created | Pass | Finish test |
| — | Opening a workflow never saves it | Pass | Regression test for the bug below |
| — | Unbuilt commands clearly disabled | Pass | E15 (Ask Flico, Export disabled; Quick/Guided Analysis and Suggest fix "Coming soon"); E01 (Quick Add input disabled) |

### Design comparison with `02-editor-approved.png`
Matches: single header (logo, back arrow, title, Saved, Undo/Redo, Ask Flico, gradient Analyze ▾, Export, avatar); warm dotted canvas with "WORKFLOW EDITOR" and "Changes save automatically · Drag the canvas to pan"; pebble-shaped blocks with tinted icon squares and type colours (Start/Action green, Decision lavender, Approval amber, Wait blue, Finish grey); curved connections with open arrowheads and Yes/No chips; floating vertical toolbar on the left; bottom-right zoom − 100% +, fit and Auto-arrange; floating "Edit step" panel with Step name, Owner / team, Duration, Tools / software, Notes and "Ask Flico about this step". The Customer Order Processing shape from the mockup reproduces closely (`03-decision-merge-1536.png`).
Intentional differences: Editor/Analysis tabs appear only once an analysis exists (Milestone 4); the details panel also has Type, Connections and Delete (spec §5); unbuilt AI and export features are visibly disabled; mockup sample owners and durations aren't reproduced.

### Bugs found and fixed during Milestone 2
See DECISIONS.md: autosave saving on open (regression test proves the fix), new-step name focus, name box staying open, Escape dropping focus, repeat connections crossing steps, menu item naming. Each has a test that failed before its fix.

### Owner review changes — 2026-10-28
- **Feedback 1:** "Adding steps should not tidy up the layout automatically, until the user selects Auto-arrange." **Done.** Edits now place only the new steps: existing (and hand-placed) steps keep their positions, and an insertion slides only the steps after it on that path to the right (owner's choice). Auto-arrange is the only full tidy.
- **Feedback 2:** the long-arrow limitation was unclear. Explained in plain words, and **fixed by owner choice**: an arrow whose curve would pass over a step now goes around it through clear space.
- **Evidence:**
  - Unit: `client/src/editor/placement.test.ts` (7: add at the end moves nothing, insertion slides only later steps by exactly the room needed, no slide when there's room, decision/parallel/exception placement with free-space search, rename/delete/connect move nothing) and `routing.test.ts` (5: curve kept when clear, crossing detected, detour lane avoids steps, backwards arrows untouched, rounded corners).
  - E2E: "adding steps never tidies the layout" (hand-placed step unchanged after adding steps; insert on an arrow slides only Verify stock and Finish; Auto-arrange then re-arranges columns) and "a long arrow goes around a step" (the drawn path never passes over the step; it becomes a simple curve again once the step is moved away).
  - Screenshots: `docs/evidence/m2/11-no-auto-tidy-1536.png`, `12-long-arrow-detour-1536.png`.
- **Totals after these changes:** unit/API **162 / 162**, E2E **31 / 31**, lint, typecheck and build pass.

### Owner sign-off
| Check | Result | Notes |
|---|---|---|
| Owner manual test on own PC, including the no-auto-tidy and long-arrow changes | Pass | Product owner approved Milestone 2 on 2026-10-28 |
