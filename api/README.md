# api — Meesho Seller SaaS backend

NestJS 11 + Sequelize v6 (MySQL 8). Milestone 1 (foundation): config validation,
structured logging, error envelope, health check, Swagger, migration tooling.
Milestone 2 (database and tenancy): 14 tables via migrations + Sequelize models, documented in
[`db/SCHEMA.md`](db/SCHEMA.md). No auth, endpoints or imports yet.
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
| `npm run test:e2e` | Migrates the test DB, then e2e tests with `NODE_ENV=test` → `.env.test` (real test DB) |
| `npm run test:db` | Schema/migration tests against the test DB: clean migrate + full rollback, constraints, model drift (leaves it migrated) |
| `npm run db:migrate[:status\|:undo\|:undo:all]` | sequelize-cli against `.env` (or the real env when `NODE_ENV=production`; there `db:migrate:undo:all` and `db:seed:undo:all` are refused by `db/config.js`) |
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
- Models live in `src/database/models` (one per table, registered in `DatabaseModule`); never return a
  model instance from a controller, map it to a DTO. `tsconfig.json` sets
  `useDefineForClassFields: false` so decorated model fields do not shadow Sequelize's attribute
  getters/setters (required by sequelize-typescript with an ES2022+ target).

## Writing migrations

- One concern per migration, CommonJS in `db/migrations`, named `<YYYYMMDDhhmmss>-<verb>-<table>.js`.
  Never edit a migration that has run anywhere shared; add a new one.
- Every migration has a working `down` that exactly reverses `up`. `npm run test:db` runs undo:all and
  migrate again on the test DB; also check `db:test:migrate:undo:all` → `db:test:migrate` by hand.
- Prefer one DDL statement per migration: MySQL DDL commits implicitly, so a multi-statement migration can
  fail half-applied.
- Raw SQL (`queryInterface.sequelize.query`) is fine and needed for composite FKs, named CHECKs,
  collations and `DATETIME(3)`; quote every identifier with backticks.
- Lowercase snake_case names. `id BIGINT UNSIGNED AUTO_INCREMENT`; FK columns `BIGINT UNSIGNED`.
  `created_at` / `updated_at` `DATETIME(3) NOT NULL` (UTC, set by the app; append-only tables have
  `created_at` only). Money `DECIMAL(12,2)` with no default (NULL = not reported).
- Name every constraint: `fk_<table>_<what>`, `uq_<table>_<what>`, `ix_<table>_<what>`,
  `ck_<table>_<what>` (≤ 64 chars). Enumerations are `VARCHAR` + named `CHECK`, not `ENUM`.
- Tenancy: account-scoped tables carry `workspace_id` + `seller_account_id` and the composite FK
  `(workspace_id, seller_account_id) → seller_accounts (workspace_id, id)`; references between
  account-scoped rows use `(seller_account_id, <x>_id) → <parent> (seller_account_id, id)`.
- Default `ON DELETE RESTRICT`; use `CASCADE` only for rows that are not history.
- External identifiers `utf8mb4_bin`, hashes `CHAR(64) ascii_bin`.
- Keep the model, `src/database/models/enums.ts`, `db/SCHEMA.md` and the expectations in
  `test/db/schema.db-spec.ts` in step; the drift spec fails if a model and its table disagree.
