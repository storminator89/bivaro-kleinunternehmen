# Repository Guidelines

## Project Structure & Module Organization
- `app/` hosts Next.js App Router pages and API handlers.
  - `app/api/` – all server-side API routes; each sub-folder maps to a URL path.
  - `app/dashboard/page.tsx` – thin route wrapper; real UI lives in `components/dashboard/`.
- `components/` stores reusable UI; primitives in `components/ui` mirror shadcn scaffolds.
  - `components/dashboard/dashboard-content.tsx` – main dashboard UI (~1300 lines).
  - `components/dashboard/dashboard-query-provider.tsx` – local TanStack QueryClient for the dashboard.
  - `components/dashboard/tabs/` – individual dashboard tab components.
- `hooks/use-dashboard-data.ts` – all dashboard data fetching via TanStack Query (query keys, pagination, invalidation helpers).
- `lib/` holds shared utilities and the Prisma client.
  - `lib/password.ts` – centralised bcrypt hashing (`PASSWORD_HASH_COST = 12`); all password operations must use this.
  - `lib/audit-log.ts` – `createAuditLog` helper and `auditSecurityEvent` for structured security events.
  - `lib/backup-preview.ts` – validates backup shape and returns preview counts/warnings before a restore.
- `prisma/` keeps `schema.prisma`, migrations, and the dev SQLite database (`dev.db`); never commit production data.
  - `prisma/e2e.db` is the isolated E2E test database – created fresh by `npm run e2e:prepare`.
- `e2e/` – Playwright end-to-end tests (`auth-dashboard-invoice.spec.ts`).
- `public/` serves static assets including `public/screenshot/dashboard.png`.
- `proxy.ts` guards protected routes; update it when adding secure areas.

## Build, Test, and Development Commands
- `npm run dev` starts the hot-reloading server at http://localhost:3000.
- `npm run build` compiles the production bundle and performs type checks.
- `npm run start` launches the compiled standalone server (requires prior `npm run build`).
- `npm run lint` runs ESLint with `--max-warnings 0`; zero warnings allowed.
- `npm run test` runs all Vitest unit tests once.
- `npm run test:watch` runs Vitest in watch mode.
- `npm run e2e:prepare` drops and recreates `prisma/e2e.db` with all migrations applied.
- `npm run test:e2e` runs the full Playwright suite (builds the app and starts an isolated server on port 3100).
- `npm run db:migrate` applies pending Prisma migrations to the production database.
- `npm run db:studio` opens Prisma Studio (browser GUI for the local database).
- `npx prisma migrate dev` creates a new migration from schema changes during development.

## Security Rules
- All password hashing **must** go through `lib/password.ts` (`hashPassword` / `PASSWORD_HASH_COST`).
- Every API route that touches user data must call `getServerSession` and check the session role.
- The `GET /api/users` endpoint requires the `ADMIN` role; do not weaken this.
- Use `auditSecurityEvent` from `lib/audit-log.ts` for any security-relevant action (auth, backup, restore).
- Never store secrets in source code; use `.env` (listed in `.gitignore`).

## Testing Guidelines
- Unit tests live in `lib/__tests__/` named `<module>.test.ts`. Currently 166 tests across 7 files.
- Playwright E2E tests live in `e2e/`. Currently tests: first-admin registration, login, dashboard render, invoice dialog.
- Vitest is configured in `vitest.config.ts` with `exclude: ['node_modules/**', '.next/**']` – keep this to prevent build artifacts from being collected.
- Playwright config uses an absolute path for `DATABASE_URL` (`process.cwd()/prisma/e2e.db`) so the standalone server resolves it correctly from `.next/standalone/`.
- `reuseExistingServer: false` is intentional – E2E tests always spin up a fresh isolated server on port 3100.
- Run `npx playwright install chromium` once to install the browser binary.

## Coding Style & Naming Conventions
- Write TypeScript React components with functional patterns and two-space indentation.
- Use `PascalCase` for components, `camelCase` for functions, and reserve `SCREAMING_SNAKE_CASE` for environment constants.
- Prefer the `@/*` path alias in `tsconfig.json` over deep relative imports.
- Compose layouts with Tailwind utility classes; reuse tokens through shadcn components.
- Run `npm run lint` to catch style or type issues before opening a PR.

## Commit & Pull Request Guidelines
- Mirror the existing history with concise, sentence-case subjects (e.g. `Enhance sidebar collapse controls`).
- Keep commits focused; include Prisma schema updates and the regenerated client together.
- Pull requests must describe the problem, solution, test evidence, and database impact; attach UI screenshots for visual changes.
- Link relevant issues or tickets and request review from the domain owner before merging.

## Backlog Progress Documentation
- Assign one participating subagent to maintain the ticket documentation during backlog work, as requested by the user.
- Keep `docs/backlog/TICKETSTATUS.md` and `docs/backlog/ticket-status.json` consistent after each completed work package and before handoff.
- Record the ticket ID, implemented scope, remaining acceptance criteria, actual test results, evidence links, date, and commit or uncommitted state.
- Distinguish implementation, partial implementation, architecture discovery, and untouched tickets; do not mark a ticket complete while required acceptance evidence is missing.
- Link unexpected incidents and unresolved recovery work in the current status. Preserve the supplied audit/backlog source files.

## Environment & Configuration
- Copy `.env.example` when configuring the project; keep secrets out of version control.
- The default SQLite database lives at `prisma/dev.db`; update `DATABASE_URL` when switching providers.
- Every database experiment must pass an explicit `DATABASE_URL` pointing into a newly created temporary fixture directory. Never let a probe inherit the repository `.env` database target; never use `prisma/dev.db` as a test fixture.
- Validate Compose with `docker compose config --quiet`. Do not print or save the resolved configuration, because it contains expanded secrets.
- After altering authentication, uploads, or routing, verify related changes in `proxy.ts`, `next.config.ts`, and affected `app/api` handlers.
- When running the standalone server (`npm run start` or E2E), copy static assets into the standalone directory:
  ```bash
  cp -R public .next/standalone/public
  cp -R .next/static .next/standalone/.next/static
  ```
  This is automated in `npm run test:e2e`.
