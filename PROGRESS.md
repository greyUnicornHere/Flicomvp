# Progress

## Plan (milestones 0–6)

| # | Milestone | Status |
|---|---|---|
| 0 | **Foundation:** scripts, SQLite + migrations, invite-only magic-link auth, sessions, tokens + logo, error boundary, health/status | **Approved by owner 2026-10-26; merged to `main`.** |
| 1 | Dashboard: welcome, two creation paths, real workflow persistence, search, rename/delete | **Approved by owner 2026-10-26; merged to `main`.** |
| 2 | Manual editor: organic graph editor, branches/loops/parallel/exceptions, validation, autosave, undo/redo | **Approved by owner 2026-10-28; merged to `main`.** |
| 3 | AI: provider adapter, AI create/Quick Add, floating Ask Flico, validated previews | **Approved by owner 2026-10-28; merged to `main`.** |
| 4 | Analysis: credits, Quick/Guided, one-diagram change review, recommendations and application | **Approved by owner 2026-10-31; merged to `main`.** |
| 5 | Pilot-ready: export, privacy-aware telemetry, feedback, audits, accessibility, deployment | Not started |
| 6 | Pilot fixes only | Not started |

Each milestone gets its own branch, tests, screenshots, manual checks, a Git checkpoint, and an explicit stop for approval.

## Milestone 0: what works

- `npm run setup`, `npm run dev`, `npm run invite`, `npm run db:migrate`, `npm test`, `npm run test:e2e`, `npm run lint`, `npm run typecheck`, `npm run build`, `npm start`, `npm run check`.
- SQLite database with versioned migrations (`invitations`, `users`, `magic_link_tokens`, `sessions`, minimal `workflows`), foreign keys enforced.
- Invite-only sign-in: request link → email (dev outbox locally) → "Continue to Flico" → signed in. Links are single-use and expire after 15 minutes. Uninvited addresses get the same response and no email.
- Session cookie handling, `/api/auth/me`, sign-out from the account menu, server-side session deletion.
- Server-side authorization: unauthenticated requests get 401; another user's workflow gets 404 with no data leaked.
- Development-only outbox at `/dev/outbox`. It is absent in production (API not registered, page not bundled, config refuses it).
- Public status page `/status` backed by `GET /api/health` (API, database, email mode, environment, version).
- Approved tokens loaded unchanged; the approved logo raster is used unchanged; Inter is self-hosted.
- Root error boundary and router error page with recovery actions; clear messages for API-unreachable, rate-limited, expired/used links, and misconfiguration.
- Desktop-scope notice below 1280px (dismissible, non-blocking).

## Milestone 1: what works

- Dashboard at `/`: logo + account menu (email, Feedback *coming soon*, Sign Out), hero, two equal creation cards, "Recent workflows" with live search and a Name / Status / Last modified / Actions table.
- Empty state replaces the table when there are no workflows (never shown beneath it).
- **Build manually** creates and opens `Untitled workflow` (Start step only), saved in the database.
- Row click (or keyboard on the name link) opens the workflow page (title + placeholder until the editor).
- Rename (dialog, validation) and permanent delete (confirmation, Cancel by default) from each row's ⋯ menu; both persist after reload.
- **Create with AI** input screen, clearly marked not yet available; nothing is sent or saved.
- Owner-scoped workflow API (list/create/read/rename/delete) and the autosave contract (`PUT /:id/graph` with revision conflict protection) ready for the editor.

## Milestone 2: what works

- Full-screen left-to-right editor at `/workflows/:id` (replaces the placeholder): compact header (back, click-to-rename title, Saving/Saved/Retry, Undo/Redo, issue summary, Ask Flico, Analyze, Export), warm dotted canvas, organic step blocks with icons and two-line names, curved labelled connections, no sidebar or inspector.
- Floating step toolbar, bottom-right zoom/percentage/fit/auto-arrange, mouse and trackpad pan/zoom.
- + after a step, on any connection (hover or keyboard focus) and on open Yes/No paths, with a menu of Action, Decision, Approval, Wait and Finish; AI Quick Add is shown disabled until Milestone 3. New steps open with their name ready to type.
- Guided Decision (question, optional outcomes, join suggestion), Connect to a step (join suggestions), Repeat earlier step (loop), Parallel activities (with wait-for-all join), Add exception (dashed path + response).
- Step details popover (name, type, owner/team, duration, tools, notes, connections, delete); changes persist.
- Delete confirmation listing affected connections, optional reconnection, undoable.
- Undo/Redo (buttons + Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z), autosave with revision safety, durable save errors with Retry, conflict detection; refresh keeps names, topology and positions.
- Continuous validation (step markers + header summary that focuses the step), pre-analysis check in the Analyze menu; Finish suggestion.
- Keyboard-operable throughout, accurate screen-reader labels, reduced-motion support, 1280px layout.

## Milestone 3: what works

- **AI adapter** with a live Anthropic Claude provider (Claude Haiku 5.5 `claude-haiku-5-5`, structured output) and a labelled test fixture for development and tests. Without a key, every AI feature says it isn't set up and sends nothing.
- **Create with AI**: describe a process and get a named, laid-out draft immediately. Inferred steps are tagged and can be confirmed; assumptions can be confirmed, edited or removed. Invalid output gets one correction; if still invalid, the valid part is kept with Retry / Continue editing manually; a failure never creates anything or loses the description.
- **AI Quick Add** in the + menu: type what happens next, press Enter; the step is inserted at once (marked Inferred) with Undo.
- **Ask Flico**: movable floating window (compact, expand, minimize, close; always on screen; arrow-key moving), one saved conversation per workflow, Clear History, fixed contextual prompts, "Ask Flico about this step".
- **AI edits and Suggest Fix**: explanation in chat plus a simultaneous canvas overlay (green added, amber updated, red struck-through removed, changed connections marked); Apply is checked on the server against the revision, all-or-nothing, and is one undoable step; Cancel changes nothing.
- Daily AI limits per person (no analysis credits), rate limit, timeouts, input and output size limits; no workflow text or chat in logs.

## Milestone 4: what works

- **Analyze → Quick or Guided** (up to three optional, AI-picked questions; skipping still gives a full analysis). The menu shows the workflow check and "N of 10 analyses left".
- Centered progress overlay with the real stages and Cancel. The Analysis tab opens automatically when the assessment is saved.
- **Credits:** 10 to start; one used per saved analysis; failed, cancelled and duplicate requests are free; `npm run credits` for top-ups.
- **Results:** headline, executive summary, evidence labels, "No numerical savings assumed", one diagram with added/updated/removed changes and route changes, and the synchronized recommendation list (filter, details, Pending/Accepted/Rejected, collapsed rejected section, Accept all).
- **Final preview** of accepted changes only, with conflict and dependency checks, then **Confirm & apply**: one server-checked save, one Undo, original snapshot kept.
- Initial and Latest analysis with a dropdown (no duplicate when there's one). An honest "no improvements" result. No invented numbers. Ask Flico knows the latest analysis.

## Owner feedback after Milestone 4 (approved by owner 2026-11-01; merged to `main`)

- Long step names show in full: blocks grow taller instead of cutting the name off with "…".
- Full screen for the editor, for the analysis review (diagram + recommendations) and for the final preview.

## Block details card (owner request after Milestone 4; approved by owner 2026-11-01; merged to `main`)

- Single click on a block only selects it. **Double-click**, **Edit details** (first button of the always-visible step toolbar) or Enter opens the details card.
- The card can be dragged by its header, or moved with the arrow keys from its grip. It stays fully on screen and keeps its place until you reload or leave the editor.
- The card shows its own **Saving… / Saved / Could not save — Retry**. Saved appears only once the server has stored the change; on failure your typing is kept.
- **Done** saves and closes; if saving fails the card stays open with your typing.
- Quick edits, switching blocks during a slow save, or closing the card never put an edit on the wrong block. Everything changed in one opening of the card is one Undo.

## Compact step card, option A (owner request; approved by owner 2026-11-01; merged to `main`)

- The card's header shows the step's type icon and colour, its name (type straight into it) and "Action · Saved". Saving, Saved and Could not save — Retry appear there.
- **Type** and **Owner / team** are always shown. **More details** (duration, tools, notes) and **Connections** fold away, each showing a one-line summary. They open by themselves when the step already has details, or when a Yes/No path still needs setting.
- **Tools** are tags: type a name and press Enter (or a comma) to add; × or Backspace removes. A name typed but not yet confirmed is still saved.
- One footer row: **Ask Flico**, **Delete** (bin icon) and **Done**.
- The card moves to stay fully on screen when a section opens or closes.
- A **decision can now change type** to Action, Approval or Wait (or Finish when nothing follows it). If both its Yes and No paths are set, the card asks which one to keep; the other connection is removed and Undo restores it.

## Known issues / limitations

- **Logo background:** the supplied raster's off-white background shows as a faint box on the white header. Owner chose to keep it as-is until they supply a transparent logo (see DECISIONS.md). No favicon yet, for the same reason.
- Real SMTP delivery is implemented but **not yet tested** against a live provider.
- E2E has run in Chromium only. Edge needs a machine with Edge installed.
- Feedback in the account menu is disabled ("Coming soon") until Milestone 5.
- Export is visibly disabled until Milestone 5.
- **Live analysis not yet demonstrated:** like Milestone 3, analyses in tests and screenshots come from the labelled test fixture. Analysis quality with Claude Haiku 5.5 needs a live check once a key is available.
- Long workflows are drawn small in the review diagram (it shares the width with the list). It opens at a readable zoom; use pan, zoom or fit-to-screen to see the rest.
- An analysis can't be applied after steps or connections changed (moving steps is fine); run a new analysis.
- Applying is once per analysis. To apply more of it later, run a new analysis.
- **Live AI not yet demonstrated:** no `ANTHROPIC_API_KEY` in this environment yet. All AI features are tested end to end with the test fixture, and the Claude adapter's request format and error handling are unit-tested against a stubbed API. The first live run happens once the key is added (see TEST_NOTES.md).
- The test fixture follows a simple fixed pattern (one step per sentence, approval/removal/fix suggestions on keywords). It exists to test the app, not to judge AI quality.
- A suggestion made before later edits can't be applied ("the workflow changed"); ask again. Moving a step while Flico is answering also counts as a change.
- The Ask Flico window can cover part of the diagram; it can be moved, minimized or closed. Changes it previews are kept clear of it when possible.
- Adding steps never re-arranges the diagram (owner feedback); only Auto-arrange does. Inserted steps make room by sliding the later steps on that path to the right.
- Undo history lasts for the browser session only.
- A step renamed to a long name grows downward where it stands (nothing is re-arranged automatically); Auto-arrange lines everything up again.
- Arrows bend around a step that sits in their way. With very crowded hand-made layouts a detour can still touch a step; Auto-arrange tidies it.
- No Customer Order Processing example (owner decision for now).
- Search filters loaded workflows in the browser (fine for the 200-workflow limit).
- The details card's dragged position resets on reload or when you leave the editor (by design). Dragged to the far left it can cover the step toolbar; drag it back or close it.

## Evidence

See `TEST_NOTES.md` and screenshots in `docs/evidence/m0/`, `docs/evidence/m1/`, `docs/evidence/m2/`, `docs/evidence/m3/`, `docs/evidence/m4/`, `docs/evidence/feedback-m4/` and `docs/evidence/details-card/` and `docs/evidence/step-card/`.
