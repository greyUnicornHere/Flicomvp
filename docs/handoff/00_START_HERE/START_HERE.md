# Start here — Flico with Claude Code

## What you need

- Windows desktop/laptop; current **Chrome or Edge**.
- Claude Code installed and authenticated, plus a working Node.js LTS environment and Git.
- API access for a chosen LLM provider and an email delivery service when configuring real magic-link emails. Keep credentials server-side and never commit them.

Claude Code can guide installation/configuration. No need to manually read or write application code to follow this process.

## First session

1. Extract the ZIP into a new folder, e.g. `Flico`.
2. Open that folder as the working directory in Claude Code. Its contents are **handoff documentation, not source code yet**.
3. Paste **all of** `04_Build_Prompts/00_PROJECT_BOOTSTRAP.md` into Claude Code. Ask Claude Code to read the referenced files before writing code.
4. Review Claude Code's short plan; allow it to implement **milestone 0 only**. Ask it to launch the local development server and state the URL so you can verify in Chrome.
5. After testing, paste the next milestone prompt. Do not batch milestones merely because the first one worked.

## Workflow and review discipline

- Maintain `PROGRESS.md` (what works, known issues, test evidence), `DECISIONS.md` (implementation assumptions) and `TEST_NOTES.md` in the app repository.
- Prefer feature-complete **vertical slices** over a polished shell with fake buttons.
- For each milestone demand: a running screen, useful interactions, error/empty/loading states, tests, and a short list of user actions to verify.
- Claude Code may manage Git commits, but **verify a clean working tree and a named checkpoint** before moving on.
- If tests fail, fix within the current milestone. Do not advance or hide failures with stubs that appear functional.
- If schedules slip, cut optional visual refinements before core data integrity, privacy, AI transparency, or the user-approved interactions.

## Credentials and services

- Real sign-in: allowlisted invitation + short-lived one-time magic link, sent via configurable email adapter.
- Local development: a **development-only** mail outbox can display test links without an external email service; must be disabled in production.
- AI adapter: choose a provider via environment variables; validate all returned schemas. If no API key, show a clearly labeled development fixture or controlled error, **never pretend a real model ran**.
- Do not log workflow labels, text descriptions, AI chat messages, tokens, or private attachments to telemetry.

## Scope reminders

No mobile, no live workflow execution, no automation integrations, no public workflow links, no billing, no admin dashboard, no templates library, no custom branding, no session recordings, no fake AI certainty. One optional Customer Order Processing example only.

## Reference files

- **Product:** `01_Product/Flico_MVP_Development_Specification_v2.md`
- **Design:** `02_Design/FLICO_DESIGN_SYSTEM.md`, `02_Design/tokens.css`, and the three PNG files in `02_Design/reference-screens/`.
- **Architecture:** `03_Architecture/IMPLEMENTATION_CONTRACTS.md`.
- **Acceptance:** `05_QA/ACCEPTANCE_AND_TEST_CASES.md`.

**Use the actual logo raster** from `02_Design/assets/flico-approved-logo-original.jpeg` as the reference. Its background is embedded in the raster. Obtain a proper transparent production asset later; don't reconstruct the approved logo from imagination.
