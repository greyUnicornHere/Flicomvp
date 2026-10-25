# PROMPT 05 — Exports, pilot operations and release hardening

Continue tested milestone 4. Read the product spec sections 13–17, design system and `05_QA/ACCEPTANCE_AND_TEST_CASES.md`. **Do milestone 5 only.**

- Single Export menu offers **PDF Report** and **Workflow PNG**.
- Export high-resolution **branded** PNG using real Flico logo reference, workflow title, readable diagram and clean canvas with **no** dot grid, toolbar, focus/hover/selection, or editor chrome. Fit long branches and loops properly.
- Export professional, **Flico-branded executive PDF** containing report title/date, executive summary, improved-change diagram, priority-ordered findings, evidence, assumptions, risks and implementation considerations. Do not output made-up percentages/costs; handle pagination and wide diagrams.
- Implement privacy-conscious event telemetry: creation method, time-to-first-analysis, feature interactions, analysis events, export, errors, repeat visits and defined abandonment heuristic. Never store raw workflow descriptions, node labels, prompts or chats in event payloads. Disclose purpose and retention.
- Feedback always accessible; after **first successful** analysis only, offer a one-time dismissible 1–5 rating and optional comment. No extra exit survey UI. Personal pilot interviews are separate real-world work, not an app feature.
- Restricted owner-operated scripts for invites, account credit top-ups, and support. No admin dashboard. Environment variable validation, safe logging, rate limiting, backups/retention notes and documented deletion behavior.
- Test full Chrome and Edge desktop experience, login, multi-user authorization, keyboard-only core tasks, focus order, reduced motion, accessible controls, 1280px layout (including zoom behavior where practical), production build and deployment configuration.

Provide an explicit **pilot launch gate** with pass/fail evidence for critical safety, data integrity and export criteria. Do not declare deploy-ready if auth, ownership, analysis credit handling, data loss protection, or model patch validation fails. Include known limitations and required real service credentials.

Return tested functionality, manual verification steps, key failures, deployment instructions, and Git checkpoint. **Stop and request my pilot approval rather than enabling invitations to real people yourself.**
