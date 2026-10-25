# Decisions

Implementation choices and assumptions. Product behavior comes from `docs/handoff/01_Product/Flico_MVP_Development_Specification_v2.md`, which wins any conflict. Entries are newest last.

## Milestone 0 — Foundation (2026-10-25)

### Process (confirmed by product owner)
- **Preview:** the build runs in a cloud container, so the owner reviews screenshots plus test evidence and runs the app locally from GitHub with the README steps.
- **Git:** `main` holds a minimal initial commit. Each milestone is built on its own branch (`milestone-0-foundation`) and merges to `main` after approval. No PR is opened unless requested.
- **Handoff docs** are kept in `docs/handoff/` so later sessions can re-read the spec instead of re-inventing decisions.

### Stack (spec §16 and IMPLEMENTATION_CONTRACTS §1)
| Area | Choice | Why |
|---|---|---|
| Language | TypeScript 5.9 everywhere | TS 7.x (Go port) is newly released and lint tooling support is uncertain. |
| Web | React 19, React Router 7, Vite 7, Tailwind CSS 4 | Stable and widely used. Vite proxies `/api` in development. |
| Diagram | `@xyflow/react` 12 installed, **not used yet** | Stack decision only. The editor is Milestone 2. |
| API | Fastify 5, Zod 4 validation | Maintained, fast, testable via `inject()` without a network. |
| Database | SQLite via Node's built-in `node:sqlite` | **No native compilation**: works on Windows without Visual Studio Build Tools, which `better-sqlite3` can need. Trade-off: Node marks the module experimental, so the startup warning is silenced in npm scripts and Node ≥ 22.13 is required. Access goes through `server/db/` so swapping drivers is contained. |
| Migrations | Ordered TypeScript list in `server/db/migrations.ts`, `schema_migrations` table, one transaction per migration | Ships inside the compiled build (no SQL files to copy). Applied by `npm run db:migrate` and automatically on server start, which suits a single-instance pilot. |
| Email | Adapter: `dev-outbox` (in-memory, development only) or `smtp` (Nodemailer) | The spec requires a development-only outbox. Any SMTP provider works for real delivery. |
| Icons | `lucide-react` | Matches the line-icon style in the approved mockups. |
| Font | Inter, self-hosted via `@fontsource-variable/inter` | No third-party font requests (privacy). It registers as "Inter Variable", so `client/src/styles/app.css` prepends that name to `--fl-font`. Every other token is unchanged. |
| Tests | Vitest 4 (server: node; client: jsdom + Testing Library), Playwright 1.63 (Chromium) | Vitest 3 had open security advisories, so it was upgraded. Playwright is pinned to the version whose browser is installed in the build environment. |

npm 10 has a known resolver crash (`reading 'edgesOut'`) when *re-resolving* this dependency tree. The committed `package-lock.json` was produced with npm 11. `npm ci` / `npm install` from the lockfile works on npm 10 and 11 (verified).

### Design system use
- `client/src/styles/tokens.css` is a byte-for-byte copy of the approved `02_Design/tokens.css`. It loads at the app root inside Tailwind's `components` layer, and Tailwind utilities map to the same CSS variables (`@theme inline`), so there is no parallel token list.
- **Logo:** `client/public/brand/flico-logo.png` is a byte-for-byte copy of the approved `flico-logo-reference-crop.png`. It has not been redrawn, recolored or edited. It is shown at 128px wide (design range 124–132px), natural aspect ratio.
  - **Known limitation:** the raster has a baked-in off-white background (#FDFCF8). On the white header (#FFFFFF, per tokens and the approved mockups) it shows as a very faint box; the approved analysis mockup shows the same artifact. Signed-out pages place it on the page background (#FCFBF8), which matches almost exactly. **A transparent production master (SVG or PNG) is still needed from the brand source.**
  - **Owner decision (2026-10-25): option (a).** Keep the supplied raster as-is and keep the white header until the owner provides a transparent logo. Do not edit the raster or change the header color in the meantime. When the transparent file arrives, replace `client/public/brand/flico-logo.png` (and add a favicon).
  - No favicon yet: making one would require cropping or deriving from the logo, which needs the production asset.
- Header contents align to the 1200px dashboard content width, as in the approved dashboard mockup.
- **Account menu** shows the email and **Sign Out** only. **Feedback** (in the approved dropdown) is added in Milestone 5 with the feedback feature, rather than shipping a non-functional item now.
- Below 1280px a dismissible, non-blocking notice explains the desktop-only scope (design system §6). It never blocks use, so 200% browser zoom still works.
- The signed-in landing page is a deliberately minimal Milestone 0 placeholder. The real dashboard is Milestone 1.

### Authentication and security
- **Invite-only:** invitations live in `invitations` and are managed only by `npm run invite` (no admin UI, per spec §15). There is no sign-up path; uninvited addresses get the same response as invited ones, and no email is sent.
- **Magic links:** 256-bit random tokens. Only SHA-256 hashes are stored. Default lifetime 15 minutes (`MAGIC_LINK_TTL_MINUTES`, 5–60). Single use, consumed atomically in a transaction. Older unused links stay valid until they expire. At most 5 links per address per 15 minutes; extra requests get the normal response but no email.
- **Explicit "Continue to Flico" click:** the emailed link opens a page that signs in only on a button press (a POST). This stops email security scanners that pre-open links from using up the one-time token. The token is removed from the address bar immediately and the page sends no referrer.
- **Sessions:** a random opaque token in an `httpOnly`, `SameSite=Lax` cookie (`Secure` in production), stored hashed, with a fixed 14-day lifetime (`SESSION_TTL_DAYS`). Logout deletes the server session. Revoking an invitation ends all of that person's sessions and pending links.
- **Authorization** is enforced on the server for every private route (`requireAuth` plus `owner_id` in every query). Another user's resource returns the same `404` as a missing one, so its existence isn't revealed.
- **Minimal `workflows` table and read-only `GET /api/workflows/:id`:** added in M0 only so cross-user denial can be tested now (spec A06). There is no create/list/rename/delete and no UI. Milestone 1 extends the table with a new migration.
- **Cross-site request protection:** SameSite cookies, JSON-only request bodies (`text/plain` and form posts are rejected), and an Origin check on state-changing requests.
- **Rate limits** (per client IP, per 15 minutes): 10 link requests, 30 verifications. Set `TRUST_PROXY=true` only behind a trusted reverse proxy.
- **Headers:** Helmet with a strict Content-Security-Policy, `frame-ancestors 'none'`, `Referrer-Policy: no-referrer`, and HSTS in production.
- **Logging:** method and path only. No query strings, headers, cookies, bodies or email addresses.
- **Production guardrails:** startup fails with readable messages if `APP_URL` is missing or not https, or if `dev-outbox` is configured. Secret values are never echoed. The outbox API is not registered in production, and the outbox page is not in production bundles.

### Open items for later milestones
- Real SMTP delivery has not been tested against a live provider (no credentials yet). The adapter is in place and covered by config validation.
- Data retention/backup policy, telemetry, and deployment target are decided in Milestone 5.
- Microsoft Edge E2E runs need a machine with Edge installed (the Playwright project is ready to add `channel: 'msedge'`).
