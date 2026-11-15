# jester: agent notes

- **Contract first.** `docs/jester.md` in gpdl49/homestacks (a copy is in
  `docs/contract.md` here) is the build contract: names, env vars, data
  model, jobs, HTTP API, pages, object keys. Follow it exactly. These files
  are contracts too and are **frozen** for feature work: `prisma/schema.prisma`
  and migrations, `lib/api/types.ts`, `lib/env.ts`, `lib/settings/index.ts`,
  `lib/immich/types.ts`, job names and payload schemas in
  `lib/jobs/definitions/*`, `lib/jobs/registry.ts`, `components/nav-items.ts`,
  `package.json` / `pnpm-lock.yaml`. If you need one changed, stop and say so
  in your report instead of editing it.
- **Own your slice.** The work breakdown in the contract lists which files
  each slice owns. Touch only those (plus new files under your own
  directories and tests). Browser API calls for your slice go in
  `lib/client/<slice>.ts` on top of `api` from `lib/client/api.ts`; query keys
  come from `lib/client/queries.ts`.
- **Tests with every change.** Unit tests next to the code
  (`lib/**/*.test.ts`, `components/**/*.test.tsx` with
  `// @vitest-environment jsdom`); API, job and database tests in `test/`
  against a real Postgres (`TEST_DATABASE_URL`; the database is wiped, its
  name must contain `test`). Use the shared helpers: `test/helpers/http.ts`
  (requests as a signed-in user), `users.ts`, `factories.ts`, `s3.ts`
  (in-memory S3 with checksum checks), `immich.ts` (in-memory Immich), `db.ts`
  (`describeWithDb`, `resetDb`). Never call the network in tests: inject
  `fetch` or use the fakes. Run `pnpm lint && pnpm typecheck && pnpm test &&
  pnpm build` before every commit; all four must pass.
- **API routes** use `withAuth` + `parseBody`/`parseQuery` from
  `lib/http/handler`, validate with zod in `lib/<slice>/schema.ts`, keep data
  access and rules in `lib/<slice>/service.ts`, and throw `ApiError`s
  (`lib/http/errors`) so every error is `{error, message}`. Admin-only routes
  call `requireAdmin(user)`. `app/api/me/route.ts` is the smallest example.
- **Jobs**: the definitions already exist with stub handlers; replace the
  handler body in your slice's definition files (keep name and schema). Put
  the logic in `lib/<slice>/…` and keep the handler a thin call into it so it
  can be tested without pg-boss. Enqueue with `enqueue(def, data)` from
  `lib/jobs/queue`. Throw `PermanentJobError` for failures that must not retry.
- **AI**: every OpenRouter call goes through `aiCall()` in `lib/ai` (budget,
  pause switch and cost accounting). Use strict JSON-schema output and
  validate the result with zod. Jobs that hit `BudgetExceededError` re-enqueue
  themselves with `startAfter: nextBudgetReset()`.
- **Audit** every user decision and every destructive action with
  `audit()` from `lib/audit`.
- **Settings**: read runtime settings with `getSetting()` from `lib/settings`.
- **Runtime constraints**: the container is read-only except `/tmp` and
  `/app/.next/cache`, runs as UID 65532 and listens on `127.0.0.1:3000`.
- **UI**: Tailwind + Radix + lucide icons and the primitives in
  `components/ui`. Dark-mode aware (`dark:` variants), desktop-first, usable
  on a phone. Each page is a server component that renders a client
  component from `components/<slice>/`.
- Biome formats with tabs; run `pnpm format` before committing.

Commands: `pnpm dev | lint | format | typecheck | test | build | db:migrate | db:deploy`.
