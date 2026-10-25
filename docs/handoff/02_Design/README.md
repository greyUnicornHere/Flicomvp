# Flico Design System v1.0 — handoff

Use **`FLICO_DESIGN_SYSTEM.md`** for rules, **`tokens.css`** and **`tokens.json`** for implementation, and **`component-gallery.html`** for a visual component overview.

The `reference-screens/` folder holds all three user-approved mockups. The `assets/` folder holds the exact user-supplied logo raster and its reference crop.

**Important:** Product behavior comes from `Flico_MVP_Development_Specification_v2.md`, provided separately. The illustrative UI screenshots are not executable UI, and their fake workflow data/dates must not be reproduced as real state. The selected logo reference is not a transparent production-ready logo file; do not invent a replacement.

Open `component-gallery.html` in a desktop browser with `tokens.css` in the same folder. No build step or internet access is required for the preview.

Recommended sequence for Claude Code: read the product spec, read the design system, implement token foundations and UI primitives, build dashboard, editor, and analysis screens, then verify visually and test accessibility at 1280px+.
