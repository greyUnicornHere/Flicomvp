# PROMPT 06 — Fix pilot findings without feature creep

The Flico validation MVP is ready for a controlled invite-only pilot. Read `PROGRESS.md`, open issues, `TEST_NOTES.md`, the v2 product specification and the QA gate.

Implement **only** the user-reported defect(s) and high-severity pilot findings I give you. Prioritize: data loss/security, broken analysis recommendations, AI hallucination/invalid patches, accessibility, confusion in the core journey, then cosmetic polish. Do not add new features simply because they are technically attractive.

For each issue:
1. Reproduce and state expected vs actual behavior.
2. Identify minimal root cause and smallest safe patch.
3. Add or update a regression test.
4. Run relevant test suite, lint, typecheck and build.
5. Give me concrete browser steps to verify and record a Git checkpoint.

Do not start a new milestone or add mobile, templates, execution/integrations, billing, collaboration, complex shortcut suite or unrelated product capabilities.
