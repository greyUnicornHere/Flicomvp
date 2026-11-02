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
- **Type changes** in step details are limited to Action, Approval, Wait and Finish (Finish only for steps that end a path). Decisions and exceptions are created through their guided flows. *(Updated by owner request 2026-11-01: a decision can now become Action, Approval or Wait, or Finish when nothing follows it; see "Changing a decision's type" below.)*
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

## Milestone 3 — AI generation, Quick Add and Ask Flico (2026-10-28)

### Owner decisions (asked before building)
- **Provider:** Anthropic Claude, through the official `@anthropic-ai/sdk`, behind a provider-agnostic adapter (`server/ai/provider.ts`). Default model **Claude Haiku 5.5** (`claude-haiku-5-5`, owner's choice 2026-10-28; changeable with `AI_MODEL`).
- **Live demo:** the owner adds `ANTHROPIC_API_KEY` to this cloud environment. Until then everything runs against a clearly labelled test fixture and nothing pretends to be a live answer.
- **Cost of AI:** AI drafts, Quick Add and Ask Flico never use analysis credits. They have per-person daily limits (UTC days), set in `.env`: `AI_DAILY_DRAFTS=20`, `AI_DAILY_QUICK_ADDS=100`, `AI_DAILY_CHAT=150` (Suggest Fix counts as chat). Reaching a limit gives a clear message and manual editing keeps working.

### Adapter and providers
- A provider turns one request into raw text and never touches the database. Use cases (`server/ai/service.ts`): `generateWorkflow`, `quickAdd`, `answerAssistant` (answers, edit proposals and Suggest Fix). Analysis (Milestone 4) will plug into the same adapter.
- **`AI_PROVIDER`**: `anthropic` (live), `fixture` (deterministic test responses for development and automated tests; refused in production) or `none`. Empty means `anthropic` when a key is set, otherwise `none`. With no provider, every AI feature says "AI isn't set up on this server" and sends nothing.
- **Live provider** (`server/ai/anthropic.ts`): structured output (`output_config.format` with a JSON Schema), `effort` per task (drafts and chat `medium`, Quick Add `low`), adaptive thinking (on by default; Flico never sends a thinking budget, which Haiku 5.5 rejects), request timeout (`AI_TIMEOUT_SECONDS`, default 90; Quick Add at most 30), one SDK retry for transient errors. **Refusal fallback:** Haiku 5.5 has no server-side fallback, so none is sent and a refusal shows "Flico couldn't help with that request." If `AI_MODEL` is set to an Opus 5 or Fable 5 model, Flico sends `fallbacks: "default"` (beta `server-side-fallback-2026-07-01`) so Anthropic re-runs a declined request on its recommended fallback model; if the API rejects that option, Flico asks once more without it.
- The Claude API address is always explicit (`AI_BASE_URL`, default `https://api.anthropic.com`, must be https in production), so the key can never follow an `ANTHROPIC_BASE_URL` inherited from the machine's environment. (This cloud environment sets one for its own use.)
- Errors map to safe messages (timeout, busy, unavailable, misconfigured, refused). Only the error class is logged; prompts, workflow text and replies never are.
- Every response is tagged `live` or `fixture`. The interface labels fixture output ("Test fixture, not a live AI response", "test mode" notice on Create with AI, fixture note on drafts and Quick Add).

### Validation of model output (never trusted)
- Versioned schemas (`server/ai/schemas.ts`, `v1`): JSON Schema sent to the model, then re-checked with Zod (types, enums, lengths, counts).
- The model never sees or produces real IDs. Steps and connections are shown as short refs (`s1`, `c1`) and new steps use `n1`, `n2`… The server translates refs to IDs; an unknown or duplicate ref is an error, never a guess.
- Edit proposals are a finite list of operations (`shared/aiOps.ts`): add/update/remove step, add/remove/update connection, at most 40. Applying is all-or-nothing and checks references, duplicate IDs, Start protection, names, Yes/No only from decisions (one each), self-connections, duplicate connections and size limits.
- **One correction attempt:** if output fails any check, the model gets the list of problems once and must return a corrected response. Never a third call.
  - Draft still invalid: the valid part is kept (broken steps and connections dropped, a Start added if missing) and marked partial; the editor offers **Retry** (a new draft; the partial one stays saved) or **Continue editing manually**. Nothing usable: nothing is created and the description stays in the box.
  - Chat proposal still invalid: the answer is shown with "I couldn't turn this into a valid change… nothing is proposed".
  - Quick Add still invalid: a clear message in the menu; nothing inserted.
- **Prompt injection:** workflow text, descriptions and issues are JSON-encoded inside tagged blocks (with `<` escaped so text can't close a tag), and the system prompt says to treat them as data. The prompt contains only this workflow, its chat and its issues: no other workflows, no secrets, no IDs. Above all, nothing a model says can change the graph without validation and the person's explicit Apply.

### AI Create
- `POST /api/workflows/ai-draft` creates a named draft straight away, without questions. Steps the description didn't mention are marked `ai-inferred` / `unconfirmed`, with an **Inferred** tag on the canvas and a "Confirm step" action in the step details. The draft is laid out with the normal auto-arrange and fitted to the canvas.
- **Assumptions** are stored with the workflow (`assumptions_json`) and shown in a collapsible card: Confirm, Edit (an edited assumption counts as confirmed), Remove and Show step(s). It collapses when Ask Flico opens.

### AI Quick Add
- The **Describe what happens next…** box in the + menu infers a type (Action, Decision, Approval, Wait, or Finish where a path ends) and a name, then **inserts immediately** at that spot as one undoable step. This is the only AI action without a preview (spec §6). A message offers **Undo**. The step is marked Inferred until confirmed (design §7.4). Finish suggested between two steps becomes an Action.

### Ask Flico
- Floating, movable window (not a sidebar): compact 360×460, **Expand** to 520×640, **Minimize**, **Close**. It always stays inside the viewport (drag, resize or window resize), and can be moved with arrow keys on its handle. Escape closes it and focus returns to the Ask Flico button.
- One conversation per workflow, stored in `workflow_chat_messages` (deleted with the workflow). **Clear History** asks first and never touches the workflow. The latest 20 turns go to the model as context. A question and its answer are stored together only when the answer succeeds, so a failure leaves nothing half-saved; the message can be retried.
- Fixed suggested prompts: Summarize / What's missing or unclear? / Fix the issues (when there are issues). For a selected step: Explain / What could go wrong / Suggest an improvement. "Ask Flico about this step" in the step details sets that context.
- Model text is plain text only (never HTML or Markdown), so it can't inject markup.
- No analysis exists yet. The prompt says so; Milestone 4 adds the latest analysis to the context.

### Edit proposals, preview and Apply (contract §3)
- Before any AI request about the graph, pending edits are saved first so the server has exactly what the person sees. The request names that revision; a stale one is refused.
- A valid proposal appears in chat **and** as a read-only overlay on the canvas at the same time: added steps and connections green **+ Added**, changed amber **↗ Updated**, removed red, dashed and struck through **− Removed** (badges and line styles, not colour alone; screen-reader labels say "Proposed: added", etc.). A bar shows what changes, a legend, and Apply / Cancel. Editing is paused during the preview. The saved graph isn't touched.
- **Apply** (`POST …/chat/:messageId/apply`) re-checks owner, the expected revision, the operations and graph integrity, then saves in one transaction. The editor adopts the saved graph as **one undoable step**. If the workflow changed since the suggestion, the proposal is marked expired and nothing changes.
- **Cancel** discards only the preview and marks the suggestion cancelled. Suggestions in the history keep their final state (Applied / Cancelled / Not applied).
- **Suggest Fix with AI** (issues menu, or the prompt) asks for the smallest fix for the current validation issues and goes through the same preview and Apply.
- New steps from an applied proposal are placed with the same `placeNewSteps` as manual edits (moved to `shared/layout.ts` so the server places them exactly as the preview did).

### Limits and protection
- Daily limits as above; `AI_RATE_LIMIT` (default 20 per minute per client address) on AI requests; text limits: description 4,000, chat message 2,000, Quick Add 300 characters; model output bounded (max tokens per task, at most 60 draft steps).
- `ai_usage` records counts and token totals per person and day (no content), so costs can be monitored.
- The sign-in link verification limit now follows `AUTH_RATE_LIMIT` when that is set above 30 (default unchanged at 30 per 15 minutes). The longer E2E suite signs in more than 30 times.

## Milestone 4 — Analysis and recommendations (2026-10-28)

### Owner decisions (asked before building)
- **Model:** Claude Haiku 5.5 for everything, analysis included (no separate analysis model).
- **Guided questions:** picked by AI for each workflow (up to three, all optional). Preparing them is free (no credit) and counts as one Ask Flico message toward the daily limit.
- **Numbers:** strictly qualitative. No savings, percentages, money, time savings or ROI in this milestone.
- **Credits display:** in the Analyze menu only ("9 of 10 analyses left"). Acceptance case D08 keeps the account menu to Email, Feedback and Sign Out, so credits aren't added there.

### Credits (spec §10; contract §4)
- Append-only `credit_ledger`; the balance is the sum. Everyone gets `ANALYSIS_INITIAL_CREDITS` (10) once, recorded as an `initial_grant` with a unique key.
- One credit is debited **in the same transaction that saves the completed analysis**. The debit row carries the run id, which is unique, so a run can never be charged twice. Failed, cancelled, interrupted and duplicate requests are never charged.
- Each attempt has a client-generated idempotency key. Repeating it returns the same run (still running, or already done) instead of starting a new one. After a lost request the editor retries with the same key.
- One running analysis per person at a time. With no credits left, starting is refused before anything is sent to the model.
- Top-ups use a script (no admin UI): `npm run credits -- person@example.com 5` (negative numbers for corrections, with an optional note); without a number it shows the balance and history.

### Running an analysis
- Analyze → **Quick** or **Guided**. Blockers from the pre-analysis check prevent starting; warnings don't. Pending edits are saved first and the run names that revision.
- Runs happen in the background with **real stages**, shown in a centered overlay above the canvas: Checking the workflow → Reviewing steps, hand-offs and waits → Checking the proposed changes → Saving your assessment. No percentages.
- **Cancel** works until saving begins. It aborts the model request; if the result arrives anyway, the save transaction sees the cancellation and stores nothing.
- Runs interrupted by a server restart are marked failed on start-up (uncharged).
- On success the editor switches to the **Analysis** tab automatically.

### What the analysis contains (spec §11; contract §3)
- A short headline, an executive summary, overall assumptions and the person's Guided answers, plus up to 8 recommendations. Each recommendation has title, problem, proposal, reason, benefits, effort, impact, risks, assumptions, verification, dependencies, a category (Quick Win / Strategic Improvement / Complex Change), an evidence label (Supported by your workflow / Based on assumptions / Requires verification) and the diagram operations that implement it.
- **Validation** (same rules as Ask Flico proposals): every recommendation's operations must apply cleanly to the analysed workflow on their own. Refs are translated to IDs, unknown refs are errors, dependencies must exist, and the outcome must match (recommendations ⇔ "improvements").
- **No invented figures:** percentages, money amounts, "save N hours", "N× faster" and ROI are rejected unless that exact figure appears in the workflow or the person's answers.
- One correction attempt with the problems listed. After it, invalid recommendations are dropped and sentences with unsupported figures are removed. If no valid recommendation remains, the run fails (uncharged). An honest "no improvements" result is accepted and charged as a normal completed analysis.
- **Initial and Latest only:** the first analysis of a workflow is kept as Initial; each later one replaces Latest. With a single analysis there is one record and no version switcher. The workflow's status becomes **Analyzed**.
- Each analysis keeps the exact snapshot it assessed: the original is preserved.

### Review screen (spec §12; design §7.5)
- Editor/Analysis tabs in the header (once an analysis exists). Both stay mounted, so switching keeps the canvas view, the selected recommendation, filters and expanded details.
- Page: overline, headline, Initial/Latest dropdown, "Apply reviewed changes"; executive summary card with the counts and "No numerical savings assumed"; then **one diagram (≈62%)** and the **recommendation list (≈38%)**. The page is up to 1,360 px wide so the diagram has room.
- The diagram draws every recommendation still in play on the analysed workflow: added green, updated amber, removed red with dashed outline and struck-through label, changed connections coloured and badged. A recommendation that clashes with another is left out of the combined picture and shown on its own when selected. It never shows a side-by-side or an "optimized vs original" toggle.
- **Synchronized:** selecting a card focuses its steps and connections (and the steps they connect to); the rest dims and the view pans to them without zooming in. Clicking a highlighted step selects its card and scrolls to it. Steps can be selected with Enter.
- Ordering: highest impact first, then least effort (no scores shown). Category filter. Cards show a short proposal; Details expands problem, why, benefits, effort/impact, risks, assumptions and verification.
- Accept / Reject per card with explicit Pending / Accepted / Rejected labels. Rejected cards move to a collapsed "Rejected recommendations" section and can be reconsidered. Review choices are saved on the server.
- **Accept all** accepts everything still in play and opens the final preview.

### Final preview and Apply
- "Review & confirm" (or Apply reviewed changes) opens a combined preview of the **accepted recommendations only**, with conflict and dependency checks. Overlapping choices ("both change “Check order”. Accept only one of them."), missing dependencies and integrity problems are listed, and Confirm & apply stays disabled until resolved.
- Apply on the server re-checks owner, conflicts, dependencies and graph integrity, then saves in one transaction. It is refused if steps or connections changed since the analysis (moving steps is fine), and the screen says so.
- New steps are placed like manual edits; existing steps keep their positions. The editor adopts the result as **one undoable step** and returns to the Editor tab. The analysis records when it was applied, and its snapshot remains the original.

### Ask Flico
- Ask Flico now receives the current analysis (headline, summary, recommendation titles, categories and review states), as spec §9 requires.

### Implementation notes
- `shared/analysis.ts` holds the review rules (touched steps, conflicts, dependencies, combined plan, overlay, ordering, figure check) so the screen and the server agree exactly.
- The diagram drawing code is shared between the editor canvas and the review diagram (`client/src/editor/flowElements.ts`).

## Owner feedback after Milestone 4 (2026-10-31)

### Long step names (owner chose "Grow to fit")
- The approved two-line limit is replaced: blocks keep their width (184 px) and grow taller so the **whole name always shows**, in the editor, the analysis diagram and the final preview. `tokens.css` is unchanged; the override is in `app.css`.
- Layout knows each block's height (`nodeHeight` in `shared/layout.ts`, estimated from the name at about 14 characters per 18 px line, matching the rendered result). Auto-arrange and the placement of new steps line blocks up by their middles (arrows stay straight) and stack tall blocks without overlapping. Standard-size layouts don't move.
- Positions already saved aren't changed (no automatic tidying, per the Milestone 2 decision). After renaming a step to a long name, its block grows downward from where it is; Auto-arrange re-aligns everything.

### Full screen (owner chose "True full screen", and "Diagram + recommendations" on the Analysis tab)
- **Editor:** a **Full screen** button next to the zoom controls puts the page in browser full screen (like F11). Flico's top bar, the toolbar, zoom, menus, step details and Ask Flico all keep working. **Exit full screen** or Esc returns. Leaving the editor also leaves full screen.
- **Analysis tab:** a **Full screen** button beside "Proposed workflow changes" fills the screen with the diagram and the recommendation list side by side, so selecting, accepting and rejecting keep working.
- **Review accepted changes** (final preview): a **Full screen** button enlarges the combined preview to the whole screen before Confirm & apply.
- The whole page goes full screen (not just the canvas) so floating windows and dialogs stay visible. The existing four-corner button is still **Fit to screen** (zoom to show everything); the new button is labelled with text so the two aren't confused.

## Block details card (owner request after Milestone 4, 2026-11-01)

The owner asked for these editor changes on their own, without the rest of the Milestone 4.1 brief (automation assessment was not approved and is not built).

### Interactions (supersedes the Milestone 2 "click opens details" rule)
- **Single click** on a block selects it; the step toolbar acts on it. It no longer opens details.
- **Double-click** on a block, the toolbar's **Edit details** (its new first button) or **Enter** on a focused block opens the details card. The toolbar is **always visible** at the left of the canvas; its buttons are disabled when nothing is selected.

### Details card
- Same fields as before. Dragged by its header; the grip button also moves it with the arrow keys. Dragging is limited so the whole card stays inside the window below the app header. It never moves blocks, pans the canvas, changes the workflow or adds Undo steps. Fields, text selection and buttons never start a drag.
- The dragged position is kept **for the current editor session only** (not saved; resets on reload or when leaving the editor).
- Typing is committed to the workflow 600 ms after the last keystroke, and on close, block switch or Done. All edits made during one opening of the card form **one Undo step**; commits that change nothing are skipped.
- Card-local status: **Saving…** while a commit is pending or the server hasn't confirmed the card's current values; **Saved** only when the last value the server confirmed matches what the card shows (an older response can't mark newer edits saved); **Could not save — Retry** with "Your changes are kept here." on failure.
- **Done** saves pending edits and closes only after the server confirms; on failure the card stays open with the draft and Retry.
- Escape, click outside and switching blocks commit the draft to the block it belongs to (edits are keyed by step ID, never by "the open card"). If saving then fails, the header's existing Could not save — Retry stays visible and the workflow keeps the edit; nothing is discarded silently.

### Fix found while testing
- The editor and the analysis diagrams are both mounted at once and used the same arrowhead marker ids, so after switching tabs the editor's arrows could lose their heads. Each diagram now has its own id.

## Compact step card — option A (owner choice, 2026-11-01)

The owner found the card too tall, plain and form-like, showing too many fields and with scattered actions. Three directions were mocked up; the owner chose **A: compact + More details**.

- **Header**: tinted with the step type's own fill and stroke tokens (the same colours as the block), a type icon tile, the step name as an editable title, and "<Type> · <save status>" beneath. The save status (Saving… / Saved / Could not save — Retry with the explanation) lives here now. The card is dragged by this header.
- **Always shown**: Type and Owner / team, labels in normal sentence case beside the fields (no small uppercase labels).
- **More details** (duration, tools, notes) and **Connections** are folding sections with a one-line summary when closed ("Duration, tools, notes", or e.g. "2 days · ERP · Notes"; "→ Pack order"). More details opens by itself when the step already has any of them; Connections opens by itself when a Yes/No path is not set yet. Otherwise both start closed. *(Updated after owner feedback: More details now **always** starts closed.)*
- **Tools as tags**: Enter or a comma adds a tool (pasting "A, B" adds both), × removes one, Backspace in the empty box removes the last. A tool typed but not confirmed is saved with the rest, so nothing is lost on Done or close. At most 20 tools.
- **Footer**: Ask Flico, Delete (bin icon, labelled "Delete step"), then Done on the right.
- Width 340 px (was 320). The card re-positions whenever its height changes (opening a section), so it always stays fully inside the window; a dragged card keeps its place and moves up only as far as needed.
- Behaviour from the previous change is unchanged: double-click / Edit details / Enter to open, saving rules, Done, one Undo per opening, edits never land on the wrong block, the "Confirm step" banner for AI-inferred steps.

### Changing a decision's type (owner request, 2026-11-01)
- The owner asked why a decision's type couldn't be changed. The Milestone 2 rule kept decisions fixed because a decision owns a question and Yes/No paths. Owner choice: allow **Decision → Action / Approval / Wait** (and **Finish** when nothing follows it). Ordinary steps still can't become decisions in the card (that needs the guided Decision form), and Start and Exception steps keep their type.
- An ordinary step has one way on. If the decision has **both** paths set, the card asks **which path to keep** (Yes is preselected), names where each leads, and says what happens: the other connection is removed, the steps after it stay on the canvas (validation flags them as not connected) and Undo brings everything back. Cancel changes nothing. With one path or none, no question is needed.
- The kept path becomes a plain connection (no Yes/No label). Loop and exception connections from the decision are kept. The change is part of the card's single Undo step.

## Owner feedback on the step card and analysis diagram (2026-11-01)

- **Long names in the card header**: the name box wraps onto as many lines as the name needs (owner choice "wrap onto more lines"), so the full name is always visible, matching the blocks on the canvas. Enter still finishes the name and never adds a line break; pasted line breaks become spaces.
- **More details always starts closed** (owner choice), even when the step has details; the summary line shows what's inside. Connections still opens by itself when a decision has a Yes/No path to set.
- **Analysis diagram auto-arranged and fit to the whole workflow** (owner choice "Auto-arrange + fit all"): the review diagram and the final preview lay the shown workflow out with the same Auto-arrange as the editor, as a view only (the saved layout and positions are not changed). They open zoomed to show every step (minimum zoom lowered from 25% to 10%; the Milestone 4 "readable minimum zoom" is replaced), and refit when the arrangement changes (e.g. after rejecting a recommendation). Selecting a recommendation still pans to its steps without zooming in. It also refits whenever its area changes size (the hidden Analysis tab being shown, a window resize, full screen).

## Automation assessment (owner request, 2026-11-01)

### Owner decisions
- Build the automation assessment as listed by the owner; **"Refine assessment" is not built** (owner: not now).
- UI: mockups of three options were compared (automation section in the Analysis tab, badges on blocks, a Changes/Automation diagram switch). The owner chose **A: an Automation section in the Analysis tab**. Nothing is drawn on blocks, in the editor or the Analysis diagram.

### What an assessment is
- Produced by the same analysis call: no extra credit, no extra model request. Assessed: actions, decisions, approvals and exception handling. Not assessed: Start, Finish and Wait.
- Four classes (Full automation candidate / Human-assisted automation / Keep human-led / More information needed) plus a **Provisional** flag (not a fifth class). No numerical scores.
- Stored per step: class, provisional, reasoning, notes on six areas (inputs, rules and judgment, system access, exceptions, verification, risk and accountability), what could be automated, what stays human, evidence (each tagged You said / From the workflow / Assumption), prerequisites, open questions, and business value only where the person gave frequency/time/error figures (otherwise "Not assessed").
- Server checks (problems trigger the existing single correction retry; anything still invalid is dropped, never shown): the step exists and is a work step, no duplicates, reasoning and evidence present, More information needed has a question, candidate/assisted say what could be automated, assisted/human say what stays human, no invented figures (the Milestone 4 `unsupportedFigures` guard).
- Binding: stable step ID + analysis + analysed revision + a fingerprint of the step's type, name, owner/team, duration, tools and notes and of the connections and steps that feed it. Positions aren't part of it, so moving blocks never invalidates anything; other changes show **Needs reassessment** instead of presenting the old conclusion as current.
- Older analyses have no assessments (`NULL`) and say so; they're never shown as "nothing could be automated".
- Database: migration 5 adds `analyses.assessments_json` only. (A database that ran the withdrawn 4.1 branch also has an unused `workflow_chat_messages.refine_json` column; it is ignored.)

### Automation tab (option A)
- The side panel of the Analysis tab has **Recommendations | Automation** tabs; Recommendations stays the default. When an analysis has no recommendations but has assessments, only Automation is shown.
- Automation: four counts, a "recommendations only" note, then steps grouped by class under icon + label headings (lightning, handshake, person, question mark). A row shows the step's current name, a dashed **Provisional** chip and a dotted amber **Needs reassessment** chip when relevant. Opening a row shows the explanation in place, with "Reasoning by area" folded.
- Linked to the diagram: an open row highlights its step (others dimmed) and brings it into view; clicking a step in the diagram while on Automation opens its row. Change highlighting (added/updated/removed) is untouched.
- The executive summary lists "N steps assessed for automation" or "No automation assessment in this analysis".

### Labels on the diagram (owner request, 2026-11-02)
- Owner choices: labels on the **analysis diagram only, while the Automation tab is open**; **clicking a label opens its assessment**.
- Each assessed block gets a small neutral pill at its bottom-right: class icon + short name (Automation candidate / Human-assisted / Human-led / Needs info), the full class as its accessible name. Provisional = dashed border; needs reassessment = dotted amber with a refresh icon (the class name stays visible).
- Clicking a label opens that step's row and highlights the step; it never selects a recommendation. With Recommendations open, in the editor and in the final preview there are no labels, so the change colours stand alone.
- Labels scale with the diagram: with a long workflow fitted to the screen they are small; zoom in or use Full screen to read them.
