# meesho_saas

A multi-tenant SaaS dashboard for a seller who runs several Meesho seller accounts. It consolidates orders,
settlements, returns/RTO, product costs, expenses and reconciliation, and compares accounts side by side.
Data comes from the seller's own report downloads (CSV/XLSX); there is no automated Meesho login, scraping
or private API use.

Financial accuracy and traceability come before visual polish: every total must be traceable to source rows,
missing product costs make profit "incomplete" rather than zero, and gross sales, settlement amount, bank payout
and profit are never mixed up.

## Feature status

| Milestone | Scope | Status |
| --- | --- | --- |
| 0 | Repository audit | Done |
| 1 | Foundation: NestJS + Angular structure, env validation, logging, health endpoint, Swagger, MySQL connection, migration tooling | Done |
| 2 | Database and tenancy: identity/workspace/account/import tables, domain tables | Not started |
| 3 | Auth and workspace authorization (owner/member), cross-tenant denial tests | Not started |
| 4 | Import pipeline: CSV orders, XLSX settlements, preview, validation, idempotency, status history | Not started |
| 5 | Orders, settlements, reconciliation | Not started |
| 6 | Products, effective-dated costs, expenses | Not started |
| 7 | Dashboard, account comparison, CSV reports | Not started |
| 8 | UX hardening | Not started |
| 9 | Release readiness | Not started |

What works today: `GET /api/v1/health` (API + database check), Swagger UI, the Angular app shell with all nine
screens in the navigation, and an Overview panel showing live API/database status. Every other screen is a
placeholder that names the milestone it is planned for.

## Architecture

```
meesho_saas/
  api/       NestJS 11 REST API under /api/v1 (TypeScript)
    src/       config/ (env validation), common/ (errors, logging), database/, health/
    db/        sequelize-cli: config.js, migrations/, seeders/ (CommonJS: the CLI cannot run TS)
    test/      e2e tests (supertest, real test database)
  web/       Angular 21 standalone app + Tailwind CSS 4
    src/app/   core/ (API token, health service, title), layout/shell, features/, shared/
  scripts/   dev-mysql.ps1, an optional local MySQL helper for Windows
```

Layers (blueprint §4): Angular pages and typed API services → NestJS controllers (thin) → domain services →
Sequelize models and migrations → MySQL 8 with tenant-scoped constraints. Schema changes go only through
migrations; the API never calls `sequelize.sync()`.

Cross-cutting pieces already in place in `api/`:
- **Config**: all environment variables are validated at startup (`src/config/env.validation.ts`). A missing or
  invalid variable stops the API with an error naming the variable, never its value.
- **Errors**: every error response is `{ "error": { "code", "message", "requestId", "details"? } }`. The
  code-to-status map lives in `src/common/errors/error-codes.ts`. 5xx responses never include internal details.
- **Logging**: structured JSON logs (pino). Each request gets an `x-request-id` (a well-formed incoming one is reused)
  that appears in the logs, the response header and error bodies. `authorization`, `cookie` and `set-cookie`
  headers are redacted; request and response bodies are never logged.

## Supported versions

| Component | Version used |
| --- | --- |
| Node.js | 24 (`.nvmrc`). Angular 21 needs ^20.19, ^22.12 or ^24; nestjs-pino needs ≥ 22.12 |
| npm | 11 |
| MySQL | 8.0 (developed on 8.0.46), `utf8mb4` |
| NestJS | 11.x; Sequelize 6.37 + sequelize-typescript 2.1 + mysql2 3.x; sequelize-cli 6.6 |
| Angular | 21.2.x; Tailwind CSS 4.3; Vitest 4 (jsdom) for unit tests; angular-eslint 21 |

## Local setup

1. **Node 24**: `nvm use 24`.
2. **MySQL 8 with two databases**: `meesho_dev` for development and `meesho_test` for tests, both `utf8mb4`.
   - *Windows helper (optional)*: if MySQL Server 8.0 is installed, `scripts/dev-mysql.ps1` runs a separate
     instance as your user, without touching any MySQL Windows service. By default it uses
     `D:\meesho_saas_mysql` on port 3307. Override with `-MySqlHome`, `-MySqlBin`, `-Port` or the
     `MEESHO_MYSQL_HOME` / `MEESHO_MYSQL_BIN` environment variables.
     ```powershell
     powershell -ExecutionPolicy Bypass -File scripts\dev-mysql.ps1 init     # once: data dir, random passwords, DBs, app user
     powershell -ExecutionPolicy Bypass -File scripts\dev-mysql.ps1 start
     powershell -ExecutionPolicy Bypass -File scripts\dev-mysql.ps1 status
     powershell -ExecutionPolicy Bypass -File scripts\dev-mysql.ps1 stop
     ```
     `init` writes the generated credentials to `root.cnf`, `app.cnf` and `app.secret` in that folder, never
     into the repository.
   - *Any other MySQL 8 server*: as an admin user, run (choose your own password):
     ```sql
     CREATE DATABASE meesho_dev  CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
     CREATE DATABASE meesho_test CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
     CREATE USER 'meesho_app'@'localhost' IDENTIFIED BY '<choose-a-password>';
     GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, DROP, ALTER, INDEX, REFERENCES,
           CREATE TEMPORARY TABLES, LOCK TABLES, CREATE VIEW, SHOW VIEW
       ON meesho_dev.*  TO 'meesho_app'@'localhost';
     GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, DROP, ALTER, INDEX, REFERENCES,
           CREATE TEMPORARY TABLES, LOCK TABLES, CREATE VIEW, SHOW VIEW
       ON meesho_test.* TO 'meesho_app'@'localhost';
     ```
3. **API environment**: in `api/`, copy `.env.example` to `.env` (development database) and again to `.env.test`
   (set `NODE_ENV=test` and `DB_NAME=meesho_test`). Fill in real values. Both files are git-ignored.
4. **Install** (in `api/` and in `web/`): `npm ci`.
   If the drive holding npm's cache is full, point it elsewhere first, e.g. `set npm_config_cache=D:\npm-cache`.
5. **Check the database connection**: `npm run db:migrate:status` and `npm run db:test:migrate:status` in `api/`.
6. **Run**: `npm run start:dev` in `api/` (http://localhost:3100) and `npm start` in `web/` (http://localhost:4300,
   which proxies `/api` to the API).

## Environment variables (`api/`)

| Variable | Required | Default | Meaning |
| --- | --- | --- | --- |
| `NODE_ENV` | yes | none | `development`, `test` or `production`. Selects `.env` / `.env.test`; in `production` no env file is read. |
| `PORT` | no | `3100` | HTTP port |
| `DB_HOST` | yes | none | MySQL host |
| `DB_PORT` | yes | none | MySQL port |
| `DB_NAME` | yes | none | Database name |
| `DB_USER` | yes | none | Application user (least privilege, not root) |
| `DB_PASSWORD` | yes | none | Must not be empty |
| `CORS_ORIGINS` | no | `http://localhost:4300` | Comma-separated allowed browser origins |
| `LOG_LEVEL` | no | `info` | `fatal`…`trace` or `silent`; always silent under `NODE_ENV=test` |

`api/.env.example` holds placeholders only. Never commit `.env` files, credentials or production data.

## Database: migrations and rollback

Run from `api/`. Plain scripts use `.env` (or real environment variables when `NODE_ENV=production`);
`db:test:*` scripts always use `.env.test`. Applied migrations are recorded in the `sequelize_meta` table.

| Command | What it does |
| --- | --- |
| `npm run db:migrate` / `npm run db:test:migrate` | Apply pending migrations |
| `npm run db:migrate:status` / `npm run db:test:migrate:status` | List applied and pending migrations |
| `npm run db:migrate:undo` | Roll back the last migration (dev DB) |
| `npm run db:migrate:undo:all` / `npm run db:test:migrate:undo:all` | Roll back every migration |

There are no migrations yet; the first ones arrive in Milestone 2. To target the test database, always use the
`db:test:*` scripts: calling `sequelize-cli --env test` directly would still read `.env`.

## Development commands

| Where | Command | What it does |
| --- | --- | --- |
| `api/` | `npm run start:dev` | API in watch mode |
| `api/` | `npm run build`, then `npm run start:prod` | Compile to `dist/` and run it |
| `api/` | `npm run lint` / `npm run lint:check` | ESLint with auto-fix / check only, fails on warnings |
| `api/` | `npm run typecheck` | `tsc --noEmit` |
| `api/` | `npm test` | Unit tests (no database) |
| `api/` | `npm run test:e2e` | e2e tests against the `meesho_test` database |
| `web/` | `npm start` | Dev server on http://localhost:4300 |
| `web/` | `npx ng lint` | angular-eslint (TS, templates, template accessibility) |
| `web/` | `npx tsc --noEmit -p tsconfig.app.json` | Type-check |
| `web/` | `npx ng test --watch=false` | Unit tests (Vitest + jsdom, no browser needed) |
| `web/` | `npx ng build` | Production build to `web/dist/web/browser` |

## API documentation

With the API running: Swagger UI at http://localhost:3100/api/docs, OpenAPI JSON at
http://localhost:3100/api/docs-json. All endpoints are under `/api/v1`.

## Import workflow (planned, Milestone 4)

Upload → detect report type → parse → validate headers and types → normalize → preview with insert/update/error
counts and row-level errors (row, field, reason) → user confirms → transactional import/upsert plus order status
events → reconciliation refresh → summary. Re-importing the same file is idempotent (file checksum); repeated
order IDs add status observations instead of duplicate orders; settlement transaction IDs are not treated as
unique.

## Limitations (current)

- Only the foundation exists: no authentication, tenancy tables, imports or financial data yet.
- No real Meesho report samples have been tested yet; the import parser will first be built on synthetic fixtures.
- Swagger is served in every environment, including production; to be revisited before release (Milestone 9).
- No production deployment target is defined yet.

## Deployment

Not defined yet (Milestone 9). Already built in: in production the API reads only real environment variables
(no `.env` file) and fails fast on missing ones. Schema changes must be applied with `npm run db:migrate`,
never `sync()`.

## Backup and restore (MySQL)

```bash
# Backup one database
mysqldump --defaults-extra-file=<admin.cnf> --single-transaction --routines --triggers meesho_dev > meesho_dev-backup.sql
# Restore into an existing, empty database of your choice
mysql --defaults-extra-file=<admin.cnf> <target_database> < meesho_dev-backup.sql
```

With the Windows helper, `<admin.cnf>` is `D:\meesho_saas_mysql\root.cnf`. An option file keeps the password off
the command line.

## Security notes

- Passwords, tokens and `.env` files are never committed (see `.gitignore`); `.env.example` has placeholders only.
- The application connects as a least-privilege MySQL user limited to its own databases, not as root.
- Logs never contain request or response bodies; credential headers are redacted.
- Client errors are safe to show; stack traces stay in server logs.
- Planned (Milestone 3): hashed passwords, workspace roles (`owner`, `member`), authorization enforced in API
  services and queries, rate-limited auth endpoints.
- No automated Meesho login, OTP interception, scraping, or stored seller passwords/cookies.
