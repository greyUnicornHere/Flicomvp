# Decisions

Implementation choices and assumptions. Product behavior comes from `docs/handoff/01_Product/Flico_MVP_Development_Specification_v2.md`, which wins any conflict. Entries are newest last.

## Milestone 0 — Foundation (2026-10-25)

### Process (confirmed by product owner)
- **Preview:** the build runs in a cloud container, so the owner reviews screenshots plus test evidence and runs the app locally from GitHub with the README steps.
- **Git:** `main` holds a minimal initial commit. Each milestone is built on its own branch (`milestone-0-foundation`) and merges to `main` after approval. No PR is opened unless requested.
- **Handoff docs** are kept in `docs/handoff/` so later sessions can re-read the spec instead of re-inventing decisions.

### Stack (spec §16 and IMPLEMENTATION_CONTRACTS §1)
| Area | Choice | Why |
|---|---|---|
| Language | TypeScript 5.9 everywhere | TS 7.x (Go port) is newly released and lint tooling support is uncertain. |
| Web | React 19, React Router 7, Vite 7, Tailwind CSS 4 | Stable and widely used. Vite proxies `/api` in development. |
| Diagram | `@xyflow/react` 12 installed, **not used yet** | Stack decision only. The editor is Milestone 2. |
| API | Fastify 5, Zod 4 validation | Maintained, fast, testable via `inject()` without a network. |
| Database | SQLite via Node's built-in `node:sqlite` | **No native compilation**: works on Windows without Visual Studio Build Tools, which `better-sqlite3` can need. Trade-off: Node marks the module experimental, so the startup warning is silenced in npm scripts and Node ≥ 22.13 is required. Access goes through `server/db/` so swapping drivers is contained. |
| Migrations | Ordered TypeScript list in `server/db/migrations.ts`, `schema_migrations` table, one transaction per migration | Ships inside the compiled build (no SQL files to copy). Applied by `npm run db:migrate` and automatically on server start, which suits a single-instance pilot. |
| Email | Adapter: `dev-outbox` (in-memory, development only) or `smtp` (Nodemailer) | The spec requires a development-only outbox. Any SMTP provider works for real delivery. |
| Icons | `lucide-react` | Matches the line-icon style in the approved mockups. |
| Font | Inter, self-hosted via `@fontsource-variable/inter` | No third-party font requests (privacy). It registers as "Inter Variable", so `client/src/styles/app.css` prepends that name to `--fl-font`. Every other token is unchanged. |
| Tests | Vitest 4 (server: node; client: jsdom + Testing Library), Playwright 1.63 (Chromium) | Vitest 3 had open security advisories, so it was upgraded. Playwright is pinned to the version whose browser is installed in the build environment. |

npm 10 has a known resolver crash (`reading 'edgesOut'`) when *re-resolving* this dependency tree. The committed `package-lock.json` was produced with npm 11. `npm ci` / `npm install` from the lockfile works on npm 10 and 11 (verified).

### Design system use
- `client/src/styles/tokens.css` is a byte-for-byte copy of the approved `02_Design/tokens.css`. It loads at the app root inside Tailwind's `components` layer, and Tailwind utilities map to the same CSS variables (`@theme inline`), so there is no parallel token list.
- **Logo:** `client/public/brand/flico-logo.png` is a byte-for-byte copy of the approved `flico-logo-reference-crop.png`. It has not been redrawn, recolored or edited. It is shown at 128px wide (design range 124–132px), natural aspect ratio.
  - **Known limitation:** the raster has a baked-in off-white background (#FDFCF8). On the white header (#FFFFFF, per tokens and the approved mockups) it shows as a very faint box; the approved analysis mockup shows the same artifact. Signed-out pages place it on the page background (#FCFBF8), which matches almost exactly. **A transparent production master (SVG or PNG) is still needed from the brand source.**
  - **Owner decision (2026-10-25): option (a).** Keep the supplied raster as-is and keep the white header until the owner provides a transparent logo. Do not edit the raster or change the header color in the meantime. When the transparent file arrives, replace `client/public/brand/flico-logo.png` (and add a favicon).
  - No favicon yet: making one would require cropping or deriving from the logo, which needs the production asset.
- Header contents align to the 1200px dashboard content width, as in the approved dashboard mockup.
- **Account menu** shows the email and **Sign Out** only. **Feedback** (in the approved dropdown) is added in Milestone 5 with the feedback feature, rather than shipping a non-functional item now.
- Below 1280px a dismissible, non-blocking notice explains the desktop-only scope (design system §6). It never blocks use, so 200% browser zoom still works.
- The signed-in landing page is a deliberately minimal Milestone 0 placeholder. The real dashboard is Milestone 1.

### Authentication and security
- **Invite-only:** invitations live in `invitations` and are managed only by `npm run invite` (no admin UI, per spec §15). There is no sign-up path; uninvited addresses get the same response as invited ones, and no email is sent.
- **Magic links:** 256-bit random tokens. Only SHA-256 hashes are stored. Default lifetime 15 minutes (`MAGIC_LINK_TTL_MINUTES`, 5–60). Single use, consumed atomically in a transaction. Older unused links stay valid until they expire. At most 5 links per address per 15 minutes; extra requests get the normal response but no email.
- **Explicit "Continue to Flico" click:** the emailed link opens a page that signs in only on a button press (a POST). This stops email security scanners that pre-open links from using up the one-time token. The token is removed from the address bar immediately and the page sends no referrer.
- **Sessions:** a random opaque token in an `httpOnly`, `SameSite=Lax` cookie (`Secure` in production), stored hashed, with a fixed 14-day lifetime (`SESSION_TTL_DAYS`). Logout deletes the server session. Revoking an invitation ends all of that person's sessions and pending links.
- **Authorization** is enforced on the server for every private route (`requireAuth` plus `owner_id` in every query). Another user's resource returns the same `404` as a missing one, so its existence isn't revealed.
- **Minimal `workflows` table and read-only `GET /api/workflows/:id`:** added in M0 only so cross-user denial can be tested now (spec A06). There is no create/list/rename/delete and no UI. Milestone 1 extends the table with a new migration.
- **Cross-site request protection:** SameSite cookies, JSON-only request bodies (`text/plain` and form posts are rejected), and an Origin check on state-changing requests.
- **Rate limits** (per client IP, per 15 minutes): 10 link requests (`AUTH_RATE_LIMIT`, raised only for the automated browser tests), 30 verifications. Set `TRUST_PROXY=true` only behind a trusted reverse proxy.
- **Headers:** Helmet with a strict Content-Security-Policy, `frame-ancestors 'none'`, `Referrer-Policy: no-referrer`, and HSTS in production.
- **Logging:** method and path only. No query strings, headers, cookies, bodies or email addresses.
- **Production guardrails:** startup fails with readable messages if `APP_URL` is missing or not https, or if `dev-outbox` is configured. Secret values are never echoed. The outbox API is not registered in production, and the outbox page is not in production bundles.

### Open items for later milestones
- Real SMTP delivery has not been tested against a live provider (no credentials yet). The adapter is in place and covered by config validation.
- Data retention/backup policy, telemetry, and deployment target are decided in Milestone 5.
- Microsoft Edge E2E runs need a machine with Edge installed (the Playwright project is ready to add `channel: 'msedge'`).

## Milestone 1 — Dashboard and persistence (2026-10-26)

### Owner decisions (asked before building)
- **Feedback menu item:** follow the prompt strictly. The account menu lists **email, Feedback, Sign Out**. Feedback is shown but disabled, marked "Coming soon", until the feedback feature is built in Milestone 5. It stays focusable so screen-reader users can discover it.
- **Opening a workflow:** title + placeholder only (`/workflows/:id`), until the editor in Milestone 2. Steps aren't displayed yet.
- **Customer Order Processing example:** not built for now. The empty state shows a short message only.

### Behaviour and data
- `workflows` gains `status` (`draft` | `analyzed`, enforced by a CHECK), `revision` (optimistic locking) and `graph_json` (migration `002`). Existing Milestone 0 databases upgrade automatically on start; this is tested.
- The graph format follows `IMPLEMENTATION_CONTRACTS.md` §2 (`shared/graph.ts`). The server stores a graph only if it passes schema validation, has unique step/connection IDs, and every connection points to an existing step. Unfinished workflows (no Finish, disconnected steps) are allowed; they become editor warnings in Milestone 2. Unknown fields and step types such as `trigger` are rejected.
- **Build manually** creates `Untitled workflow` with exactly one Start step and no Finish (spec §6).
- **List order:** most recently modified first. Renaming counts as a modification.
- **Search:** live, client-side, case-insensitive substring on the name; extra spaces are ignored. A non-matching search shows "No workflows match …" inside the table. It never shows the empty state.
- **Empty state** replaces the table (and search) only when the person has zero workflows.
- **Delete** is permanent, with a confirmation dialog that focuses **Cancel** by default. The dialog says it can't be undone and that there's no trash. Related records added later (analyses, chat) will be removed by `ON DELETE CASCADE`. The backup/retention wording for production is decided with deployment in Milestone 5; the dialog makes no claims about backups.
- **Limits (documented defaults):** 200 workflows per person; 300 steps, 600 connections, 200-character labels and 2,000-character notes per workflow; names 1–120 characters.
- **Autosave storage contract (ready for Milestone 2):** `PUT /api/workflows/:id/graph` with `{ graph, baseRevision }`. A stale revision returns `409` and nothing is overwritten. The client hook `useAutosave` debounces saves, runs one save at a time, keeps failures visible with Retry, stops on conflict, flushes on leaving the screen, and warns before closing the tab with unsaved changes. No editor UI uses it yet.
- **Create with AI** (`/create/ai`) is a labeled input screen. The **Create draft** button is disabled with an explanation, and nothing typed is sent or stored. AI generation is Milestone 3.

### UI
- Text and layout follow the approved dashboard mockup. Product wording comes from the spec: **Build manually** (the mockup says "Create manually") and no Explore Example. Fake mockup dates and names are not reproduced.
- Type sizes follow the design system table (hero 40/48, card and section headings 18/26). The mockup raster is scaled about 1.25× relative to it.
- Menus are drawn in a top layer (portal) with fixed positioning: below the trigger if they fit, otherwise above, clamped inside the window, re-placed on scroll/resize. This came from owner review; the row menu was cut off near the bottom of the screen.
- New primitives: `Menu` (keyboard: Enter/Space/↓ open, ↑/↓/Home/End move, Escape closes and returns focus) and `Modal` (focus trap, Escape and backdrop close, focus returns to the opener, or to the "Recent workflows" heading if the opener was deleted).
- The workflow page uses the editor-style full-width header (logo, back, title, account), not the 1200px dashboard width.
- Dialog focus restoration is safe under React StrictMode. Component tests now render in StrictMode to catch that class of bug; it was found by E2E.

## Milestone 2 — Manual editor (2026-10-26)

### Owner decisions (asked before building)
- **Blank decision outcome:** stays an open path, with a labelled "+ Yes" / "+ No" button on the decision and a validation warning. No placeholder steps are invented.
- **Parallel "wait for all":** a visible Wait step "All activities complete" joins the activities, then continues to whatever followed. Without wait-for-all, the main path continues and the activities run alongside, ending on their own.
- **Deleting a mid-path step:** the confirmation lists every affected connection. When the step sits on a single path, a checked "Keep the path joined" option reconnects it (keeping Yes/No). Otherwise connections are removed and validation shows the gap. Undo always restores it.
- **Floating toolbar:** Action, Decision, Approval, Wait, Finish, Repeat earlier step, Parallel activities, Add exception. Each acts on the selected step. When unavailable, the button says why (tooltip + screen reader).

### Graph semantics (spec §6, §19; contract §2)
- Operations are pure functions (`client/src/editor/ops.ts`) and return a new graph; every user action is one undoable step.
- **Decision:** Yes/No connections are typed `yes`/`no`, labelled, and grouped by the decision's id (`branchGroupId`). When a decision is inserted where the path already continued, that step is never orphaned. The dialog offers "Both paths join again" (suggested; the step gets `joinGroupId`) or "Only Yes/No continues" (the other branch ends separately).
- **Joins / reconnection:** "Connect to a step…" in the step details links a path end forward (or fills an open Yes/No path). The suggestions are where the decision's other paths lead. Backward links aren't offered: they would be loops.
- **Loop:** an explicit `loop` connection back to an earlier step (only steps that lead to the current one are offered), with an optional condition label (default "Repeat"). Validation warns only if nothing in the repeated section has a way out.
- **Parallel:** connections typed `parallel` sharing a group id. The join step stores that group id.
- **Exception:** an `exception` step on a dashed `exception` connection labelled "Exception", with an optional response step.
- **Type changes** in step details are limited to Action, Approval, Wait and Finish (Finish only for steps that end a path). Decisions and exceptions are created through their guided flows.
- New steps get type-based default names ("New action", "New approval", "New wait", "Finish"). The name is selected for typing immediately; naming merges into the same undo step, so one Undo removes the step entirely.
- **Finish** is never created automatically. When exactly one path end remains and there are at least two steps, a dismissible suggestion offers to add it (dismissal remembered for the browser session).
- **Server-side storage check** (in addition to M1): Yes/No only from decisions, at most one of each per decision, and no step connected to itself.

### Layout
- **Deterministic left-to-right layout** (`client/src/editor/layout.ts`): columns follow the longest path from Start (repeat connections ignored), Yes above No, parallel activities stacked vertically, joins level with their parents. The same graph always gives the same picture.
- **No automatic tidying (owner feedback, 2026-10-28).** Edits never re-arrange the diagram; only the **Auto-arrange** button does. New steps are placed by `placeNewSteps`:
  - Existing steps keep their positions, including ones you dragged.
  - A new step sits one column to the right of the step it comes from: Yes above, No below, parallel activities stacked, exceptions underneath, a join level with what it joins. If that spot is taken, the nearest free spot above or below is used.
  - **Making room (owner choice):** when steps are inserted into an existing path, only the steps after them on that path slide right, and only as far as needed. Nothing else moves.
  - Deleting or connecting steps leaves every position unchanged.
- **Arrows:** smooth curves with open arrowheads. **When a curve would pass over another step, the arrow goes around it instead** (owner choice): out from the source, along the nearest clear horizontal lane, and back in to the target. Only those arrows change. Repeat connections always use a lane below the steps they pass. (`client/src/editor/routing.ts`)
- After a change, new steps are brought into view. Small workflows stay fully visible and centred in the free area; larger ones pan to the change, zooming out only when needed.

### Behaviour and accessibility
- Steps are keyboard-focusable. **Enter** opens details, **Delete/Backspace** opens the delete confirmation, **Escape** closes details then clears the selection, and focus stays on the step. Every + (after a step, on a connection, open Yes/No paths) is a real button, and the connection + also appears on keyboard focus. The toolbar is a single Tab stop with arrow-key navigation.
- **Undo/Redo:** header buttons plus Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z only (no other shortcut set). Inside text fields the browser's own text undo applies. History lasts for the session (100 steps) and isn't kept across reloads.
- **Autosave:** each change is saved about 0.8 s later, with revision checking. "Saving…", "Saved" and "Couldn't save — Retry" stay visible until resolved. If another tab saved first, "Changed in another tab — Reload" appears and nothing is overwritten. Leaving the page saves pending changes immediately, and closing the tab with unsaved changes asks first.
- **Validation:** continuous, with a warning marker on the step (included in its screen-reader label) and an "N issues" header summary whose entries move focus to the step. Rules: no or duplicate Start, dangling connection, disconnected step, decision missing a Yes/No path, unlabelled decision path, empty name, repeat with no way out, Finish that continues, parallel with fewer than two activities. The **pre-analysis check** (shared with the server for Milestone 4) runs from the Analyze menu.
- **Not yet built, shown as such:** Ask Flico and Export (disabled, "Available in a later update"), Quick/Guided Analysis and "Suggest fix with AI" ("Coming soon"), and AI Quick Add in the + menu (disabled input). "Ask Flico about this step" in the details is labelled coming soon.
- Reduced motion: viewport animations are skipped when the person prefers reduced motion.
- The browser can't scroll the canvas container (`overflow: clip`), so focusing an off-screen step can't shift the diagram.
- The editor code loads only when a workflow is opened (keeps the dashboard light).
- React Flow's small attribution link is hidden (`proOptions.hideAttribution`), which its MIT licence permits. It can be shown again if preferred.

### Bugs found and fixed during Milestone 2
- **Autosave saved a workflow just by opening it** (development mode runs effects twice; the "skip the first value" check failed). This caused needless writes and false "changed in another tab" conflicts. Now the hook compares with the last known value. Its tests run under StrictMode and were confirmed to fail without the fix.
- **A new step's name box didn't get focus**, because new steps are hidden until measured. Focus is now applied once the step is visible.
- **A step's name box stayed open** after clicking another step (the diagram blocks the normal focus change). It now saves on any click elsewhere.
- **Escape on a step dropped keyboard focus** to the page (the diagram library's own selection handling). Flico now manages selection itself.
- **Repeat connections crossed other steps.** They now route around them.
- **"Suggest fix with AI, Coming soon"** was read with a stray space; menu items now have explicit accessible names.
