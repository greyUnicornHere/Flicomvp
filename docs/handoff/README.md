# Flico — Claude Code Development Handoff

**Package version:** 1.0 | **Prepared:** 24 October 2026 | **Project:** Flico Validation MVP

This package contains the agreed product requirements, approved visual references, design tokens, suggested technical contracts, implementation milestones, copy/paste prompts, and acceptance tests needed to start building **Flico** with Claude Code.

**Start here:** `00_START_HERE/START_HERE.md`. Then paste `04_Build_Prompts/00_PROJECT_BOOTSTRAP.md` into Claude Code while it is open in the extracted project folder.

## Folder map

| Folder | Contents |
|---|---|
| `00_START_HERE` | Practical setup, requirements precedence, how to work with Claude Code |
| `01_Product` | Approved MVP development specification **v2.0** |
| `02_Design` | Exact design system, tokens, logo reference, component gallery, three approved screen mockups |
| `03_Architecture` | Proposed implementation contracts and non-negotiable safety invariants |
| `04_Build_Prompts` | Ordered prompts for 0–6 milestones; paste **one prompt at a time** |
| `05_QA` | Manual acceptance checklist, scenario test fixtures, pilot release gate |

## Important product constraints

- **Desktop-only validation MVP**, 1280px+, current desktop Chrome and Edge.
- Flico maps and **assesses** workflows. It **does not execute workflows** or connect to third-party business systems.
- **No sidebar or permanent inspector** in the editor. Floating toolbar, contextual step popover, and draggable Ask Flico window.
- **No invented ROI/time-savings numbers** in reports; use user-provided data and transparent arithmetic or qualitative evidence.
- Single highlighted-change workflow diagram in Analysis; **not** side-by-side before/after diagrams.
- User-supplied logo is the only approved brand reference. The provided JPEG is **not** a transparent production master; don't silently generate a replacement.
- Auth, ownership checks, autosave/data integrity, AI edit approval, and credit idempotency are release blockers.

## Precedence

1. Explicit user decisions made **after** the last written spec/design file, if any.
2. `01_Product/Flico_MVP_Development_Specification_v2.md` for product behavior, requirements and scope.
3. `02_Design/FLICO_DESIGN_SYSTEM.md` for visual guidance and accessibility.
4. `03_Architecture/IMPLEMENTATION_CONTRACTS.md` for **proposed**, not separately user-approved, engineering choices.
5. Mockup imagery is illustrative, not a source of fake data or undocumented features.

If the documents disagree, **do not silently expand the product**. Use this precedence, note the decision briefly, and continue. If an implementation choice cannot be inferred, make a safe minimal assumption and document it in the project `DECISIONS.md`.

## Work process

Build one milestone at a time. After each: run automated tests, open the app for manual verification, summarize what's working and what's not, and make a Git checkpoint. **Do not claim a milestone completed until its acceptance cases pass.**

This is a handoff, not a functioning app. The images are static design references. The technical contracts and milestone boundaries are implementation recommendations intended to prevent scope drift.
