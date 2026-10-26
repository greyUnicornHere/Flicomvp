# Progress

## Plan (milestones 0–6)

| # | Milestone | Status |
|---|---|---|
| 0 | **Foundation:** scripts, SQLite + migrations, invite-only magic-link auth, sessions, tokens + logo, error boundary, health/status | **Approved by owner 2026-10-26; merged to `main`.** |
| 1 | Dashboard: welcome, two creation paths, real workflow persistence, search, rename/delete | **Approved by owner 2026-10-26; merged to `main`.** |
| 2 | Manual editor: organic graph editor, branches/loops/parallel/exceptions, validation, autosave, undo/redo | **Built. Awaiting owner approval.** |
| 3 | AI: provider adapter, AI create/Quick Add, floating Ask Flico, validated previews | Not started |
| 4 | Analysis: credits, Quick/Guided, one-diagram change review, recommendations and application | Not started |
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

## Known issues / limitations

- **Logo background:** the supplied raster's off-white background shows as a faint box on the white header. Owner chose to keep it as-is until they supply a transparent logo (see DECISIONS.md). No favicon yet, for the same reason.
- Real SMTP delivery is implemented but **not yet tested** against a live provider.
- E2E has run in Chromium only. Edge needs a machine with Edge installed.
- Feedback in the account menu is disabled ("Coming soon") until Milestone 5.
- Status is always Draft until analysis exists (Milestone 4).
- Ask Flico, Export, AI Quick Add, Suggest Fix and analysis are visibly disabled until their milestones.
- Structural changes re-arrange the diagram; manual drag positions are kept until the next structural change or Auto-arrange.
- Undo history lasts for the browser session only.
- Long forward connections that skip several columns use simple curves and can pass close to steps in between (repeat connections are fully routed around steps).
- No Customer Order Processing example (owner decision for now).
- Search filters loaded workflows in the browser (fine for the 200-workflow limit).

## Evidence

See `TEST_NOTES.md` and screenshots in `docs/evidence/m0/`, `docs/evidence/m1/` and `docs/evidence/m2/`.
