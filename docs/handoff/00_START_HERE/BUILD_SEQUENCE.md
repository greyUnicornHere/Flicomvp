# Build sequence and check-in gates

Use one milestone prompt per Claude Code session/checkpoint. The sequence is dependency-based; no time estimate is a commitment.

| Milestone | Work | User-visible proof before moving on |
|---|---|---|
| 0 — Foundation | Project scripts, SQLite, auth, environment, core tokens | Secure sign-in and local working app |
| 1 — Dashboard | Welcome, two creation paths, real workflow persistence, search | Dashboard screenshot and create/rename/delete behavior |
| 2 — Editor | Organic graph editor, manual actions, branches/loops/parallel/exceptions, validation | Real sample workflow built and survives reload |
| 3 — AI | Model adapter, AI create/Quick Add, floating Ask Flico, safe patches | Describe → build → ask AI → preview → Apply/Cancel |
| 4 — Analysis | Credits, Quick/Guided, one-diagram change review, recommendations and application | A credible workflow assessment with reversible approved improvements |
| 5 — Pilot-ready | Export, privacy-aware telemetry, feedback, audits, accessibility, deployment | Complete acceptance checklist with no critical failures |
| 6 — Pilot fixes | Address only observed pilot defects and trust problems | Regression tests and sign-off on changed behaviors |

## Stop conditions

Do not advance if a current-milestone core action is broken. Do not mark AI ready with deterministic fixture text disguised as a live model. Do not mark analysis ready if it fabricates precise ROI. Do not mark export ready if branching graphs are clipped. Do not declare production safe if another user can access private data. Keep simple `Known issues` lists separate from confirmed passing functionality.

## Working with Claude Code

At each handoff it should report **(a)** user-visible progress, **(b)** tests and screenshots, **(c)** manual checks, **(d)** a Git checkpoint and **(e)** remaining limitations. If an AI coding session loses context, ask it to read `PROGRESS.md`, `DECISIONS.md`, spec v2 and the current milestone prompt, rather than restarting or re-inventing decisions.
