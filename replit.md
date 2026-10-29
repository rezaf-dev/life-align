# Align — Adaptive Personal Planning

A personal planning workspace connecting goals, realistic commitments, real-world results, and reviews.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

_Populate as you build — short repo map plus pointers to the source-of-truth file for DB schema, API contracts, theme files, etc._

## Architecture decisions

- Planning data deliberately remains browser-local; AI conversations are stored separately in the browser. The API server is stateless and does not replace or migrate existing planning data.
- Execution and outcomes must remain separate: completing an outreach task must never increase customer or revenue measurements.
- Plan adaptations must preserve original commitments and important changes with reasons; editing should not erase the user's decision history.
- Built-in insights are deterministic observations. Ask Align uses real OpenRouter calls to propose edits, never to silently modify records.
- AI uses `https://openrouter.ai/api/v1`, server-only `OPENROUTER_API_KEY`, and defaults to `openai/gpt-6-luna`. Optional server environment variable `OPENROUTER_MODEL` changes the model explicitly; never silently fall back to another model.
- AI approval is an atomic server-validated transaction returning a workspace snapshot. The client refuses to replace state changed while the request was in flight. Reasons and before/after history are retained for consequential edits; original saved commitments are immutable even when empty.

## Product

Five primary destinations: Overview, Goals, Planner, Tasks & Inbox, and Reviews. Goals, strategies, milestones, independent tasks, manually logged metrics, and reviews share a single planning model.

## User preferences

Keep setup optional and task capture title-only. Use progressive disclosure. Default to polished light mode and support dark mode and smaller screens. Avoid unnecessary infrastructure, gamification, excessive notifications, and decorative analytics. The UX target is a simple, fast, sophisticated, enjoyable everyday personal tool—not an enterprise project management system.

## Gotchas

_Populate as you build — sharp edges, "always run X before Y" rules._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
