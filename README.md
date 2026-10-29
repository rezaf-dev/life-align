# Align — Adaptive Personal Planning

A personal planning workspace for connecting meaningful goals, realistic weekly commitments, and measurable results.

Built by **[CoreFixLab](https://corefixlab.com)**. Released under the [MIT License](LICENSE).

## Why Align?

Planning should help you make progress, not become another project to manage. Align brings goals, tasks, milestones, measurements, and reviews into one workspace—with an AI assistant that proposes changes for your approval.

It keeps an important distinction clear: **doing the work and achieving the result are not the same thing.**

## Features

- **Goals and milestones** — define outcomes, organize supporting work, and adapt your strategy.
- **Weekly planning** — make realistic commitments based on your available capacity.
- **Tasks and subtasks** — organize work, link it to goals and milestones, and schedule recurring tasks.
- **Measured contributions** — record actual results against tasks or milestones and see how much they contributed to a goal.
- **Flexible measurements** — track cumulative results, weekly targets, or monthly targets, such as **30 project hours per month**.
- **Period history** — browse earlier weeks and months without losing their measurements or targets.
- **Weekly and monthly reviews** — reflect on progress using snapshots of your recorded work and results.
- **AI-assisted planning** — discuss goals, review progress, and approve proposed changes before they are applied.
- **Private workspaces** — each approved account has its own planning data, with server-side access checks.
- **Administrator-approved signup** — new users wait for approval before accessing the planner.
- **Responsive interface** — light and dark themes for everyday use.

### Measurements that reflect real progress

Completing a task never automatically increases a goal's measured results or credits its estimated duration.

Use **Contribution** to record an actual change, such as two hours worked or five customers acquired. Linked task results roll up to their milestone, but each contribution is counted only once toward the goal.

Use **Log current value** or **Log period total** to record an absolute observation. That observation reconciles the total rather than being added as another contribution.

Recurring measurements:

- Start at zero each **Monday–Sunday week** or **calendar month**.
- Credit results to their measurement date, including backdated entries.
- Do not carry excess or shortfalls into the next period.
- Preserve earlier periods' targets when the current target changes.
- Keep effort targets separate from overall goal completion.

Existing cumulative measurements retain their original behavior. Once a measurement has entries, create a separate measurement to use a different frequency rather than reinterpreting its history.

## Technology

| Layer | Stack |
| --- | --- |
| Frontend | React, TypeScript, Vite, Tailwind CSS, Radix UI |
| API | Express, TypeScript, Zod |
| Database | PostgreSQL with Drizzle ORM |
| Authentication | Clerk with application-level approval controls |
| AI | OpenRouter |
| API contracts | OpenAPI with Orval-generated clients and schemas |
| Workspace | pnpm monorepo |

## Repository structure

```text
artifacts/
  adaptive-planner/   React application
  api-server/         API, access controls, and AI operations
  mockup-sandbox/     Optional design-preview workspace
lib/
  api-spec/           OpenAPI specification and code generation
  api-client-react/   Generated frontend API client
  api-zod/            API validation and shared measurement calculations
  db/                 Database schema and connection
scripts/              Workspace tooling
```

## Development setup

### Prerequisites

- Node.js **24**
- pnpm
- PostgreSQL
- A Clerk application with matching frontend and backend credentials
- An OpenRouter API key to enable the AI assistant

Install dependencies from the repository root:

```bash
pnpm install
```

### Environment configuration

Provide the following through your environment or hosting platform's secret manager. Do not commit credentials to Git.

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string |
| `CLERK_SECRET_KEY` | Backend Clerk credential; keep secret |
| `CLERK_PUBLISHABLE_KEY` | Backend Clerk application configuration |
| `VITE_CLERK_PUBLISHABLE_KEY` | Frontend publishable key for the same Clerk application |
| `ALIGN_OWNER_EMAIL` | Verified account email eligible for automatic administrator access |
| `OPENROUTER_API_KEY` | AI assistant credential; optional for manual planning |
| `OPENROUTER_MODEL` | Optional override for the assistant model |
| `PORT` | Required port for each service; use different ports when running them together |
| `BASE_PATH` | Required frontend base path, such as `/` |

The frontend also accepts `VITE_CLERK_PROXY_URL` when your Clerk setup requires a proxy.

Only publishable configuration belongs in `VITE_` variables: Vite includes those values in the browser bundle. Never put secret keys there.

The API reads its process environment; simply creating a root `.env` file does not load it automatically. Supply the variables to each process that needs them.

### Initialize a development database

With `DATABASE_URL` configured:

```bash
pnpm --filter @workspace/db run push
```

This command changes the connected database schema. Use a development database; review schema changes before applying them to a live database.

### Start the services

Run these in separate terminals with the appropriate environment variables available:

```bash
# API
PORT=8080 pnpm --filter @workspace/api-server run dev
```

```bash
# Frontend
PORT=5173 BASE_PATH=/ pnpm --filter @workspace/adaptive-planner run dev
```

**Routing matters:** the frontend calls `/api` on its own origin. The current Vite configuration does not proxy those requests to the API server. Your development or hosting router must route `/api/*` to the API and the remaining paths to the frontend.

For example, if you use Caddy for local development:

```caddyfile
http://localhost:8088 {
    handle /api/* {
        reverse_proxy localhost:8080
    }

    handle {
        reverse_proxy localhost:5173
    }
}
```

With that configuration, open `http://localhost:8088`, not the frontend port directly.

For a non-root `BASE_PATH`, configure your router to forward that prefix consistently and strip it where required by the API's `/api` routes.

### Access and approval

Configure `ALIGN_OWNER_EMAIL` before starting the API. Sign in with the matching verified Clerk account to receive administrator access.

Other users can sign up, but remain pending until an administrator approves them. Rejected or revoked accounts cannot access planning data or AI operations. Approval management does not expose another user's private planning workspace.

The application does **not** make the first person who signs up an administrator.

## Checks and builds

```bash
# Type-check workspace packages
pnpm run typecheck

# Run the automated API, access-policy, measurement, and store tests
pnpm --filter @workspace/api-server test

# Regenerate clients and schemas after changing the OpenAPI specification
pnpm --filter @workspace/api-spec run codegen

# Build the application services
pnpm --filter @workspace/api-server run build
PORT=5173 BASE_PATH=/ pnpm --filter @workspace/adaptive-planner run build
```

For production hosting, serve the frontend build with SPA route fallback and route API requests to the backend under the same origin. Configure production database and authentication credentials separately from development.

## Contributing

Issues and pull requests are welcome. Keep changes focused, include relevant tests, and preserve these core principles:

- Planning data stays private to its approved account.
- AI suggestions require explicit approval before being applied.
- Task completion and measured outcomes remain separate.
- Historical measurements and reviews should not be silently rewritten.

## Credits

Created by **CoreFixLab**.

Visit **[corefixlab.com](https://corefixlab.com)**.

## License

Copyright © 2026 CoreFixLab.

Licensed under the **[MIT License](LICENSE)**. You may use, modify, and distribute this software, including commercially, subject to the license terms. Retain the copyright and permission notice in copies or substantial portions of the software.
