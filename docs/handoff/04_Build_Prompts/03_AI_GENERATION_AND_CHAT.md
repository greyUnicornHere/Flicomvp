# PROMPT 03 — AI generation, Quick Add and Ask Flico

Continue Flico from milestone 2; read the product spec sections 8–9, 7, 14–16 and engineering contracts. **Do milestone 3 only.**

Implement a **provider-agnostic backend AI adapter**, typed and schema-validated output, rate/cost/time limits, and rigorous graph operation validation. All model output is untrusted data; never directly write a model-proposed graph patch to the database without validating it.

1. **AI Create**: user enters natural-language workflow description, creates an appropriately named complete first draft without mandatory questions; show graph fitted to canvas; mark inferred steps and show concise assumptions; permit confirming/editing assumptions. If structurally invalid, one safe correction retry; then keep valid partial content with Retry / Continue Editing Manually. Never destroy existing saved work.
2. **AI Quick Add**: `Describe what happens next…` from an explicit inline + insertion point. Infer step type/name and **insert immediately with Undo**. This is the only approved exception to the explicit AI preview requirement.
3. **Ask Flico**: header button and selected-step contextual action, **movable floating compact chat window** (expand/minimize/close, bounded to viewport). One persisted conversation per workflow, Clear History, a few predefined contextual prompts; concise responses with depth on request. Use graph details/chat and latest analysis when available; never other workflows.
4. **AI editing and Suggest Fix**: concise explanation in chat plus simultaneous diagram overlay (added green, modified amber, removed red/strike, affected edges); explicit Apply/Cancel, revision guard, all-or-nothing transaction, one undoable action. Cancel is non-destructive.
5. Explicitly distinguish actual live-provider responses, development test fixtures, and errors. Without a provider key, clearly communicate this; do not fabricate an analysis or pretend an AI request succeeded.

Test invalid JSON/schema, nonexistent node IDs, duplicate IDs, invalid edges, prompt injection within workflow text, conflict on stale workflow revision, one safe retry, canceled previews, applied vs rejected operations, persistence and Clear History. Ensure no raw workflow/chat content in analytics or HTTP logs. No AI response should cross users.

Show me one complete AI generation → correction → preview → approval workflow in a running app; report tests, manual QA steps, checkpoint, and limitations. **Stop before analysis milestone.**
