# PROMPT 01 — Dashboard, persistence and invitation UX

Continue in the existing Flico repository. First read `PROGRESS.md`, `DECISIONS.md`, the product spec sections 1–5 and 15, and the design system dashboard rules. Do not overwrite working code or skip tests.

Implement **milestone 1 only**:

- Desktop dashboard at 1280px+: minimalist static top bar with **approved original Flico logo left** and account menu right (email, Feedback, Sign Out); **no sidebar**.
- Hero: **“A better way to work.”** plus the approved supporting sentence. No illustration or personalized greeting.
- Two **equally prominent**, centered interactive cards: **Build manually** and **Create with AI**, subtle non-moving hover state.
- Centered max-width ~1200px; recent workflows compact searchable table with `Name / Status / Last modified / Actions`, rename and irreversible delete with accurate confirmation. Clicking a row opens it.
- If the user has **zero workflows**, replace table with simple empty state and optional **Customer Order Processing** sample link. The empty state must never appear beneath a populated table.
- Basic owner-scoped workflow persistence with creation, rename, list, open, delete. **Build manually** creates `Untitled workflow` containing one Start node only. For AI creation, implement a clearly labeled input screen route and safe empty state; actual model generation comes in a later milestone.
- Autosave hooks/storage contract should be ready but do not build the full editor in this milestone. No folders, extra samples or import action.
- Sample workflow should be explicitly identified as an example, and not appear as a fictitious user's real workflow.

Run lint/typecheck/tests/build. Include tests for sorting/search, dashboard empty state, user separation, irreversible deletion, and account menu functionality. Check in desktop Chrome at 1280 and 1536 widths. Take a screenshot of the running dashboard and compare against `02_Design/reference-screens/01-dashboard-approved.png`; the **behavioral spec wins** over the screenshot's illustrative content.

Summarize completed behavior, test results, local URL, a short manual verification list, Git checkpoint and remaining issues. **Stop**; do not implement milestone 2.
