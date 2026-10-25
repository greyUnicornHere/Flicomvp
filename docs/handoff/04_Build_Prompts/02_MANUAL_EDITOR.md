# PROMPT 02 — Visual editor and manual graph operations

Continue the working Flico repo. Read the product spec sections 3, 5–7 and 14, the design system and architecture contract. Use `02_Design/reference-screens/02-editor-approved.png` as visual reference only. **Do milestone 2 only.**

Implement a real, persisted desktop **full-screen left-to-right graph editor** with:

- Single compact header: Back, clickable inline workflow title, `Saving…/Saved/Retry`, visible Undo/Redo buttons, Ask Flico placeholder action if AI not ready, Analyze placeholder action if analysis not ready, Export placeholder action if export not ready. Unimplemented commands must be clearly disabled or labeled—not pretend to work.
- Warm off-white dotted canvas; compact subtle **organic/pebble-shaped blocks** with icons + 2-line max labels, muted type colors, curved labeled arrows. No persistent sidebar or right inspector.
- Floating, compact step toolbar; bottom-right zoom in/out, fit, auto-arrange; panning and trackpad/mouse wheel zoom.
- Click node -> floating **contextual popover** with name, type, owner/team, duration, tools/software, notes. Changes persist. Focus/Escape/click-outside behavior accessible.
- Inline + between steps and on hovered/focused connections -> compact menu for Action, Decision, Approval, Wait, Finish plus **AI Quick Add input placeholder** clearly marked as unavailable until milestone 3; existing manual options fully functional. Adding a manual block auto-focuses its editable default name.
- Manual workflow starts with Start only. Optional dismissible suggestion for Finish; do not auto-create Finish.
- Guided **Decision** creation (question/Yes/No outcomes), branch and join suggestions; guided **Repeat earlier step** for loops, guided **Parallel activities** (branches and wait-for-all option), dedicated **Add exception** flow with dashed exception edges. Each action should build valid graph semantics (including properly typed edges and branch groups), not merely draw decorative lines.
- Connected-step deletion requires confirmation showing affected connections and must be undoable. User can reconfigure connections without silently dropping branch meaning.
- Autosave with revision-safe conflict/error handling, reliable Undo/Redo (buttons and approved standard undo shortcuts); a refresh preserves graph and positions; layout changes do not change semantics.
- Continuous validation with inline markers + header summary and pre-analysis validation routine; manual fixes now, AI Suggest Fix marked clearly unavailable until implemented.
- Keyboard-accessible alternatives to hovering and dragging, labeled actions, visible focus and reduced motion.

**Acceptance emphasis:** test start-only, action insert, two independent decision outcomes, merge, loop, parallel, exception, step delete cancel/confirm, undo/redo, autosave/refresh, label truncation, 1280px layout. Use controlled deterministic test graphs. Compare a real screenshot with the approved editor reference.

Run tests, lint, typecheck and build. Provide a concise manual test script, full pass/fail list, local URL, known gaps, and Git checkpoint. **Stop.**
