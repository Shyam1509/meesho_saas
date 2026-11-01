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
| 2 | Database and tenancy: identity/workspace/account/import tables, domain tables | Done (14 tables, see [`api/db/SCHEMA.md`](api/db/SCHEMA.md)) |
| 3 | Auth and workspace authorization (owner/member), cross-tenant denial tests | Done (sign-in, workspaces, seller accounts; see `api/README.md`) |
| 4 | Import pipeline: CSV orders, XLSX settlements, preview, validation, idempotency, status history | Done (built on synthetic files; verify with real Meesho exports) |
| 5 | Orders, settlements, reconciliation | Done (matching by sub order no.; supersession deferred) |
| 6 | Products, effective-dated costs, expenses | Done (one product per SKU; costs per unit from a date) |
| 7 | Dashboard, account comparison, CSV reports | Done (formulas documented in `api/README.md`) |
| 8 | UX hardening | Not started |
| 9 | Release readiness | Not started |

What works today:
- **Sign-in**: create an account (when registration is enabled), sign in, sign out. Every screen and API endpoint
  except health and the sign-in endpoints requires a session.
- **Workspaces**: each user owns or belongs to workspaces with the role `owner` or `member`; a switcher in the header
  picks the current one. Workspace settings shows the name (owners can rename it) and a read-only member list.
- **Seller accounts**: list the workspace's Meesho accounts; owners add, edit, disable and re-enable them. Changes
  are recorded in the audit log.
- **Imports**: upload a Meesho orders report (`.csv`) or settlement workbook (`.xlsx`) for a seller account, check
  the preview (counts, recognised and ignored columns, sample rows, row-level errors), then confirm or discard it.
  Orders are upserted by sub-order number with a status history; settlement rows are stored once each. History of
  every upload per account, with an import detail page.
- **Orders**: search, filter (status, order date, with/without a matched settlement), sort and page through each
  account's orders; an order page shows its fields, full status history with the import each status came from, and
  the settlement entries matched to it with the settled amount (as reported).
- **Settlements & reconciliation**: every settlement entry with all reported amounts (TCS/TDS as their own columns)
  and a total of the filtered entries; repeated transaction IDs stay separate rows. Entries are matched to orders by
  sub order no. automatically after every import; the reconciliation tab shows matched / unmatched / account-level
  counts and sums, unmatched entries (owners can match one to an order by hand), orders without a matched
  settlement, and a log of matching runs. Owners can also unmatch an entry; automatic matching then leaves it alone.
- **Products & costs**: every SKU in the imported orders becomes a product automatically (older orders with that
  SKU are linked too; "Sync from orders" covers anything imported earlier). Owners record each product's unit cost
  with the date it applies from; an order's product cost = the unit cost in effect on its order date × quantity.
  An order with no cost on that date shows "Unknown cost", never ₹0, and products with such orders can be filtered.
- **Expenses**: owners add, edit and delete expenses for one seller account or for the whole workspace; members can
  view them. Categories deliberately exclude what the settlement workbook already deducts (Meesho commission,
  shipping, ads, TCS/TDS, recoveries) and product purchase cost, so nothing is counted twice.
- **Overview dashboard**: for one seller account or the whole workspace, a date range (presets or custom) and a
  basis (by order date or by payment date): orders and units, order value (as reported), settlement amount (as
  reported, broken down by entry type, with TCS/TDS shown separately), known product cost, expenses, and an
  **estimated contribution** = settlement amount − known product cost − expenses. It is marked "Incomplete
  because …" (with counts and links) when orders lack a cost or a settlement, entries are unmatched, prices are
  missing, or orders are cancelled/RTO/returned (their cost is still deducted). A trend chart (day/week/month) and
  an account comparison table with totals; every number links to the filtered list behind it. Not a bank payout
  and not tax advice.
- **Reports**: CSV downloads of orders, settlement entries and expenses that follow the chosen filters (UTF-8 for
  Excel, formula-safe cells, up to 100 000 rows; two downloads at a time).
- `GET /api/v1/health` (API + database check), Swagger UI, and an API status panel at the bottom of the Overview.

The exact metric definitions are in `api/README.md` ("Dashboard and reports"). Amounts are as reported by Meesho or
entered by you; nothing is inferred when a value is missing.

## Architecture

```
meesho_saas/
  api/       NestJS 11 REST API under /api/v1 (TypeScript)
    src/       config/ (env validation), common/ (errors, logging, http), database/ (+ models/), health/,
               auth/ (+ csrf/), authorization/, audit/, workspaces/, seller-accounts/, imports/, orders/,
               settlements/, reconciliation/, products/, expenses/, dashboard/, reports/
    db/        sequelize-cli: config.js, migrations/, seeders/ (CommonJS: the CLI cannot run TS), SCHEMA.md
    test/      e2e tests (supertest) and db/ schema tests, both against the real test database
  web/       Angular 21 standalone app + Tailwind CSS 4
    src/app/   core/ (API client, auth state + guards, workspaces, seller accounts, health, title), layout/shell,
               features/ (auth, overview dashboard, seller-accounts, settings, imports, orders, settlements,
               products, expenses, reports), shared/
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
     powershell -ExecutionPolicy Bypass -File scripts\dev-mysql.ps1 init     # once: data dir, random passwords, DBs, users
     powershell -ExecutionPolicy Bypass -File scripts\dev-mysql.ps1 start
     powershell -ExecutionPolicy Bypass -File scripts\dev-mysql.ps1 status
     powershell -ExecutionPolicy Bypass -File scripts\dev-mysql.ps1 stop
     ```
     It creates one user per database: `meesho_app` (only `meesho_dev`) and `meesho_test_app` (only
     `meesho_test`), so the tests physically cannot reach the development database. `init` writes the generated
     credentials to `root.cnf`, `app.cnf`/`app.secret` and `test.cnf`/`test.secret` in that folder (readable only
     by your Windows account), never into the repository.
   - *Any other MySQL 8 server*: as an admin user, run (choose your own passwords):
     ```sql
     CREATE DATABASE meesho_dev  CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
     CREATE DATABASE meesho_test CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
     CREATE USER 'meesho_app'@'localhost'      IDENTIFIED BY '<choose-a-password>';
     CREATE USER 'meesho_test_app'@'localhost' IDENTIFIED BY '<choose-another-password>';
     GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, DROP, ALTER, INDEX, REFERENCES,
           CREATE TEMPORARY TABLES, LOCK TABLES, CREATE VIEW, SHOW VIEW
       ON meesho_dev.*  TO 'meesho_app'@'localhost';
     GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, DROP, ALTER, INDEX, REFERENCES,
           CREATE TEMPORARY TABLES, LOCK TABLES, CREATE VIEW, SHOW VIEW
       ON meesho_test.* TO 'meesho_test_app'@'localhost';
     ```
3. **API environment**: in `api/`, copy `.env.example` to `.env` (development database, `meesho_app`) and again
   to `.env.test` (`NODE_ENV=test`, `DB_NAME=meesho_test`, `DB_USER=meesho_test_app`). Fill in real values. Both
   files are git-ignored.
4. **Install** (in `api/` and in `web/`): `npm ci`.
   If the drive holding npm's cache is full, point it elsewhere first, e.g. `set npm_config_cache=D:\npm-cache`.
5. **Create the tables**: `npm run db:migrate` (development) in `api/`; the test scripts migrate the test database
   themselves. `npm run db:migrate:status` should list 19 migrations as `up`.
6. **Run**: `npm run start:dev` in `api/` (http://localhost:3100) and `npm start` in `web/` (http://localhost:4310,
   which proxies `/api` to the API).
7. **First user**: set `AUTH_REGISTRATION_ENABLED=true` in `api/.env`, open http://localhost:4310, choose
   "Create an account". This creates your user, a workspace you own, and signs you in. Keep registration off
   anywhere other people can reach the API.

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
| `CORS_ORIGINS` | no | `http://localhost:4310` | Comma-separated allowed browser origins (must include the web app's origin) |
| `LOG_LEVEL` | no | `info` | `fatal`…`trace` or `silent`; always silent under `NODE_ENV=test` |
| `AUTH_REGISTRATION_ENABLED` | no | `false` | Allow `POST /auth/register` (self sign-up) |
| `COOKIE_SECURE` | no | `true` in production, else `false` | Secure session cookie (`__Host-` name); `false` is refused in production |
| `SESSION_IDLE_MINUTES` | no | `720` | Sign out after this much inactivity |
| `SESSION_ABSOLUTE_HOURS` | no | `168` | Sign out this long after sign-in, regardless of activity |
| `AUTH_RATE_LIMIT_PER_MINUTE` | no | `10` | Sign-in and sign-up requests per minute per client IP |
| `IMPORT_MAX_FILE_MB` | no | `10` | Largest import file in MB (1 to 50) |
| `IMPORT_MAX_ROWS` | no | `50000` | Most data rows in one import file, all sheets together |
| `REPORT_MAX_ROWS` | no | `100000` | Most rows in one CSV export (larger exports are refused: narrow the filters) |

`api/.env.example` holds placeholders only. Never commit `.env` files, credentials or production data.

## Database: migrations and rollback

Run from `api/`. Plain scripts use `.env` (or real environment variables when `NODE_ENV=production`);
`db:test:*` scripts always use `.env.test`. Applied migrations are recorded in the `sequelize_meta` table.

| Command | What it does |
| --- | --- |
| `npm run db:migrate` / `npm run db:test:migrate` | Apply pending migrations |
| `npm run db:migrate:status` / `npm run db:test:migrate:status` | List applied and pending migrations |
| `npm run db:migrate:undo` | Roll back the last migration (dev DB) |
| `npm run db:migrate:undo:all` / `npm run db:test:migrate:undo:all` | Roll back every migration (refused when `NODE_ENV=production`) |

There are 19 migrations (`api/db/migrations`): 15 create one table each, 2 add import columns, 1 adds the
settlement "auto-match blocked" flag, 1 adds a covering index for the dashboard's payment-date queries. Every one has a tested `down`: `npm run test:db`
migrates an empty test database, rolls everything back and migrates again. Table design, keys, delete rules and the
idempotency rules for orders, status history and settlements are documented in
[`api/db/SCHEMA.md`](api/db/SCHEMA.md); conventions for new migrations are in `api/README.md`.

To target the test database, always use the `db:test:*` scripts: calling `sequelize-cli --env test` directly
would still read `.env`. Under `NODE_ENV=test` the API and the migration tool both refuse a database name that does
not end in `_test`.

## Development commands

| Where | Command | What it does |
| --- | --- | --- |
| `api/` | `npm run start:dev` | API in watch mode |
| `api/` | `npm run build`, then `npm run start:prod` | Compile to `dist/` and run it |
| `api/` | `npm run lint` / `npm run lint:check` | ESLint with auto-fix / check only, fails on warnings |
| `api/` | `npm run typecheck` | `tsc --noEmit` |
| `api/` | `npm test` | Unit tests (no database) |
| `api/` | `npm run test:e2e` | Migrates the test database, then e2e tests against `meesho_test` |
| `api/` | `npm run test:db` | Schema tests against `meesho_test`: clean migrate + full rollback, constraints, tenancy, model drift |
| `web/` | `npm start` | Dev server on http://localhost:4310 |
| `web/` | `npx ng lint` | angular-eslint (TS, templates, template accessibility) |
| `web/` | `npx tsc --noEmit -p tsconfig.app.json` | Type-check |
| `web/` | `npx ng test --watch=false` | Unit tests (Vitest + jsdom, no browser needed) |
| `web/` | `npx ng build` | Production build to `web/dist/web/browser` |

## API documentation

With the API running: Swagger UI at http://localhost:3100/api/docs, OpenAPI JSON at
http://localhost:3100/api/docs-json. All endpoints are under `/api/v1`.

## Import workflow (Milestone 4)

Upload → detect the report type (`.csv` orders, `.xlsx` settlement workbook, checked by content too) → safety limits
(file size, rows, columns, workbook size and structure) → find the header row and map columns by name → normalise
dates, amounts and text → preview with row-level errors (row, sheet, field, reason) → the user confirms → one
transaction writes orders, status events and settlement entries → summary. Nothing is written before confirm.

- **Orders CSV** needs "Sub Order No", "Order Date", "Quantity" and a status column ("Reason for Credit Entry",
  "Order Status" or "Status"), plus the **"Statuses as of"** date (the day you downloaded the report). An order's
  current values only move forward: a report older than what is saved adds history but changes nothing.
- **Settlement workbook**: sheets "Order Payments", "Ads Cost", "Referral Payments" and "Compensation and Recovery"
  are read; "Disclaimer" and other sheets are listed as ignored. Each row becomes one entry identified by a
  fingerprint of its required columns, so re-importing an overlapping workbook adds nothing; repeated transaction
  IDs stay separate entries.
- **Same file twice** for an account is refused. Rows with errors are imported only if you tick "skip rows with
  errors"; a database failure rolls everything back and the import can be retried.
- Amounts are stored exactly as reported (`₹`, Indian or Western thousands separators); a blank amount stays
  "missing", never 0. Dates: `DD-MM-YYYY`, `DD/MM/YYYY`, `YYYY-MM-DD`, `DD Mon YYYY` or Excel dates.
- The raw file is not stored; only the recognised columns of each row are kept. Header names and limits are in
  `api/README.md`.

## Limitations (current)

- The estimated contribution is only as good as the inputs: order value's unit-vs-line meaning is unconfirmed, the
  cancelled/RTO/returned check is a keyword match on Meesho's raw status (CANCEL, RTO, RETURN) until real files
  confirm the statuses, and there is no bank-payout evidence yet. Export and import limits are kept in memory
  (one API instance).
- One product per SKU: several SKUs cannot share a product, and a product's cost is per unit only. Orders imported
  before Milestone 6 whose SKU never appears in a later import stay without a product until "Sync from orders".
- Settlement entries are matched to orders only by exact sub order no. Revised estimates are not detected yet
  (supersession is deferred until real files show how Meesho revises them); totals already skip any entry marked as
  superseded. Order statuses are kept exactly as reported (e.g. `DELIVERED` and `Delivered` are different values).
- Member management (invite, change role, remove), password change and reset, signing out other sessions and email
  verification are not built yet. Registration reveals whether an email is already registered (409); it is off by
  default and rate-limited for that reason.
- Sign-in rate limits are kept in memory, so they only work with a single API instance, and the API does not yet
  trust a reverse proxy's client IP (Milestone 9). Only plain ASCII email addresses are accepted.
- **No real Meesho report has been imported yet.** The column names come from the blueprint and synthetic test files;
  real exports may need extra header aliases (one profile file, `api/src/imports/profiles/meesho-profiles.ts`). The
  preview lists recognised, missing and ignored columns so a mismatch is visible before confirming. Prices are
  stored as reported; whether they are per unit or per line is still to be confirmed from real files.
- An import interrupted by a crash stays "importing" until it can be retried or discarded after 15 minutes.
  Upload limits (2 parses at a time, 20 uploads per minute per IP) are kept in memory, per API instance.
- Some rules MySQL cannot enforce are left to application code: a settlement entry must not supersede itself
  (MySQL forbids CHECKs on AUTO_INCREMENT columns), and status history should advance only by report date.
- One application user can run migrations and modify every table; a separate runtime user without DDL (and without
  UPDATE/DELETE on append-only tables) is planned for Milestone 9.
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
- The application connects as a least-privilege MySQL user, never root; development and tests use separate users,
  each limited to its own database.
- Tenant isolation is enforced in the database too: account-scoped rows carry `workspace_id` + `seller_account_id`
  with composite foreign keys, so a row cannot reference another workspace's account, order, product, import job or
  source row. No table stores Meesho passwords, cookies, tokens or OTPs (a schema test checks this).
- Logs never contain request or response bodies; credential headers are redacted.
- Client errors are safe to show; stack traces stay in server logs.
- Passwords are hashed with Argon2id (12 to 128 characters). Sessions are server-side: the browser holds a random
  token in an `HttpOnly`, `SameSite=Strict` cookie and the database stores only its SHA-256 hash, so sign-out and
  disabling a user take effect immediately. Sessions end after 12 hours idle or 7 days.
- Cross-site request forgery is blocked three ways: the `SameSite=Strict` cookie, a double-submit token
  (`msaas_xsrf` cookie echoed in the `X-XSRF-TOKEN` header on every POST/PUT/PATCH/DELETE), and an `Origin` check
  against `CORS_ORIGINS`.
- Authorization is checked in the API for every workspace and account request, from the signed-in user's
  membership: someone outside a workspace gets 404 (its existence is not revealed), a `member` attempting an
  `owner` action gets 403. Tests prove both for every endpoint.
- Sign-in failures give one message for unknown email and wrong password. Repeated failures are limited per email
  and client IP, plus a looser cap per email, and per IP overall. API responses are sent with
  `Cache-Control: no-store`. Details and remaining limits: `api/README.md`.
- No automated Meesho login, OTP interception, scraping, or stored seller passwords/cookies.
