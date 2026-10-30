# api — Meesho Seller SaaS backend

NestJS 11 + Sequelize v6 (MySQL 8). Milestone 1 (foundation) only: config validation,
structured logging, error envelope, health check, Swagger, migration tooling.
The repository-level README covers the whole project.

## Setup

1. Node 24 (see `/.nvmrc`), MySQL 8 with `utf8mb4` databases for dev and test.
2. `cp .env.example .env` and `cp .env.example .env.test`, then fill in real values
   (`.env.test` must point at the test database and use `NODE_ENV=test`).
3. `npm install`

## Scripts

| Command | What it does |
| --- | --- |
| `npm run start:dev` | Watch mode on `PORT` (default 3100) |
| `npm run build` / `npm run start:prod` | Compile to `dist/`, run `node dist/main` |
| `npm run lint` / `npm run typecheck` | ESLint (with `--fix`) / `tsc --noEmit` |
| `npm run lint:check` | ESLint without fixing, fails on any warning (for CI) |
| `npm test` | Unit tests (no database) |
| `npm run test:e2e` | e2e tests with `NODE_ENV=test` → `.env.test` (real test DB) |
| `npm run db:migrate[:status\|:undo\|:undo:all]` | sequelize-cli against `.env` (or the real env when `NODE_ENV=production`) |
| `npm run db:test:migrate[:status\|:undo:all]` | Same, against `.env.test` |

## Endpoints

- `GET /api/v1/health` → 200 `{ status: "ok", db: "up", ... }` or 503 `{ status: "degraded", db: "down", ... }`
- Swagger UI `/api/docs`, OpenAPI JSON `/api/docs-json`

Errors always use `{ "error": { "code", "message", "requestId", "details"? } }`; codes and
their HTTP status live in `src/common/errors/error-codes.ts`. Every response carries an
`x-request-id` header (a valid incoming one is reused).

## Conventions

- Schema changes only via migrations in `db/migrations` (CommonJS). The app never calls `sync()`.
- Read configuration through `AppConfigService`, not `process.env`.
- DECIMAL (money) columns come back as strings; convert deliberately.
