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

- Planning data is saved to each approved Clerk account's private PostgreSQL workspace. Every private API checks current approval; membership administration does not expose other users' planning records.
- The configured, verified `ALIGN_OWNER_EMAIL` is the only automatic administrator grant. Owner seeding is idempotent in each Clerk environment; never grant ownership to the first signup. New accounts wait for approval, and rejected/revoked accounts cannot access planning or AI.
- Existing anonymous browser workspace/conversation keys must remain untouched. Only the owner can explicitly import that previous workspace once; never automatically attach it to a new member. New member workspaces start empty.
- AI conversation caches are namespaced by Clerk user ID and cleared from active memory on identity changes. They currently remain browser-specific, while planning records sync between devices with revision checks.
- Execution and outcomes must remain separate: completing an outreach task must never increase customer or revenue measurements.
- Contributions mean explicitly measured results, not weighted completion. Task/milestone contributions are signed metric deltas with source-title snapshots. Milestone rollups include their task results; a goal counts each ledger entry once, never adds overlapping task and milestone totals.
- Completing goal-linked tasks should ask for the actual result before finishing. Use the goal's units and measurement period, show the progress effect, and allow an explicit no-measurable-change choice; never require invented results. Completion, recorded credit, and recurring-task creation must save together and remain safe to retry.
- Work sessions reserve project time separately from concrete tasks. Record actual minutes manually, including unplanned work, without requiring task completion. A session's task allocations plus unallocated remainder count once toward a chosen hours/minutes measure, never a second aggregate credit; sessions can also be time-only. Correct/delete session credits through their session. Recurrence creates a new planned reservation only after logging, not invented hours. Converting an old recurring reminder must be explicit and preserve its past results. Tasks assigned inside a session must not reserve the same planning capacity again.
- Existing metric readings remain absolute checkpoints. Contributions after a checkpoint adjust its value; earlier contributions remain in the attribution history but must not be added again to that checkpoint. Keep source attribution when tasks are renamed, relinked or removed, and retain per-metric units instead of mixing unlike measurements.
- Measurements can be cumulative, weekly (Monday–Sunday), or monthly (calendar month). Missing frequency keeps legacy cumulative behavior. Recurring targets start at zero each period with no carryover; credit actual work by its measurement date, never from estimated task duration.
- Keep effort targets separate from goal completion. Meeting a recurring hours target is not evidence that the project is complete. Historical views and reviews must identify their measurement period.
- New recurring measures have a fixed start date (today by default, or next week/month). Prorate only the first partial calendar period by inclusive active days; keep the usual commitment unchanged and reset normally without carryover. Pace uses completed active days, with “Just started” on the first day and “Not started” before it. Never shrink targets based on today's remaining days. Preserve logged legacy histories; infer a goal start only for empty legacy measures without dated targets. Lock start-date edits once results exist.
- Do not reinterpret stored measurements by changing their frequency once they have entries; add a separate measurement instead. Recurring target changes apply to the current period onward and preserve past-period targets, percentages, and frozen review snapshots.
- Plan adaptations must preserve original commitments and important changes with reasons; editing should not erase the user's decision history.
- Built-in insights are deterministic observations. Ask Align uses real OpenRouter calls to propose edits, never to silently modify records.
- AI task planning must follow the existing strategy, prioritize measurable remaining work, and link relevant tasks to incomplete milestones by their deadlines. A starter list is not a complete plan: explain quantity coverage, assumptions, existing commitments and any gap. Planned quantities never count as actual measured results.
- AI uses `https://openrouter.ai/api/v1`, server-only `OPENROUTER_API_KEY`, and defaults to `openai/gpt-6-luna`. Optional server environment variable `OPENROUTER_MODEL` changes the model explicitly; never silently fall back to another model.
- AI approval is an atomic server-validated transaction returning a workspace snapshot. The client refuses to replace state changed while the request was in flight and waits for the account save before reporting success. Concurrent saves never silently overwrite another device's version; offer backup/reload on conflict. Reasons and before/after history are retained for consequential edits; original saved commitments are immutable even when empty.

## Product

Five primary destinations: Overview, Goals, Planner, Tasks & Inbox, and Reviews. Goals, strategies, milestones, independent tasks, manually logged metrics, and reviews share a single planning model.

## User preferences

Keep setup optional and task capture title-only. Use progressive disclosure. Default to polished light mode and support dark mode and smaller screens. Avoid unnecessary infrastructure, gamification, excessive notifications, and decorative analytics. The UX target is a simple, fast, sophisticated, enjoyable everyday personal tool—not an enterprise project management system.

Goal reports are primarily for understanding progress, completed work, remaining work, and what needs attention—not just timesheets. Client timesheets are optional, scoped to a specific hours/minutes measure and inclusive date range. Export actual work once, never reservations, estimates, or absolute measurement checkpoints. Keep private notes out of client documents unless explicitly included.

Time tracking supports hourly client work, but timers must remain optional alongside manual addition and full correction. A timer is an uncredited draft until reviewed and saved. Preserve elapsed seconds without hidden billing rounding, exclude paused intervals, and split work across local-calendar midnight/month boundaries in its captured time zone. Keep a single active timer per account, protect saves with workspace revision checks, and never treat task completion as permission to add duplicate time. Forgotten long timers need explicit review, not automatic idle deductions.

## Gotchas

_Populate as you build — sharp edges, "always run X before Y" rules._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
