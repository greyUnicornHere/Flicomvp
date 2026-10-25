# Flico — Design System

**Version:** 1.0 · **Status:** Development-ready design direction · **Date:** 24 October 2026  
**Product:** Flico · **Tagline:** A better way to work.  
**Source of truth:** User-approved dashboard, editor and refined analysis mockups, interpreted alongside `Flico_MVP_Development_Specification_v2.md`.

> This is a **design and implementation contract**, not a claim that a running application or WCAG certification already exists. Exact token values below are implementation choices to faithfully reproduce the approved visual direction; they were not individually selected by the user. The approved screens and explicit product choices take precedence over illustrative mockup details.

## 1. Principles and boundaries

1. **Quiet, never sterile:** generous whitespace, readable typography, subtle warmth, very little decoration.
2. **Easy before clever:** the primary action is obvious; complexity appears on demand in popovers, expanders and guided forms.
3. **Canvas, not automation platform:** Flico **maps, assesses and proposes** workflows. Do not add execution triggers, live automations, third-party integrations, marketplace blocks, deployment, or 'run workflow' language.
4. **AI with clear ownership:** inferred content and proposed edits are labeled. Changes are only applied after user confirmation, except explicitly requested AI Quick Add, which is immediately undoable.
5. **Meaningful distinction:** status, node type, and proposed-change state always use text/icons/line treatments alongside color.
6. **Desktop validation MVP:** design/test at **1280px and above**, Chrome and Edge. Mobile/tablet, dark mode and a full account/settings product are out of scope.
7. **No invented numbers:** charts, savings, impact scores or percentage reductions are never shown unless justified by user-supplied evidence.

### Non-negotiable visual exclusions

- No persistent left sidebar or right inspector.
- No dashboard illustration, large decorative gradient wash, templates gallery, or import workflow action.
- No gradient on every card, step or line; gradients are reserved for brand mark and limited AI/primary-action highlights.
- No wobbling/morphing/expanding workflow nodes on hover.
- No multi-panel before/after analysis diagrams. **One diagram with proposed changes overlaid.**
- No mobile workflow list included in the MVP.

## 2. Brand assets

**Logo:** use `assets/flico-approved-logo-original.jpeg` as the authoritative *visual reference*: layered stylized **F** with teal→mint leaf-like gradient and a charcoal lowercase **flico** wordmark. `assets/flico-logo-reference-crop.png` is a convenience image for review. **Do not redraw, change the lettering, replace the logo with a generic F, or recolor its gradient.**

The supplied reference is a raster image with an off-white/white background. For **production on varying backgrounds**, obtain an approved transparent SVG/PNG master from the original brand source. Do not present a guessed vector tracing as approved. Until supplied, place the reference crop on an appropriately matched light header background and check its bounding/background visually.

**Minimum clearspace:** 0.5 × logo-mark height around the mark/wordmark. **Desktop header display:** approximately 124–132px wide, natural aspect ratio; maintain legibility and avoid compression. No second lockup or faux wordmark text beside the real asset. Use the actual logo in PDF and PNG exports, at restrained sizes.

**Brand gradient:** decorative `linear-gradient(112deg, #58D4B5 0%, #29B7A2 48%, #098E86 100%)`. When white text is laid over a gradient, use only the accessible **dark gradient** defined below; the bright logo gradient is *not* suitable for white small text.

## 3. Color tokens

| Token | Hex | Purpose |
|---|---|---|
| `--fl-bg-page` | `#FCFBF8` | warm neutral default page and canvas base |
| `--fl-bg-results` | `#FAFAF8` | analysis page background |
| `--fl-surface` | `#FFFFFF` | header, cards, dialogs, popovers |
| `--fl-surface-subtle` | `#F7FAF8` | hover, lightly differentiated regions |
| `--fl-text` | `#202D2C` | principal text; charcoal |
| `--fl-text-secondary` | `#536B62` | secondary text and descriptions |
| `--fl-text-muted` | `#647773` | subdued but readable captions (on white) |
| `--fl-border` | `#E3EAE6` | soft default boundaries |
| `--fl-border-strong` | `#C4D2CC` | stronger interactive boundary |
| `--fl-brand` | `#087E71` | accessible primary solid teal; focus/accessibility |
| `--fl-brand-hover` | `#0A7169` | primary hover |
| `--fl-brand-active` | `#0B625B` | primary pressed |
| `--fl-brand-pale` | `#E4F4EE` | subtle teal highlight |
| `--fl-focus` | `#0A7169` | 2px keyboard focus ring (with offset) |
| `--fl-grid-dot` | `#E2EAE5` | editor dot grid, visual only |
| `--fl-edge` | `#90AAA0` | standard diagram connection |
| `--fl-success` | `#087E71` | saved, accepted; never only color |
| `--fl-warning` | `#98651F` | warning label on pale background |
| `--fl-error` | `#B25650` | removal/error text and outlines |

### Workflow node fill / stroke / text (by meaning, not by recommendation status)

| Type | Fill | Stroke | Icon/text ink | Extra cue |
|---|---|---|---|---|
| Start | `#EFF7F3` | `#AACBBC` | `#236B59` | start-circle icon |
| Action | `#E8F6F2` | `#A1CDBF` | `#146E5F` | action/square icon |
| Decision | `#F0EDFA` | `#C8B9E8` | `#644E9C` | diamond icon + labeled paths |
| Approval | `#FFF3E0` | `#E1C397` | `#825C21` | check icon |
| Wait | `#E9F3FB` | `#B2D0E8` | `#285E83` | clock icon |
| Finish | `#F2F4F2` | `#CAD6D0` | `#52675E` | square/stop icon |
| Exception | `#FFF0EE` | `#DAAAA4` | `#9E4A43` | alert icon + dashed edge |

**Example contrast checks (WCAG):** charcoal on white ~14.3:1; `--fl-text-secondary` on white ~5.8:1; `--fl-brand` on white ~5.0:1. These ratios are calculated, but finished UI still needs testing, especially text on pale colored nodes, icon-only controls and translucent overlays. Node strokes are not substitutes for text labels.

### Analysis overlay colors (independent of step type)

- **Added:** `#27966D` stroke 2–2.5px, green `+ Added` badge, explicitly connected new path.
- **Modified:** `#C28A33` stroke 2–2.5px, amber `↗ Updated` badge and/or changed-edge treatment.
- **Removed:** `#BF6D68` dashed stroke, faded original position, struck-through label, `− Removed` badge and dashed old path.
- **Unchanged:** existing node-type palette, normal solid edges.
- Keep the underlying node-type fill visible where possible; use **overlay outlines and badges**, not full recoloring of the whole graph. Approval (amber) and a modification (amber) must remain distinguishable through their badges/text.
- If highlighting a changed branch, show **both connection endpoints** and clear Yes/No or other meaningful labels. A removed path must be shown as an abandoned proposed route, not as an active one.

## 4. Typography

**UI font:** `Inter`, falling back to `ui-sans-serif`, system UI, Segoe UI/Arial/sans-serif. The Flico wordmark must remain the supplied logo asset, never typeset as normal UI text. Font files are *not* bundled in this package.

| Role | Size / line-height | Weight | Use |
|---|---|---|---|
| Dashboard hero | 40 / 48px | 700 | “A better way to work.” |
| Page heading | 28 / 36px | 700 | results page |
| Section heading | 18 / 26px | 650–700 | recent workflows, recommendations |
| Card heading | 18 / 26px | 650–700 | creation cards |
| Body | 14 / 22px | 400 | explanations, form text |
| Secondary | 13 / 20px | 400 | subtitles, metadata |
| Small | 12 / 18px | 400–600 | table metadata, captions |
| Node label | 13–14 / 18px | 650 | max two lines |
| Button | 13–14 / 20px | 600–650 | actions |
| Overline | 11 / 16px | 700 | optional all-caps diagram caption |

Letter spacing: hero/heading `-0.025em`; body `0`; overline `0.04em`. Do not shrink node-label text to fit long step names; truncate after two lines and reveal the full name on hover/focus/selection. Do not reduce body below 14px just to mimic rasterized mockup text. Always use proper semantic heading structure.

## 5. Spacing, geometry and elevation

- **Base spacing scale:** `4, 8, 12, 16, 20, 24, 32, 40, 48, 64px` — all layout sizes from these increments unless a component spec says otherwise.
- **Dashboard content max width:** 1200px, centered. Header horizontal padding ~32px, dashboard vertical separation 36–48px.
- **Header:** ~74–80px high, one level only. A little tighter at 1280px, without hiding controls.
- **Cards:** 16px radius; border `1px solid var(--fl-border)`; generally no shadow or a soft `0 4px 16px rgba(32,77,61,.045)`.
- **Creation cards:** 2 equal columns, ~24–32px inner padding, 20px inter-card gap, min-height ~190px.
- **Popover / floating chat:** 16px radius, 1px border, shadow `0 16px 48px rgba(32,77,61,.14)`.
- **Small buttons / toolbar:** 10–12px radius; icon-only hit target at least **44×44px**.
- **Inputs:** min-height 42–44px, radius 8–10px; 1px border, 2px focus ring with 2px offset; labels always visible.
- **Organic workflow node:** compact baseline ~172–190px wide × 68–74px high, lightly asymmetric rounded corners (e.g. `border-radius: 28px 22px 26px 21px / 25px 27px 22px 25px`). Consistent template; no random per-node blob shapes. Decision may be a slightly rounder shape but still readable.
- **Node icon:** 28×28px in a subtle tinted rounded-square/circle background. Gap to label ~10px. Node selected = quiet 2px teal ring without scale/position shift.
- **Canvas:** full available viewport below header, no permanent sidebar, faint 1px dot every ~22px. Dot contrast intentionally low; it is not a required reading aid.
- **Connector:** smooth cubic Bézier, 1.75–2px stroke, clearly visible arrowhead; decision Yes/No label near divergence; route loops around nodes and avoid label collisions.
- **Floating step toolbar:** ~60px wide, left inset 24–28px, rounded white vertical pill, icon buttons with accessible labels. No left "Blocks" panel.
- **Canvas utilities:** bottom right, zoom +/- and percentage, fit-to-screen, auto-arrange. Avoid permanent minimap for MVP.
- **Dashboard workflow table:** simple rows ~50–56px tall, 1px dividing lines, visible focus for row actions, status text plus pale pill.
- **Floating step popover:** ~292–340px wide, position next to selected node; flip/shift to remain inside viewport; scroll internally if needed, never clipped by canvas overflow.
- **Ask Flico floating chat:** compact ~360×460px (resize via Expand control to ~520×640px where space allows), movable within viewport, minimizable; avoid permanently docked sidebar. Keep open-state persistent while changing view as appropriate.

## 6. Responsive behavior *within desktop scope*

- At **1280px**: compress large gaps, allow wrapping noncritical metadata, preserve top actions and useful canvas; floating UI must not cover the only active node/primary CTA.
- At **1440–1536px**: match approved visual proportions, dashboard centered and diagram spacious.
- At **1920px+**: dashboard remains max 1200px, editor canvas expands rather than stretching nodes or enlarging text.
- Under 1280px: friendly unsupported-screen message or non-guaranteed layout; **do not build mobile UX** as part of the MVP.

## 7. Component patterns and state behavior

### 7.1 Logo/header
- Dashboard: logo left; avatar/account menu right only. **No sidebar or fixed header.** Dropdown: email, Feedback, Sign Out.
- Editor/results: logo/back, click-to-edit workflow title, Save status, Editor/Analysis tabs (once analyzed), always-visible Undo/Redo, Ask Flico, Analyze popover and single Export menu. Ensure menu items fit 1280px (consider shorter labels), without nesting in a side rail.

### 7.2 Dashboard
- Centered hero: `A better way to work.` and subtitle: `Map your workflows, uncover inefficiencies, and discover better ways to work.`
- Two equal, interactive, softly bordered cards: **Build manually** and **Create with AI**. Simple icon, heading, brief descriptive line and discreet right arrow. **No dominant default choice**; hover shows pale teal border/background, **no movement**.
- Below: `Recent workflows`, visible search field, compact list/table (`Name / Status / Last modified / Actions`). Draft/Analyzed status labels visible in text. Three-dot menu offers Rename/Delete.
- **Empty state replaces the table when there are no workflows**: short message and optional Customer Order Processing example. Do not display empty state below a populated table, even though the illustrative screenshot does.

### 7.3 Editor diagram and editing
- On manual creation, one Start block only with inline +. Flico does **not** execute the workflow; don't call this a trigger/runnable recipe.
- Step types: Start/Finish, Action, Decision, Approval, Wait. Dedicated **Add exception**, guided loop and parallel activities. The + menu exposes the manual step types and `Describe what happens next...` for Quick Add.
- Inline + visible on hover, selection and equivalent focus; don't require hover for keyboard-only use.
- Block details popover (not full inspector): name, type, owner/team, duration, tool/software, notes. One action for Ask Flico about selected step.
- Decision creation uses a guided small popover (question, Yes outcome, No outcome), not arbitrary BPMN wiring. Loops have curved back-edge; parallel steps stack vertically with explicit split/join; exceptions have dashed links.
- Undo/Redo visible in header, standard shortcuts as approved; save state `Saving…`, `Saved`, `Couldn't save — Retry`; user-facing error message shouldn't disappear before it can be read.
- Validation shown with inline marker and a header summary; clicking navigates to the issue. Suggestions need explicit preview/approval.

### 7.4 AI assistant
- Ask Flico opens a draggable **floating window**, compact, expandable or minimizable, with predefined suggested prompts. User can move focus back to canvas without losing messages.
- Suggested edits produce **explanation in chat + simultaneous highlighted graph preview**. Cancel leaves graph untouched. Apply is a single undoable transaction.
- AI Quick Add at an explicit + insertion point is the one exception: insert immediately, with visible Undo. Inferred nodes marked as such until confirmed.
- Loading/progress: genuine stage messages with restrained dots/line animation (avoid fake progress percentages). Honor `prefers-reduced-motion`.

### 7.5 Analysis results
- Concise executive summary **before** diagram. Evidence/assumptions visible, plain language.
- Desktop two-column section: one change-highlighted diagram (~62%) + recommendations list (~38%), no original/improved toggle and no side-by-side comparison.
- Interactions synchronized in both directions: selecting a recommendation highlights/focuses corresponding graph change; clicking changed graph item selects its recommendation.
- Added green, modified amber, removed faded/dashed red with strikethrough; explicit badges and legend. Distinguish old dashed edges from active new paths. Branch and path labels clear.
- Recommendation card: brief problem/proposal/reason, tags for `Quick Win`, `Strategic Improvement`, `Complex Change`, explicit `Pending/Accepted/Rejected`, expandable details, qualitative evidence and verification flags. Rejected items in collapsible section.
- `Apply All` and per-item acceptance available. Combined preview before final `Confirm & Apply`. Preserve original workflow/snapshot.
- `Initial Analysis / Latest Analysis` dropdown; when only one analysis exists, don't duplicate data or misleadingly show two distinct versions.

### 7.6 Export and feedback
- Export dropdown: **PDF Report**, **Workflow PNG**. PDF executive-style; PNG high-resolution clean diagram with title and small logo, never canvas grid or editor chrome.
- Feedback option in account menu and/or an unobtrusive global action. One post-first-analysis usefulness rating, dismissible.

## 8. Component interaction states

| State | Required treatment |
|---|---|
| Default | calm background, readable text, thin border only where functional |
| Hover | pale teal border/background for clickable cards/buttons, no transform |
| Focus-visible | 2px `--fl-focus` ring + offset, keyboard focus never color-only |
| Selected node | 2px brand outline/ring; don't shift node or edge routing |
| Disabled | muted appearance + native disabled semantics; contrast and description remain clear |
| Loading | label like `Analyzing…`, restrained indicator; avoid fake percent |
| Success | label `Saved`, `Accepted`, etc. + relevant icon |
| Error | message with what happened and actionable Retry; no destructive silent failure |
| AI preview | green/amber/red overlays as defined, with Apply/Cancel |
| Reduced motion | skip decorative transitions; retain immediate state feedback |

**Motion:** 120–160ms easing for border/background/opacity; never animate node position unless user invokes auto-arrange and reduced-motion is off. Selected graph states should be instant. No celebratory bursts or wobble.

## 9. Accessibility acceptance checklist

- Target **WCAG 2.2 AA** and verify with manual/automated testing. Do **not** claim compliance just because tokens exist.
- 4.5:1 contrast for ordinary text; 3:1 for large text and essential graphical boundaries/focus indicators. Recheck actual composited overlays/backgrounds.
- Complete core diagram actions by keyboard, even without drag-and-drop; visible keyboard focus and meaningful screen-reader labels for each node and connector.
- Popovers/dialogs: correct keyboard focus return, Escape handling, sensible tab order; dialog focus trap where modal.
- Icon-only controls have `aria-label`/tooltips. Form labels are not placeholders alone. Dynamic saving/validation updates announced politely without overwhelming announcements.
- Diagram selection uses icons/badges/text in addition to color. Branch and exception meaning is text-labeled.
- Reduced-motion stylesheet. No hover-only action is required to complete a critical operation.
- Test 1280px layout at 100% and 200% browser zoom; document any screen-width limitation honestly.

## 10. Design QA gates before development sign-off

1. Logo exactly matches the supplied raster reference; no generic recolored icon or substitute wordmark.
2. Dashboard matches the approved centered 1200px, two equal cards, minimal header, and conditional empty state.
3. Editor is true **full-screen canvas** with floating toolbar and step popover; no permanently visible left/right panels.
4. Workflow labels readable, icon + two lines maximum, organic silhouette subtle, connectors curved and correctly routed.
5. Clicking + and branch guides behaves like the MVP specification; Undo/Redo and Autosave reliable.
6. Ask Flico floating window, AI previews and current analysis context are consistent across flows.
7. Analysis shows **one** graph with color+badge+line-style diff and synchronized recommendation list; no invented percentages.
8. Recommendation confirmation preserves original and never applies a rejected change.
9. PDF and PNG use real logo/reference, not retyped stand-ins; outputs legible across long branching flows.
10. Keyboard, contrast, screen-reader labels and reduced-motion behavior have test evidence.

## 11. Files in this package

- `tokens.css`: implementation CSS variables, baseline components and reduced-motion rules.
- `tokens.json`: machine-readable tokens for potential Tailwind/CSS generation.
- `component-gallery.html`: static visual review of core tokens and components. It is *not* functioning application UI.
- `assets/flico-approved-logo-original.jpeg`: approved original logo reference.
- `assets/flico-logo-reference-crop.png`: display/reference crop, not transparent production logo.
- `reference-screens/01-dashboard-approved.png`: approved dashboard reference (illustrative old dates and mutually exclusive empty state must not be reproduced as real data).
- `reference-screens/02-editor-approved.png`: approved editor reference.
- `reference-screens/03-analysis-approved.png`: approved refined analysis reference.

### How Claude Code should consume this package

1. Read `Flico_MVP_Development_Specification_v2.md` and this document before implementing. **Product spec defines behavior; this design system defines visuals.** Latest explicit user decisions win conflicts.
2. Load `tokens.css` at the app root and use semantic CSS variables instead of scattered hex colors. Adapt to Tailwind via `@theme` or CSS variable utilities; do not create a parallel unsynchronized token list.
3. Build UI primitives first: Button, IconButton, Card, Input, Dropdown, Popover, Modal, StatusPill, OrganicWorkflowNode, BranchConnector, ChangeOverlay, FloatingChat, RecommendationCard.
4. Match the **approved reference screens**, rather than using unrelated workflow automation dashboards as inspiration.
5. Compare an actual 1536px screenshot to refs; inspect with a human and run keyboard/focus tests at 1280px before advancing to AI functionality.
6. If something in the raster mockups conflicts with the actual agreed spec (e.g., old example dates, an empty state under populated list, symbolic node styles), implement the **spec**, not the mistake.

**Deferred:** user-selectable themes, custom branding, complex diagram subgroups, full responsive mobile experience, hover-activated advanced toolbars, and animation-heavy UI.
