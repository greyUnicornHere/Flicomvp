# PROMPT 00 — Initialize Flico and build the foundation

You are my senior full-stack engineering collaborator. **Build Flico**, an invite-only, desktop-only SaaS tool for **mapping, understanding and assessing business workflows**. It does **not** execute workflows. I am the product owner; I primarily verify features by using the running application, not by reviewing source code.

Read these files in full, in order, before implementing:

1. `01_Product/Flico_MVP_Development_Specification_v2.md`
2. `02_Design/FLICO_DESIGN_SYSTEM.md`
3. `03_Architecture/IMPLEMENTATION_CONTRACTS.md`
4. `05_QA/ACCEPTANCE_AND_TEST_CASES.md`
5. Inspect approved images in `02_Design/reference-screens/`, and use `02_Design/tokens.css`, `tokens.json`, and the actual approved logo reference in `02_Design/assets/`.

**Instructions**

- Write a short implementation plan with milestones 0–6. Do not code later milestones in advance.
- Initialize a clean maintainable TypeScript project using React, Tailwind, XYFlow/React Flow, a Node API and SQLite with migrations. You may choose reliable compatible tooling; record choices and rationale in `DECISIONS.md`.
- Create `PROGRESS.md` and `TEST_NOTES.md`. Establish scripts for dev, test, typecheck, lint, build and migrations.
- Implement **milestone 0 only**: working frontend/backend, database migrations, minimal authenticated app foundation, approved design tokens and logo asset placement, basic error boundary, session handling, and a visible health/status route.
- Implement development-safe invitation and magic-link sign-in flow with a **development-only local email outbox** if a real SMTP/API provider isn't configured. Production mode must not expose outbox links or permit bypass auth. No open sign-up. Secrets only in `.env`, ignored by Git, with `.env.example`.
- Include unit/API tests proving unauthenticated requests and cross-user access are denied; do not claim security is done solely because the UI hides routes.
- Make it easy to open a local app in Chrome/Edge and verify login and logout. Use clear errors on misconfiguration.
- Do not implement generic workflow execution, integrations, sidebar navigation, sample fake analyses, billing, mobile-specific views or unrelated features.
- Do not use an invented/generated substitute logo. The supplied raster is a reference with a baked-in background; use it on matching light surfaces and record the need for a transparent production asset.

**When finished, return only:**
1. What you built and which tests passed/failed.
2. Exact commands to run it and the local URL.
3. A 3–5-step manual test I can perform.
4. Any decisions/limitations recorded in `DECISIONS.md`.
5. Git checkpoint identifier.

**Stop after milestone 0.** Do not silently begin milestone 1.
