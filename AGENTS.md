# Repository Guidelines

## Project Structure & Module Organization
- `app/` hosts Next.js routes and API handlers for dashboards and auth flows.
- `components/` stores reusable UI; primitives in `components/ui` mirror shadcn scaffolds.
- `lib/` holds shared utilities and the Prisma client.
- `prisma/` keeps `schema.prisma`, migrations, and the dev SQLite database (`dev.db`); never commit production data.
- `public/` serves static assets including `public/screenshot/dashboard.png`.
- `middleware.ts` guards protected routes; update it when adding secure areas.

## Build, Test, and Development Commands
- `npm run dev` starts the hot-reloading server at http://localhost:3000.
- `npm run build` compiles the production bundle and performs type checks.
- `npm run start` launches the compiled app.
- `npm run lint` runs the Next.js ESLint configuration; fix warnings before pushing.
- `npx prisma migrate dev` applies schema updates and regenerates the Prisma client.
- `npx prisma studio` opens a browser UI for the local SQLite database.

## Coding Style & Naming Conventions
- Write TypeScript React components with functional patterns and two-space indentation.
- Use `PascalCase` for components, `camelCase` for functions, and reserve `SCREAMING_SNAKE_CASE` for environment constants.
- Prefer the `@/*` path alias in `tsconfig.json` over deep relative imports.
- Compose layouts with Tailwind utility classes; reuse tokens through shadcn components.
- Run `npm run lint` to catch style or type issues before opening a PR.

## Testing Guidelines
- The repository currently has no automated tests; add coverage alongside new features.
- Store unit tests next to their modules (`<name>.test.tsx`) and place broader workflow checks in a `tests/` folder.
- Prefer React Testing Library with Jest for UI and hooks, and Playwright for end-to-end auth and dashboard flows.
- Document manual verification steps in the PR when automation is not feasible.

## Commit & Pull Request Guidelines
- Mirror the existing history with concise, sentence-case subjects (e.g. `Enhance sidebar collapse controls`).
- Keep commits focused; include Prisma schema updates and the regenerated client together.
- Pull requests must describe the problem, solution, test evidence, and database impact; attach UI screenshots for visual changes.
- Link relevant issues or tickets and request review from the domain owner before merging.

## Environment & Configuration
- Copy `.env.example` when configuring the project; keep secrets out of version control.
- The default SQLite database lives at `prisma/dev.db`; update `DATABASE_URL` when switching providers.
- After altering authentication, uploads, or routing, verify related changes in `middleware.ts`, `next.config.ts`, and affected `app/api` handlers.
