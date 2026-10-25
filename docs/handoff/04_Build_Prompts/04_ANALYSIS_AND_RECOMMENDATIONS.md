# PROMPT 04 — Quick/Guided analysis and visual change review

Continue from a tested milestone 3. Read product spec sections 10–12 and the design system analysis guidance. Use `02_Design/reference-screens/03-analysis-approved.png` **only as a visual reference**; do not reproduce illustrative figures/dates. **Do milestone 4 only.**

- Analyze header popover: **Quick** and **Guided** (up to three optional clarification questions). Both yield equally comprehensive assessments.
- Validate graph before analysis; nonblocking warnings remain warnings. Loading shows genuine stage descriptions in a centered overlay above the visible canvas, no invented percentages; safe cancellation where supported.
- Each **successfully persisted completed analysis** costs one of the user's initial **10 pilot analysis credits**; failed/canceled/duplicate requests do not charge; use idempotent transaction/ledger, server-side authorization and manual top-up scripts (no admin UI).
- Analysis returns evidence-aware executive summary, recommendations for inefficiency, simplification and automation potential, effort, risk, dependencies, assumptions and verification; category Quick Win / Strategic Improvement / Complex Change; smart ordering + filtering; explicit evidence labels. **No fabricated numeric savings or ROI**; show calculations only when real input supports them.
- Preserve Initial and Latest analysis only (one record if user has analyzed once), with dropdown. Editor/Analysis tabs retain state.
- Present **one** workflow diagram with on-canvas proposed changes: new green, changed amber, removed faded/dashed red with strikethrough, changed/old connections and Yes/No branch rerouting explicitly visible; show **no** side-by-side comparison and no fake `optimized vs original` toggle.
- Synchronized recommendation list ↔ graph: clicking either focuses the other. Short card plus expandable benefits/effort/risks/assumptions/verification, explicit Pending/Accepted/Rejected. Rejected suggestions go to collapsed section and can be revisited.
- Accept/reject individually and **Apply All**; detect dependencies/conflicts across overlapping node/edge patches; prevent invalid combined updates. A final **combined preview** shows accepted changes only before Confirm & Apply. Apply atomically, preserve original snapshot, make it undoable, return to editor.
- When no warranted improvements exist, say so without forced suggestions or invented scores. User can still see a valid unchanged assessment.

Test result graph invariants, select/reject/apply/undo, stale revision, two conflicting recommendations, all-rejected, no improvements, guided unanswered questions, no double-charge on API retries, expired/no credits, owner isolation, and no made-up ROI. Check genuine UI at 1280 and 1536 and its keyboard semantics.

Return concise summary, QA run, screenshots, known issues and Git checkpoint. **Stop before exports/pilot hardening.**
