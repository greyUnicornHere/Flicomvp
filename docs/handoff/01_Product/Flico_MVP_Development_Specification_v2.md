# Flico — Validation MVP Development Specification
**Version:** 2.0  
**Status:** Consolidated approved product and UX decisions  
**Date:** 24 October 2026  
**Tagline:** A better way to work.

> **Authority:** This specification supersedes v1 wherever decisions conflict. It describes intended behavior, not implemented functionality. No feature should be treated as delivered without testing.

## 1. Purpose and pilot
Flico helps nontechnical users describe or map a business process, understand friction, assess improvements and potential automation, and make informed decisions. It **does not execute workflows or implement automation**. Validate creation usability, analysis credibility, return usage, and willingness to pay for deeper feasibility studies.

- Invite-only pilot: approximately **10 users**, ideally five small-business owners and five department managers.
- Target a focused **two-week build** as an aspiration, not a promise.
- Collect in-app feedback and conduct **personal pilot interviews**, without an additional exit survey.
- Manually offer concierge premium feasibility studies when appropriate; no MVP payment flow.

## 2. Scope and supported platforms
**In scope:** desktop/laptop web application at **1280px width and above**, tested on current desktop **Chrome and Edge**; invite-only magic-link authentication; dashboard; manual and AI workflow creation; diagram editor; AI chat; validation; Quick/Guided analysis; interactive recommendation review and application; PDF and PNG exports; autosave; feedback; usage analytics.

**Out of scope:** mobile/tablet experience and mobile-specific editing; Firefox/Safari compatibility guarantees; dark mode; execution/integrations; collaboration; public sharing; folders; multi-template library; billing; full admin dashboard; version-history browser; recoverable trash; white-label exports; collapsible workflow groups; session recording; user-customized keyboard shortcuts; elaborate keyboard shortcut system. Standard browser/text editing behavior, accessible keyboard controls and the previously approved Undo/Redo shortcuts remain.

## 3. Visual language
- Use the **approved user-supplied Flico logo asset**: layered F symbol in teal-to-mint gradient, dark charcoal lowercase wordmark. Do not redraw from memory.
- Warm off-white surfaces; generous whitespace; strong readable typography; few borders; restrained teal-to-mint gradient on primary actions and important AI interactions only.
- Light theme only; structure tokens for possible later dark theme.
- Workflow canvas: very faint dot grid, **left-to-right** orientation, smooth curved connectors and clear arrowheads.
- Signature **soft organic/pebble-like block silhouettes**, subtly asymmetric, not exaggerated or animated. Compact consistent dimensions; icon and maximum two lines of step name; expose full name on hover, focus and selection.
- Muted colors by type: Action teal, Decision lavender, Approval amber, Wait blue, Start/Finish neutral. Exceptions use muted warning coloring and dashed connections. Shape, icons, labels and line styles must supplement color.
- Hover/selection: subtle teal outline, no wobble, scale, or morph animation. Visible keyboard focus.
- Friendly, lightly playful progress copy; professional report language. No gamification.

## 4. Dashboard and navigation
- Minimal **top navigation**, Flico logo left, account menu right; **no navigation sidebar**.
- Dashboard centered and spacious with two **equally prominent** cards: **Build manually** and **Create with AI**.
- Below: searchable recent workflows list; reopen, rename and delete. No folders.
- Optional **Customer Order Processing** example only; no mandatory onboarding/tutorial.
- Delete requires explicit irreversible-action confirmation. Remove workflow and related analyses, subject to a documented backup/export retention policy. No trash/recovery interface.

## 5. Editor shell
- **Full-screen canvas** with compact floating step toolbar; no permanent editing sidebar.
- Single top bar: Back, click-to-rename workflow title, subtle **Saving… / Saved** indicator, always-visible Undo/Redo, Editor/Analysis tabs when an analysis exists, Analyze, Export, Ask Flico. Handle failed saves visibly with Retry.
- Click workflow title to edit inline; Enter confirms.
- Bottom-right floating canvas controls: zoom in/out, fit-to-screen, auto-arrange. Support panning and mouse/trackpad zoom.
- Auto-arrange for large workflows; optional free positioning; **no collapsible sections**.
- Prominent inline **+** between steps and on connections; hover highlights edge and reveals +. Equivalent actions must be reachable by keyboard and without hover.
- On selecting a block, open a **contextual floating popover** near it, constrained to viewport. Fields: name, type, owner/team, duration, tool/software, notes. Close on outside click/Escape; accessible focus behavior.
- Undo/Redo buttons always visible, with **Ctrl/Cmd+Z** and **Ctrl/Cmd+Shift+Z**. No additional Flico-specific shortcut suite.
- Step deletion shows a confirmation identifying affected connections; action is undoable. Avoid silently changing branching semantics.
- Autosave manual edits and applied AI changes. AI and recommendation applications should form coherent undoable transactions. Preserve original snapshot.

## 6. Manual creation and graph editing
- **Build manually** starts an **Untitled workflow** containing a **Start block only**, with a + button. Finish is not pre-created.
- Optional dismissible suggestion to add a **Finish** block when process seems complete; user can insert Finish anytime.
- + opens a compact popover with manual types **Action, Decision, Approval, Wait, Finish**, plus a **Describe what happens next…** AI Quick Add input.
- Manually inserted blocks get a type-based default name (e.g. New Action) with inline name editing automatically focused.
- AI Quick Add infers step type and name and **inserts immediately**, with clear Undo. This is an explicit exception to the general AI edit preview requirement because user directly initiated Quick Add at an insertion point.
- **Decision:** guided popover asks for decision question, Yes outcome and No outcome; create labeled branches. Users can edit subsequently.
- **Decision reconnection:** Flico suggests a join where appropriate, but users accept/change it; branches may terminate separately.
- **Loops:** guided **Repeat earlier step** action; select target step; render smooth curved return arrow routed around nodes.
- **Parallel activities:** guided setup to describe each branch and whether all must complete before continuing. Render vertically stacked branches flowing left-to-right, with clear split and join.
- **Exceptions:** dedicated **Add exception** option to describe failure/exception and response; display labeled dashed paths and muted warning blocks.
- All graph operations must preserve stable node/edge IDs and valid references; avoid forced BPMN complexity.

## 7. Validation and repair
- Continuous unobtrusive validation while editing **plus** comprehensive pre-analysis validation.
- Detect disconnected steps, incomplete branches, dangling connections, problematic loops/exit conditions, missing decision labels and other structural ambiguities.
- Display subtle inline warnings **and** a compact header summary; selecting an issue focuses its location.
- Warnings do not block analysis unless they prevent a meaningful assessment.
- Offer **manual correction** or **Suggest Fix** via AI. AI fixes require on-canvas preview and explicit approval.

## 8. AI workflow creation
- User enters a natural-language description; Flico creates a named draft immediately, without mandatory preliminary questions.
- Present full diagram fitted to canvas; subtly mark AI-inferred steps and show a concise assumptions list. Users can correct/confirm assumptions; clear indicators when confirmed.
- Corrections available via manual editing or Ask Flico; AI-requested modifications require preview/approval.
- If generated graph invalid, perform **one safe automatic correction attempt**. If still unsuccessful, preserve valid partial work and offer **Retry** or **Continue Editing Manually**. Do not overwrite prior saved work.

## 9. Ask Flico
- Header **Ask Flico** button and contextual AI action on selected blocks.
- **Movable floating chat window**, compact by default, with Expand, Minimize and Close; keep it inside viewport. Not a fixed side panel.
- One persistent conversation per workflow, scrollable, with **Clear History**. Clearing chat does not delete graph or analyses.
- Context: current workflow graph/details, its chat, and **latest analysis/recommendations**; do not access other user workflows.
- Show a few predefined contextual suggested prompts; not dynamically generated prompt suggestions.
- Respond concisely by default; expand explanations on request. Ask clarifying questions when missing information materially affects answer; otherwise label assumptions.
- For AI-proposed edits: concise explanation in chat **and simultaneous highlighted canvas preview**; additions green, modifications amber, removals red/strikethrough, changed edges distinguished. **Apply / Cancel** required before modifying graph, except explicit Quick Add insertion.
- Validate structured model outputs against schema, permissions and graph integrity before preview or application.

## 10. Analysis initiation and progress
- Header **Analyze** opens a compact popover: **Quick Analysis** or **Guided Analysis**.
- Quick proceeds without preliminary questions; Guided asks up to **three optional** clarifying questions. Both provide **equally detailed** assessments; Guided may improve accuracy.
- On Analyze, show a lightweight **centered overlay** over the still-visible workflow canvas, with genuine stage labels and subtle animation. Do not invent progress percentages. Allow cancellation where technically safe.
- On completion, automatically transition to results without an extra confirmation screen.
- One successfully completed analysis costs **one analysis credit**; failed analyses do not consume credits. Pilot starts with **10 credits/user**, manual top-ups. Explicitly define costs of AI draft/chat/Quick Add separately; default not to consume analysis credits without approval.

## 11. Analysis quality and output
- Open results with **concise executive summary**.
- Evaluate inefficiencies, process simplification, automation potential, dependencies, implementation effort, risks and assumptions; generate improved graph with each completed analysis, including unchanged graph when no justified improvements exist.
- Prioritize recommendations using estimated impact and effort, with categories **Quick Wins**, **Strategic Improvements**, **Complex Changes**; smart ordering and category filters, without fabricated scores.
- Evidence labels: **Supported by your workflow**, **Based on assumptions**, **Requires verification**.
- Numerical savings/ROI only with sufficient user-provided data, clear calculations and assumptions. Otherwise qualitative impact. Do not guarantee unverified technical feasibility.
- Recommendation cards use progressive disclosure: short problem/proposal/reason first; expandable benefits, effort, risks, assumptions, verification steps.
- Preserve **Initial Analysis** and **Latest Analysis**; access via a compact dropdown, not a full history interface.

## 12. Single-diagram recommendation review
- **No side-by-side before/after comparison** in MVP. Use one workflow diagram with highlighted proposed changes: green additions, amber modifications, red removals, clearly differentiated connections. The original remains the reference until changes are applied.
- A synchronized recommendation list lets users select an item and focus its diagram change; clicking a highlighted block focuses its recommendation.
- Recommendations show explicit **Pending / Accepted / Rejected** labels and accessible visual indicators.
- Allow accept/reject individually **and Apply All**; check conflicts and dependencies.
- Rejected recommendations move into an expandable collapsed section and may be revisited without rerunning analysis.
- Before committing accepted changes, show **final combined preview** with **Confirm & Apply** or return to review. After confirmation, return to editor; original snapshot preserved and application undoable.
- **Editor / Analysis** tabs permit switching without losing review state. Applying suggestions changes only Flico's saved model, never real-world business systems.

## 13. Exports
- One **Export** menu: **PDF Report** or **Workflow PNG**.
- PDF: **Flico-branded executive-style** report with logo, title, date, restrained teal/mint accents, executive summary, diagram showing proposed improvements where relevant, prioritized recommendations and implementation considerations (including risks/assumptions). No custom or white-label branding.
- PNG: **high-resolution branded diagram** with workflow title and small Flico logo; exclude grid, editor chrome, controls, selection and hover indicators. Do not expose private content through public links.
- Exports must correctly handle loops, branches, long diagrams and page bounds; preserve labels and legibility.

## 14. Accessibility and usability
- **Target WCAG 2.2 AA** with verification, not an untested compliance claim.
- Strong contrast, visible focus, semantic labels, screen-reader accessible graph structure and validation messages, reduced-motion support.
- All core editor actions (add/edit/delete/connect/branch/review/apply) must be possible via keyboard alternatives to dragging/hover; retain standard browser and text editing behaviors.
- User explicitly declined a separate shortcut feature set; accessibility keyboard controls are still required.
- Desktop-first support at 1280px+; no mobile/tablet deliverable for this pilot.

## 15. Pilot operations, privacy and telemetry
- Invite-only, single-use expiring email magic links; strict per-user server-side access control.
- No admin UI: restricted scripts for invitations, credit changes and support.
- Feedback button throughout; after first successful analysis, show one dismissible **1–5 usefulness rating** and optional comment; do not repeatedly prompt.
- Detailed privacy-conscious events: creation path, time to first analysis, feature usage, export, errors, abandoned-workflow indicators, repeat visits. **No raw workflow text, step labels, or AI chat content in analytics.** Define abandonment operationally and disclose collection/retention.
- No session recordings. Personal interviews are primary qualitative feedback.
- Permanent delete requires confirmation; accurately disclose what happens to backups and user-exported copies. Avoid claiming immediate erasure of inaccessible backups without an actual deletion policy.

## 16. Suggested architecture
- **Frontend:** React, TypeScript, Tailwind, React Flow/XYFlow; typed domain graph independent of visual node rendering. Support organic custom nodes, edge overlays, accessible editing and deterministic auto-layout.
- **Backend:** Node.js API and SQLite for pilot; authenticated ownership checks, workflow/snapshot storage, chat, analysis versions, recommendations, feedback, credit ledger and privacy-safe event tracking.
- **AI:** provider-agnostic adapter, versioned structured schemas for generation, Quick Add, edit proposals, fixes, analysis and improved graphs; validate model outputs, bound size/cost, safe retry and idempotent credit charging.
- **Export:** deterministic high-resolution diagram capture/render and paginated PDF report with readable diagram and text.
- **Security:** secrets server-side, secure auth links, rate limits, safe rendering of model text, authorization for every object, minimal sensitive logging, deletion/retention policy.

## 17. Core acceptance tests
1. Invited users can authenticate; uninvited users and other accounts cannot access private workflows.
2. Dashboard shows two equal creation choices, sample and searchable recent workflows; permanent delete requires confirmation.
3. Manual creation begins with **Start only**; + popover supports manual types and AI Quick Add; Quick Add is immediately undoable.
4. Decision guided setup creates Yes/No branches; smart joins, guided loops, parallel branches and exceptions render accurately left-to-right.
5. Organic compact nodes, curved connectors, faint dot grid, muted type colors, contextual details popover, and responsive canvas controls render at 1280px+ in Chrome/Edge.
6. Save indicator, autosave, rename, undo/redo, delete confirmation and refresh preserve correct graph state.
7. Validation inline and summary both locate issues; AI fix requires preview/approval.
8. AI creation marks assumptions; invalid AI output retries safely once; failure preserves valid work.
9. Ask Flico is movable/expandable, persists per-workflow chat, uses latest analysis, and previews edits before apply.
10. Quick/Guided analyses are equally detailed; Guided questions optional; failures do not charge; successes charge once.
11. Results show executive summary and **one highlighted-change diagram**, synchronized with recommendation list; individual review, Apply All, collapsed rejects, and final combined preview work.
12. Initial/Latest dropdown, Editor/Analysis tabs, original snapshot preservation and undo of applied recommendations work.
13. Branded executive PDF and branded high-res PNG export with no editor chrome; diagram remains legible.
14. Keyboard-only users can complete core editing and review; focus, reduced motion and screen-reader semantics are tested.
15. Telemetry excludes sensitive workflow/chat content; first-analysis feedback prompts only once.

## 18. Build order
1. Foundations: auth, typed graph, persistence, brand tokens, dashboard, desktop shell.
2. Manual editor: custom organic nodes, step popovers, branches/loops/parallel/exception guides, canvas controls, autosave/undo, validation.
3. AI: provider adapter, natural-language creation, assumptions, Quick Add, Ask Flico floating window, validated preview and approval.
4. Analysis: Quick/Guided, genuine loading stages, summary, one-diagram diff, synchronized recommendations, selection/conflict checking, final preview/apply, credits.
5. Exports, telemetry, feedback, accessibility/security hardening, cross-browser tests, pilot interviews and deployment.

Use small Claude Code feature prompts, test each vertical slice manually, and commit Git checkpoints. Keep trust and correctness safeguards if schedule slips; cut optional polish instead.

## 19. Implementation clarifications (not new product decisions)
- Define exact node/edge schemas for parallel joins, exception outcomes and loop termination so graph validation is deterministic.
- Clarify how decision guided setup treats blank Yes/No outcomes and how branch content is represented before real steps are added.
- Ensure confirmation on deleting a connected step accurately previews edge consequences, especially across branches.
- Resolve interaction precedence between inline Quick Add (immediate insertion) and all other AI edit proposals (approval required).
- Define deletion handling for backups and already-downloaded exports; establish data retention rules.
- Specify graph size, export resolution, API cost limits, and rate limits before implementation.
- Confirm whether only latest and initial analysis persist when there has been exactly one run (do not duplicate records).

**Decision precedence:** Latest explicit user choices override older briefs: desktop-only; Chrome/Edge; 1280px+; organic nodes; floating Ask Flico; single highlighted results diagram; Start-only manual creation; guided decisions, loops, parallel and exceptions; no extended shortcut system.
