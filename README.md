# Flico

**A better way to work.** An invite-only, desktop-only validation MVP for mapping, understanding and assessing business workflows. Flico does **not** execute workflows or connect to other business systems.

- Product spec, design system, mockups and build prompts: [`docs/handoff/`](docs/handoff/README.md)
- Progress and known issues: [`PROGRESS.md`](PROGRESS.md) · Decisions: [`DECISIONS.md`](DECISIONS.md) · Test evidence: [`TEST_NOTES.md`](TEST_NOTES.md)

## Run it on your computer (Windows, macOS or Linux)

You need **Node.js 22.13 or newer** (the current LTS is fine) and **Git**. Use Chrome or Edge.

```bash
git clone https://github.com/greyUnicornHere/Flicomvp.git
cd Flicomvp
git checkout milestone-0-foundation   # until Milestone 0 is merged into main
npm ci                                # install exact dependency versions
npm run setup                         # creates .env and the local database
npm run invite -- you@example.com     # invite yourself (any address works locally)
npm run dev                           # starts Flico
```

Then open **http://localhost:5173** in Chrome or Edge.

Locally, sign-in emails are **not sent**. After requesting a link, open **http://localhost:5173/dev/outbox** and click **Open sign-in link**. This outbox exists only in development; production refuses to start with it.

Stop Flico with `Ctrl+C` in the terminal.

## Useful commands

| Command | What it does |
|---|---|
| `npm run dev` | Start the API (port 3001) and web app (port 5173) with live reload |
| `npm run invite -- person@example.com` | Invite someone (there is no open sign-up) |
| `npm run invite -- --revoke person@example.com` | Revoke an invitation and sign that person out everywhere |
| `npm run invite -- --list` | List invitations |
| `npm run db:migrate` | Apply database migrations (also applied automatically on start) |
| `npm test` | Unit and API tests |
| `npm run test:e2e` | Browser tests (first time: `npx playwright install chromium`) |
| `npm run lint` / `npm run typecheck` | Code quality checks |
| `npm run build` then `npm start` | Production build and server (needs production settings in `.env`) |
| `npm run check` | Lint, typecheck, tests and build in one go |

System status: **http://localhost:5173/status** (API: `/api/health`).

## Configuration

All settings live in `.env` (created from [`.env.example`](.env.example), never committed). In production Flico refuses to start unless `APP_URL` is an `https://` address and real email (`MAIL_TRANSPORT=smtp` with `SMTP_HOST` and `MAIL_FROM`) is configured. It explains exactly what to fix.

## Project layout

```
client/    React + Tailwind web app (Vite)
server/    Node API (Fastify), SQLite migrations, auth, mail, scripts
shared/    Types shared by client and server
tests/e2e/ Playwright browser tests
docs/      Handoff package and test evidence
```
