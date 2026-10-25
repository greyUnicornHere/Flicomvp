# Flico — Acceptance & Manual Test Plan

**Purpose:** Let the product owner test concrete actions without reading code. The automated suite should complement, not replace, these browser checks. Record each case as `Pass`, `Fail`, `Not built yet`, or `Blocked`, plus screenshot/error evidence in `TEST_NOTES.md`.

## Pilot blockers (must pass before real invites)

- Invites/magic links genuinely restrict access, expire and cannot be reused; private records scoped to owner even when manually entering an ID/URL.
- Create/edit/delete/autosave/refresh never silently loses or corrupts saved workflow data.
- Editing a branch, loop, parallel group or exception retains valid node/edge references after reload and undo.
- AI proposals cannot overwrite graph without preview + explicit approval, **except** deliberate Quick Add which is immediately undoable.
- AI-generated invalid patches are rejected server-side; prompt text cannot bypass permissions, steal data or request secret values.
- Failed/canceled/duplicate analyses never consume a credit; successful results consume exactly one.
- Accept/reject choices are honored; rejected recommendations never leak into final applied graph.
- Reports never present unsupported numerical ROI/savings or claim that real-world automations ran.
- Core editing is keyboard-operable and visible focus is provided.

## M0 — Setup, identity and authorization

| ID | Action | Expected |
|---|---|---|
| A01 | Start app with documented commands | Working local URL and health endpoint; secrets not echoed |
| A02 | Try app without sign-in | Private pages/API inaccessible |
| A03 | Invite User A, follow valid one-time link | Signs in; link expires/is consumed |
| A04 | Reopen same link or link after expiry | Cannot sign in again; clear message |
| A05 | Sign out; revisit protected URL | Requires sign-in |
| A06 | Sign in as User B and request User A's workflow by URL/API | Access denied without leaking private data |
| A07 | Inspect repo and deployed app | No `.env` secrets, dev mail outbox disabled in production |

## M1 — Dashboard and persistence

| ID | Action | Expected |
|---|---|---|
| D01 | Log in with no workflows | Hero + two equal cards; optional example; no populated table |
| D02 | Click Build manually | `Untitled workflow`, **Start only**, persisted |
| D03 | Return to dashboard after creation | Table appears, empty state disappears |
| D04 | Create 3 workflows then search | Live name filtering, correct status/date columns |
| D05 | Rename from row action, then reopen | New name persists |
| D06 | Delete but choose Cancel | Workflow remains |
| D07 | Delete and confirm | Workflow and related active analyses/chat gone; no trash UI |
| D08 | Open profile menu | Email, Feedback, Sign Out only; no admin/settings product |
| D09 | Inspect dashboard at 1280 and 1536px | No sidebar, approved logo and balanced centered max-width |

## M2 — Manual editor and validation

| ID | Action | Expected |
|---|---|---|
| E01 | Create manual workflow | Only Start, visible +, off-white subtle dot grid |
| E02 | Click + and choose Action | Block appears; default name selected for editing |
| E03 | Add Decision | Guided question + Yes/No outcomes, two labeled branches |
| E04 | Add actions on both branches and use suggested reconnection | Both paths valid, Yes/No labels preserved |
| E05 | Create a branch that ends independently | No forced reconnection |
| E06 | Add guided loop to previous step | Explicit curved back-edge persists after reload |
| E07 | Add two parallel activities, require both to finish | Vertically stacked split/join semantics persist |
| E08 | Add exception to an action | Dedicated labeled dashed path and exception action |
| E09 | Select a node | Contextual floating popover, NOT permanent inspector; all approved fields |
| E10 | Delete a connected step, cancel confirmation | No change |
| E11 | Confirm deletion with affected connections visible | Expected graph change; Undo restores exact graph |
| E12 | Undo/Redo multiple edits | Exact states restored; no dropped edges |
| E13 | Wait for autosave; refresh | Names, notes, graph topology and positions persist |
| E14 | Trigger a save error | Clear, durable error + Retry; unsaved edits not silently discarded |
| E15 | Make an incomplete branch | Inline issue warning and header summary point to same problem |
| E16 | Pan/zoom/fit/auto-arrange | Diagram readable, no semantic edge changes |
| E17 | Use keyboard only | Can add, edit, delete, confirm and navigate without drag |
| E18 | View at 1280px desktop width | Header and floating tools work without overlapping core controls |

## M3 — AI generation and editing

| ID | Action | Expected |
|---|---|---|
| I01 | Describe a basic customer-order process | Named first-draft diagram with visible assumptions |
| I02 | Confirm/edit inferred assumption | Marker clears correctly and changes persist |
| I03 | Use AI Quick Add from + | Step inserts immediately and Undo works |
| I04 | Open Ask Flico, move/expand/minimize | Window operates without hiding/loss of chat |
| I05 | Ask about selected step | Uses step/workflow context, no other workflows |
| I06 | Ask Flico to delete/change a step | Chat explanation + visual overlay + Apply/Cancel |
| I07 | Cancel proposal | Graph remains exactly as before |
| I08 | Apply proposal then Undo | Revision-safe atomic edit, exact restoration |
| I09 | Clear chat history | Chat cleared; workflow/analysis unaffected |
| I10 | Inject malformed / stale / nonexistent IDs in model fixture | Safe validation error, preserved graph, one retry where allowed |
| I11 | Remove AI API key in dev configuration | Explicit provider unavailable message; never fake live answer |

## M4 — Analysis and recommendations

| ID | Action | Expected |
|---|---|---|
| R01 | Open Analyze menu | Quick / Guided options |
| R02 | Start Guided but skip questions | Equally detailed analysis; optional questions remain optional |
| R03 | Run a valid analysis | Genuine loading stages; auto opens executive summary |
| R04 | View recommended changes | **One** diagram with added/modified/removed labels and route changes |
| R05 | Select a recommendation | Diagram highlights related nodes/edges; reverse click sync works |
| R06 | Reject a recommendation | Moves to collapsible rejected section; can reconsider |
| R07 | Accept others; choose final preview | Shows combined accepted changes only, conflict checks |
| R08 | Confirm & Apply | Updated editor graph; original snapshot retained; Undo works |
| R09 | Apply All with incompatible recommendations | User informed, invalid graph cannot be committed |
| R10 | Run analysis twice | Initial/Latest dropdown works; if once, no duplicate fake version |
| R11 | Trigger failed/canceled/duplicate request | No credits charged |
| R12 | Complete one analysis with 10 initial credits | Exactly 9 remain, one ledger debit |
| R13 | Analyze with insufficient context for ROI | Qualitative claims/evidence, no imaginary percentages |
| R14 | Analyze well-functioning flow | No forced recommendations; unchanged improved graph allowed |

## M5 — Export and release

| ID | Action | Expected |
|---|---|---|
| X01 | Export PNG for long branching workflow | High-res readable image, branded title/logo, no editor chrome |
| X02 | Export PDF | Title/date, executive summary, graph, prioritized findings/assumptions/risks |
| X03 | Inspect the PDF/PNG outputs | No made-up ROI, no malformed text, all content printable |
| X04 | Send feedback, then complete first analysis | One optional rating prompt, no repeated nagging |
| X05 | Generate telemetry events | Raw workflow/chat/step text absent from event payloads |
| X06 | Enable reduced-motion | Animations appropriately reduced |
| X07 | Browser keyboard + focus check | Focus visible, dialogs usable, labeled graph actions |
| X08 | Run tests/build + start production mode | Pass; dev email outbox and debug auth bypass unavailable |

## Test graph fixtures (use user-free synthetic data)

1. **Simple sequential**: Start → Receive order → Verify stock → Finish.
2. **Decision with asymmetric outcomes**: Start → Stock available? → Yes: Reserve item → Finish; No: Notify customer → Finish.
3. **Branch with rejoin**: Start → Approved? → Yes: Dispatch; No: Request correction → back to Approved?; both valid semantics.
4. **Parallel**: Start → parallel(Prepare invoice | Pack shipment) → wait-all join → Dispatch → Finish.
5. **Exception**: Start → Charge payment → exception(Payment rejected → Contact customer); normal path → Finish.
6. **Long / printable**: 25 descriptive steps, 2 decision splits, 1 loop, 1 parallel block; verify fit, navigation, PNG/PDF text.
7. **Malformed**: edge references deleted node, duplicate node ID, missing branch label, loop without exit. Validate graceful handling.
8. **Conflicting recommendations**: recommendation 1 removes node B, recommendation 2 modifies B, recommendation 3 adds edge from B. Accepting all must surface conflict instead of corruption.

Use fixtures for reproducible tests, not as misleading seeded real customer history.

## Before inviting pilot users

Record evidence for every blocker. Run `lint`, `typecheck`, `test`, `build` and E2E checks, including at 1280px and 1536px in Chrome/Edge. Verify invites, credit scripts and feedback storage. Publish concise privacy/retention wording and known limitations. Interview approximately 10 pilot users (around five business owners and five department managers). **Do not turn interviews into a new in-app survey feature.**
