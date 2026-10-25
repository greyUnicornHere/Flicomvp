# Suggested engineering contracts — Flico Validation MVP

**Status: implementation recommendations, not new product decisions.** Keep boundaries narrow and let the approved v2 product spec override any proposal here.

## 1. Suggested stack

- Web: React + TypeScript + Tailwind CSS, with `@xyflow/react` (React Flow) as a canvas rendering and interaction layer.
- Node.js TypeScript backend exposing a validated authenticated JSON API; use a maintained web framework (e.g. Fastify or Express) and standard schema validation (e.g. Zod).
- SQLite with migrations for invite-only pilot. Store all private workflows and analyses with server-side user ownership checks.
- Server-side AI adapter with independent functions for `generateWorkflow`, `quickAdd`, `proposeEdit`, `suggestFix`, `analyzeWorkflow`, `answerAssistant`.
- Layout: deterministic left-to-right DAG layout for normal branches, with custom routing of back-edges for loops; use suitable maintained layout library or constrained custom algorithm.
- Test: unit and API integration tests; Playwright in Chrome/Edge (or Chromium/Edge channels) for real interactions and screenshot comparison.
- Exports: use a deterministic render for printable graph and a report generator that paginates long content.

**Avoid pinning unverified package versions in handoff**; Claude Code should use stable mutually compatible versions available at implementation time.

## 2. Domain model (conceptual TypeScript contract)

```ts
type StepType = 'start'|'action'|'decision'|'approval'|'wait'|'finish'|'exception';
type EdgeType = 'normal'|'yes'|'no'|'parallel'|'exception'|'loop';

type Workflow = {
  id: string; ownerId: string; name: string; description?: string;
  revision: number; createdAt: string; updatedAt: string;
  nodes: WorkflowNode[]; edges: WorkflowEdge[];
  initialSnapshotId?: string;
};

type WorkflowNode = {
  id: string; type: StepType; label: string;
  owner?: string; team?: string; duration?: { value: number; unit: string };
  tools?: string[]; notes?: string;
  position: { x: number; y: number };
  origin?: 'user'|'ai-inferred'; assumptionStatus?: 'unconfirmed'|'confirmed';
  structure?: { branchGroupId?: string; joinGroupId?: string; exitCondition?: string };
};

type WorkflowEdge = {
  id: string; sourceId: string; targetId: string; type: EdgeType;
  label?: string; branchGroupId?: string;
};
```

This is an example contract: normalize/extend where required. **Critical:** workflow nodes are *descriptive steps*, not executable triggers or integration actions. Avoid introducing a separate AI execution step type based on generic automation UI examples.

- Stable immutable IDs for saved nodes/edges; validation must reject duplicate IDs, dangling endpoints, malformed branches, and unsafe patches.
- One Start on a new manual workflow; Finish may be absent while editing. Multiple final outcomes are valid where the process branches. Do not invent mandatory single Finish.
- Store branch-group semantics explicitly for decision and parallel forks/joins so saving/loading and analysis diffs remain deterministic. Keep loop edges explicitly typed; do not silently flatten loops into a DAG.
- Record inferred steps and **assumptions** separately so users can review and confirm them.
- Layout data is separate from process semantics. Re-arranging positions must not change the meaning of branch/loop/exception connections.

## 3. Proposal/analysis contracts

An AI proposal must reference existing IDs and express a finite list of schema-validated operations, e.g. `addNode`, `updateNode`, `removeNode`, `addEdge`, `removeEdge`, `updateEdge`. Include human-facing rationale, labels for evidence/assumptions, and expected base `revision`.

- Generate a **read-only overlay graph** from the proposal on the canvas, with labels for added/modified/removed and changed edges. **Do not mutate the saved graph on preview.**
- On Apply, verify owner, expected revision, operations, branch integrity and **all-or-nothing** transaction. Commit as one undoable editor action. On Cancel, discard preview only.
- **Exception:** user-initiated Quick Add at an explicit + insertion point inserts immediately and is instantly undoable, per approved decision.
- An analysis record contains: workflow ID + exact revision/snapshot, evidence-qualified summary, prioritized recommendations, graph operations per recommendation, risks/assumptions/verification steps, and improved-graph candidate. Derive the selected final combined preview from **accepted** operations, not from a prebuilt full graph that includes rejected ones.
- Conflict/dependency checking must prevent double deletion, dangling edges, mutually incompatible patches and orphaned branches. Inform users when choices conflict rather than guessing.
- Analysis snapshots: initial and latest only. If one record exists, do not represent it as two distinct results.

## 4. Validation and resilience

- Safe incremental editing permits unfinished graphs but flags disconnected/dangling paths; only structurally meaningful blocker errors prevent analysis.
- AI structured output is untrusted: parse, schema-validate, constrain size, ensure referenced IDs exist, protect against prompt injection (workflow/chat content is data, not authority), and reject invalid operations. One safe regeneration/correction retry maximum per failed AI generation.
- Autosave should debounce writes; guard against stale saves by workflow revision or `updatedAt` optimistic locking. Show `Saving…`, `Saved`, or a recoverable error.
- Undo/Redo should restore diagram edits reliably and keep persisted state consistent after refresh; differentiate editor undo stack from permanent initial snapshot retention. Avoid claiming cross-device undo history unless implemented.
- Analysis credit ledger should debit only after successfully persisted completed analysis. Request idempotency key per run, enforce credits transactionally server-side, prevent double billing on client retries or reload.
- Dedicated server-side rate limits/timeouts, max graph size and AI budget limits; values can be set in configuration with documented defaults rather than invented user-approved limits.

## 5. Suggested database records

`users`, `invitations`, `magic_link_tokens`, `workflows`, `workflow_snapshots`, `workflow_chat_messages`, `analyses`, `recommendations` (or versioned embedded JSON), `analysis_runs`, `credit_ledger`, `feedback`, `analytics_events`. Use migrations and foreign keys.

- Owner ID and authorization checks **on every private resource route**; never trust client-supplied ownership.
- Magic links: short expiry, random high-entropy opaque token, hashed token storage, one-time consumption and throttling. Don't allow uninvited email self-registration.
- Server-managed invite and credit tools can be scripts/CLI; **not** a full admin UI.
- Permanent delete: remove active graph, analyses and chat records; define and disclose the exact backup retention policy instead of claiming no backups exist.

## 6. Export, telemetry and accessibility

- PNG should export **only the actual diagram and small approved logo + workflow title**, no dotted background, toolbars, focus ring, overlays from editor state or giant whitespace margin; account for long/wide graphs at export dimensions.
- PDF report should include evidence-qualified narrative, diagram, recommendations, assumptions and risks; it must not fabricate cost reductions, hours or percentage savings.
- Event telemetry may record event name, timestamp, user/workflow opaque IDs, duration, failure class and approved non-sensitive enums; **never** raw workflow/chart text, node names, chat content or prompts.
- Accessible diagram structure: focusable nodes/edges or equivalent keyboard-accessible ordered outline; commands for adding and editing without dragging, descriptions of branch labels and change badges. `prefers-reduced-motion` must work.

## 7. Visual QA rule

Use approved screen images for layout and mood, **not** fake values, dates, user names, callouts or UI features. In particular: **no permanent sidebars**, no fake workflow execution or preview buttons, no invented numerical ROI, no unauthorized brand variations. Where the mockup conflicts with v2, the **written spec wins**.
