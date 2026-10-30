# api — Meesho Seller SaaS backend

NestJS 11 + Sequelize v6 (MySQL 8). Milestone 1 (foundation): config validation,
structured logging, error envelope, health check, Swagger, migration tooling.
Milestone 2 (database and tenancy): 14 tables via migrations + Sequelize models, documented in
[`db/SCHEMA.md`](db/SCHEMA.md). Milestone 3 (auth and authorization): server-side sessions, CSRF
protection, rate limiting, workspaces, members and seller accounts with owner/member roles. Milestone 4
(import pipeline): orders CSV and settlement workbook upload → preview → confirm, with idempotency,
transactions and order status history (see [Imports](#imports-milestone-4)).
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

All under `/api/v1`; full request/response shapes in Swagger UI `/api/docs` (OpenAPI JSON `/api/docs-json`).
Everything requires a session unless marked public. ids in JSON are strings; timestamps are ISO-8601 UTC.

| Endpoint | Who | Result |
| --- | --- | --- |
| `GET /health` | public | 200 `{ status: "ok", db: "up", ... }` or 503 `{ status: "degraded", db: "down", ... }` |
| `GET /auth/config` | public | `{ registrationEnabled }` |
| `GET /auth/csrf` | public | 204, sets the `msaas_xsrf` cookie |
| `POST /auth/register` | public | 201 MeResponse + session cookie; 403 when disabled; 409 email taken |
| `POST /auth/login` | public | 200 MeResponse + session cookie; 401 `Invalid email or password.`; 429 |
| `POST /auth/logout` | public | 204; revokes the presented session, clears the cookie |
| `GET /auth/me` | signed in | `{ user, workspaces: [{ id, name, role }] }` |
| `GET` / `POST /workspaces` | signed in | list (with the caller's role) / create (caller becomes owner) |
| `GET /workspaces/:workspaceId`, `.../members` | member | workspace / member list |
| `PATCH /workspaces/:workspaceId` | owner | rename |
| `GET /workspaces/:workspaceId/accounts` | member | seller accounts, all statuses |
| `POST /workspaces/:workspaceId/accounts` | owner | add a seller account (409 on a duplicate name / supplier id) |
| `GET /accounts/:accountId` | member | one seller account |
| `PATCH /accounts/:accountId` | owner | edit / disable / re-enable |
| `DELETE /accounts/:accountId` | owner | disable (idempotent; accounts are never deleted) |
| `GET /imports/config` | signed in | `{ maxFileMb, maxRows }` (upload limits for the client) |
| `POST /accounts/:accountId/imports` | member | multipart upload (`file`; `dataAsOf` = YYYY-MM-DD, required for orders CSV, refused for workbooks) → 201 ImportDetail `previewed`; 400 / 404 / 409 (same file already imported, or account disabled) / 413 / 422 `PARSE_ERROR` (no job created) / 429 (20 uploads per minute per IP, or 2 parses already running) |
| `GET /accounts/:accountId/imports?page&pageSize` | member | `{ items: ImportSummary[], page, pageSize, total }`, newest first |
| `GET /imports/:importId` | member | ImportDetail (summary + `preview`: sheets, planned counts, first 10 rows without errors) |
| `GET /imports/:importId/rows?status&page&pageSize` | member | staged rows in file order; `status` ∈ valid / error / skipped / imported |
| `GET /imports/:importId/errors?page&pageSize` | member | rows with errors (`error`, or `skipped` after a confirm that skipped them) |
| `POST /imports/:importId/confirm` `{ skipErrorRows? }` | member | 200 `completed`; 409 not previewed / no valid rows / errors not acknowledged / file already imported / account disabled; 500 system failure (job becomes `failed`) |
| `POST /imports/:importId/retry` | member | `failed`, or `importing` for more than 15 minutes → runs again from the staged rows → 200 `completed` |
| `POST /imports/:importId/cancel` | member | `previewed` / `failed` / stale `importing` → `cancelled`; deletes the staged rows (the job and its counts stay) |

Every ImportSummary carries `allowedActions` (`confirm` / `retry` / `cancel`), computed by the server: the UI
shows only those buttons.

## Authentication and authorization

- **Passwords**: Argon2id (64 MiB, t=3, p=4), 12–128 characters, no composition rules; rehashed at login
  when the parameters change.
- **Emails**: trimmed, lower-cased, and printable ASCII only (no spaces, control, invisible or fullwidth
  characters; anything else is a 400 on `email`). `users.email`'s `utf8mb4_0900_as_ci` collation ignores
  soft hyphens, zero-width characters and character width, so a lookalike would otherwise match an existing
  row while getting a fresh rate-limit key. Internationalised addresses are not supported.
- **Sessions**: server-side. Login/registration create a `user_sessions` row and set an opaque random token
  (32 bytes, base64url) in the `msaas_sid` cookie (`__Host-msaas_sid` when `COOKIE_SECURE=true`): HttpOnly,
  SameSite=Strict, Path=/, Max-Age = absolute lifetime. Only the token's SHA-256 is stored. A session ends
  on logout, after `SESSION_IDLE_MINUTES` without requests, after `SESSION_ABSOLUTE_HOURS`, or when the user
  is disabled. Login/registration revoke any session the browser presented (no fixation).
- **Default deny**: a global guard requires a valid session on every route; `@Public()` opts out (health,
  auth config/csrf/register/login/logout). No/invalid/expired/revoked session or disabled user → 401.
- **CSRF** (cookie auth needs it): (1) SameSite=Strict session cookie; (2) double submit: every
  POST/PUT/PATCH/DELETE must send header `X-XSRF-TOKEN` equal to the readable `msaas_xsrf` cookie (Angular's
  `withXsrfConfiguration({ cookieName: 'msaas_xsrf', headerName: 'X-XSRF-TOKEN' })`), compared in constant
  time; (3) an `Origin` header, when present on such a request, must be in `CORS_ORIGINS`. Failure → 403.
  Any response to a request without the cookie seeds it (e.g. the first `GET /auth/me`); login, register
  and logout rotate it.
- **Rate limits** (in memory, one instance; a shared store is a Milestone 9 decision), all 429 with
  `Retry-After`:
  - `AUTH_RATE_LIMIT_PER_MINUTE` requests per client IP to login and to register;
  - failed logins, applied whether or not the email exists: 5 per (email, client IP) per 15 minutes block
    that pair only (a stranger cannot lock the real user out of their own IP), and 50 per email from all
    IPs per 15 minutes block the email everywhere (bounds distributed guessing; reaching it also blocks the
    owner until the window ends). IPs are grouped like the throttler (IPv6 by /64).
  - A successful login clears its own (email, IP) counter only. The per-email counter is not cleared: it
    caps the guesses one account can receive per window, so a success must not hand out fresh guesses.
  - Memory is bounded (50,000 pairs, 20,000 emails). When full, expired windows go first, then the
    not-yet-blocked entry with the fewest failures; a blocked entry is never evicted early, so flooding the
    table with new emails evicts the flood's own entries, not a victim's counter. What remains: a
    single-failure entry can be pushed out by a flood, and if every slot holds a blocked entry new keys are
    not tracked until windows expire (filling it takes ~250,000 failed logins in 15 minutes for pairs,
    ~1,000,000 for emails, each also subject to the per-IP limit).
- **No enumeration at login**: unknown email, wrong password and disabled user get the same 401 and the
  same Argon2 work. Registration's 409 does reveal a registered email: accepted, because registration is
  off by default (`AUTH_REGISTRATION_ENABLED`) and rate limited.
- **Roles**: `owner` ⊇ `member`. `WorkspaceAccessService.requireWorkspace` / `requireAccount` resolve a
  client id with one query joined to the caller's membership: not a member (or missing) → 404, member
  without the role → 403. Later queries use only the ids it returns.
- **Audit**: workspace created/renamed and seller account created/updated/disabled/enabled are written to
  `audit_logs` (changed fields only) in the same transaction as the change.
- **Logs**: request URLs are logged without their query string; Cookie, Set-Cookie, Authorization and
  X-XSRF-TOKEN are redacted; login success logs the user id, failures never log the email.
- **Caching**: every `/api/v1` response (errors included) carries `Cache-Control: no-store`.
- Deferred: invitations / role changes, password change and reset, logout of all sessions, email
  verification, CLI user creation, distributed rate limits, `trust proxy` (Milestones 8/9).

### Security notes and known limitations

- The XSRF cookie keeps the name `msaas_xsrf` (no `__Host-` prefix) even when `COOKIE_SECURE=true`,
  because the SPA reads it by that name. It is still Secure, SameSite=Strict and Path=/; a sibling
  subdomain that planted its own value would also need a request from an allowed Origin, which the Origin
  check refuses, and the SameSite=Strict session cookie is not sent on cross-site requests.
- No cap on sessions or workspaces per user (ended sessions are deleted at the next login; active ones
  accumulate until they expire).
- No global cap on concurrent Argon2 operations (64 MiB each); only the per-IP limit protects login and
  register from memory/CPU exhaustion.
- Swagger UI and the OpenAPI JSON are served without authentication (decide for production in M9).
- Rate limiters and the failed-login limiter live in process memory: correct for one API instance only,
  and reset on restart.
- `trust proxy` is not set, so the client IP is the TCP peer. Behind a reverse proxy every client would
  share the proxy's IP for both limits until this is configured (M9).

## Imports (Milestone 4)

> **Built on synthetic fixtures — verify with real Meesho files.** No real Meesho export was available.
> Every header name, sheet name and alias lives in ONE versioned file,
> [`src/imports/profiles/meesho-profiles.ts`](src/imports/profiles/meesho-profiles.ts) (`PROFILE_VERSION` 2),
> taken from the blueprint's list of known columns. The preview shows the recognised, missing-optional and
> ignored columns and sheets, so drift in a real file is visible before anything is imported. Add aliases
> there (and bump the version) once real files have been checked.

**Flow.** upload → detect type → parse → validate headers and values → normalise → preview (job
`previewed`, rows staged in `import_rows`) → confirm → one transaction: orders + status events, or settlement
entries → `completed`. The raw file is never stored (`storage_key` stays NULL); retry re-runs from the staged
rows. Members and owners may upload, confirm, retry, cancel and view; non-members get 404.

**File type** (extension AND content): `.csv` that is valid UTF-8 (BOM allowed) → orders report
(`orders_csv`); `.xlsx` starting with the ZIP signature → settlement workbook (`settlement_xlsx`). Anything
else → 422.

**Limits (denial of service).**
- `IMPORT_MAX_FILE_MB` (default 10; larger → 413) and `IMPORT_MAX_ROWS` non-blank data rows per file (default
  50 000; more → 422), counted as rows arrive, so parsing stops at the cap.
- CSV: more than `IMPORT_MAX_ROWS` + 1000 physical lines (blank ones included) → 422 before parsing; records
  are streamed one at a time (only mapped values are kept); a record over 64 KB or with more than 200 fields
  → 422.
- Workbook: at most 500 ZIP entries and 60 MB uncompressed, checked on the central directory AND by actually
  inflating every entry (16 KB steps); shared strings and styles at most 20 MB each. Sheet names are read
  from `xl/workbook.xml` and its relationships: more than 50 sheets, two sheets on the same part (or a sheet on
  the shared strings / styles), two sheets read as the same kind ("Order Payments" and "Order Payments."), a
  sheet name over 64 characters or a malformed character reference → 422. Only the recognised sheets are then
  streamed through exceljs's streaming reader, fed lazily from views of the validated entries (no copies, no
  temporary files, nothing hidden between entries is read). More than `IMPORT_MAX_ROWS` + 1000 streamed rows,
  or any cell beyond column 200 (even an empty one) → 422 at the first such row.
- At most 2 uploads are parsed at once in the process (else 429 `RATE_LIMITED` "Imports are busy, try again
  in a moment"), and 20 uploads per minute per client IP (429 with `Retry-After`).

**File-level errors** → 422 `PARSE_ERROR`, `details: [{ field, reasons }]` with `field` = `file`, `columns`
(CSV header), `sheets` or `sheets.<Sheet name>`; no job is created. Causes: wrong type, not UTF-8, empty,
malformed CSV quoting, missing required columns, two columns matching one field, no recognised sheet, no data
rows, too many rows / lines / columns, unsafe or unreadable workbook.

**Headers.** Compared lower-case with everything but a–z/0–9 removed. A field matches an exact alias or a
prefix alias (e.g. `supplierlistedprice…`; "Meesho Commission Percentage" is excluded from the commission
amount). CSV: the header is the first row. Workbook: the header is the first of a sheet's first 10 non-empty
rows that contains every required column. Unmapped columns are never stored or logged; only their names appear
in the preview, at most 100 names of at most 100 characters per list, then an "and N more" entry.

| Report | Required columns | Optional |
| --- | --- | --- |
| Orders CSV | Sub Order No, Reason for Credit Entry (or Order Status / Status), Order Date, Quantity (or Qty) | Order No, Catalog ID, Customer State, Product Name, SKU, Size, Supplier Listed Price…, Supplier Discounted Price…, Packet Id |
| Order Payments → `order_payment` | Sub Order No, Transaction ID, Payment Date, Final Settlement Amount (Transaction ID and Payment Date cells may be blank) | Order Date, Total Sale Amount…, Total Sale Return Amount…, Meesho Commission…, Shipping Charge…, TCS, TDS, Recovery, Compensation |
| Ads Cost → `ads_cost` | Total Ads Cost (or Ads Cost), Deduction Date (or Payment Date / Date) | Transaction ID (or Campaign ID) |
| Referral Payments → `referral_payment` | Net Referral Amount (or Referral Amount / Amount), Payment Date (or Date) | Transaction ID, Sub Order No |
| Compensation and Recovery → `compensation` / `recovery` | Amount (or Net Amount), Payment Date (or Date) | Transaction ID, Sub Order No, Type (or Category): mentioning only "recovery" / "compensation" decides, else the sign (< 0 → recovery). A Reason column is not stored. |

"Disclaimer" and any other sheet are listed as ignored.

**Values.** Blank rows (every mapped cell empty) are skipped and not counted; row numbers are as seen in the
file (header counted). A blank cell is NULL (not reported), never 0. Text: Unicode format characters
(zero-width, bidi controls, soft hyphen) removed — also from file names — then trimmed, whitespace collapsed, at
most 64 characters for ids (SKU 128) and 255 for names. Ids that Excel turned into scientific notation
(1.23E+17) or numbers too long to be exact are errors. Amounts: `₹` / `Rs.` / `INR` and spaces are stripped;
thousands separators only in valid Indian (`1,23,456.78`) or Western (`123,456.78`) grouping (anything else,
e.g. `1,23` or `12,5`, is a row error); one leading minus, at most 2 decimals (extra trailing zeros allowed),
up to 9999999999.99; workbook numbers are accepted only when they are a 2-decimal value up to a float artefact
(< 1e-9). Quantity: whole number > 0. Dates → YYYY-MM-DD from YYYY-MM-DD, YYYY-MM-DD HH:mm[:ss], DD-MM-YYYY,
DD/MM/YYYY (always day first: 10/25/2026 is an error, never 25 October), DD Mon YYYY / DD-Mon-YYYY, or workbook
date cells (their UTC date); years 2000–2100. A Sub Order No repeated in one orders file makes the later rows
errors. Row errors are `{ field, reason }` (field key; the reason names the column); the row keeps the raw text
of a bad cell so it can be found.

**Partial-import policy.** Confirm imports all valid rows in ONE transaction. When rows have errors the request
must say `skipErrorRows: true` (else 409); those rows are then recorded as `skipped`. Zero valid rows → 409. Any
failure rolls everything back, the job becomes `failed` with a safe `failureMessage`, the response is 500, and
`POST /retry` runs it again. The confirm transaction runs at READ COMMITTED and its first statement locks the
seller account row (`FOR UPDATE`): one import per account at a time, and an import that waited for another sees
everything the other committed. A job left `importing` by a crash can be retried or cancelled once its
`confirmed_at` is more than 15 minutes old. Cancel deletes the job's staged rows (report data nobody will
import); the job, its counts and its preview summary stay.

**Idempotency.** Uploading a file (same sha256, account and report type) that is already `importing` /
`completed` → 409 naming the earlier import; the generated-column unique key guards confirm as well. The same
file for another account is a separate import. Orders are upserted by (account, Sub Order No). Settlement
entries are inserted by fingerprint v2 = sha256 of [sheet profile key, the sheet's REQUIRED values (Order
Payments: sub-order no, transaction id, payment date, final settlement amount; other sheets: amount and date),
occurrence index among identical tuples in the file]. Optional columns and the entry type never enter it (on
"Compensation and Recovery" the type comes from the optional Type column or the sign), so header drift (a
renamed, added or dropped optional column, a 0 versus a blank) cannot create duplicates: an overlapping
workbook adds only its new rows (repeats are `unchanged`), and two identical rows in one file (a repeated
transaction ID) stay two entries. `transaction_id` is never unique.

**Observation time.** `dataAsOf` (required for an orders CSV, refused for a workbook) is the day the report was
downloaded from Meesho, `YYYY-MM-DD`, not after today in India; `import_jobs.data_as_of` is the END of that day
in India (23:59:59.999 IST). Workbooks use the upload time. Each confirmed orders row records one
`order_status_events` row observed at `data_as_of`. An order's current values move forward only when
`data_as_of >= current_status_observed_at` (an equal time counts as forward; `update` when something changes,
`unchanged` otherwise, the observation time still advances); an older report only adds history (row action
`status_event`, its own count: `planned.historyOnly` / `historyOnlyCount`). A blank cell in a newer report never
erases a value an earlier report gave. Statuses are stored raw (trimmed, case kept); normalisation is M5. Prices are stored as reported
(per unit vs line total still unknown); `product_id`, settlement matching and `is_estimate` stay NULL / false
(M5/M6).

**Audit and logs.** `import.confirmed` (counts) and `import.cancelled` are written to `audit_logs` in the same
transaction. Logs carry the job id, account id, counts and durations: never row values or file names.

**Limitations.**
- A crashed import stays `importing` until someone retries or cancels it after 15 minutes (no automatic
  sweeper). Each confirm/retry writes its own `confirmed_at` as a claim token and may complete (or fail) the
  job only while it still holds it, so a run that is taken over by a stale retry or cancel rolls back.
- The concurrency limit, the upload throttle and the stale-import window are per process (in memory).
- Fingerprint v2 cannot tell apart two rows whose required values are identical except for their order in
  the file: the occurrence index does, so an overlapping file must list such rows in the same order.
- Worksheets must sit in `xl/workbook.xml` / `xl/_rels/workbook.xml.rels` (where every spreadsheet writer puts
  them). Shared strings are cached in memory (bounded by the 60 MB check).
- Settlement entries imported with fingerprint v1 (before this change, test data only) are not matched by v2.
- The preview's planned counts are computed at upload time; confirm recomputes them.

Errors always use `{ "error": { "code", "message", "requestId", "details"? } }`; codes and
their HTTP status live in `src/common/errors/error-codes.ts` (an `ApiException` carries an explicit code,
e.g. `PARSE_ERROR` 422). Every response carries an
`x-request-id` header (a valid incoming one is reused).

## Conventions

- Schema changes only via migrations in `db/migrations` (CommonJS). The app never calls `sync()`.
- Read configuration through `AppConfigService`, not `process.env`.
- New routes are protected by default; mark public ones with `@Public()`. Resolve every workspace/account
  id through `WorkspaceAccessService` and use the returned ids. Validate path ids with `ParseIdPipe`.
- Write timestamps through models, not raw-SQL replacements: Sequelize formats `Date` replacements in the
  machine's local time zone, while models use the connection's UTC setting.
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
