# api — Meesho Seller SaaS backend

NestJS 11 + Sequelize v6 (MySQL 8). Milestone 1 (foundation): config validation,
structured logging, error envelope, health check, Swagger, migration tooling.
Milestone 2 (database and tenancy): 14 tables via migrations + Sequelize models, documented in
[`db/SCHEMA.md`](db/SCHEMA.md). Milestone 3 (auth and authorization): server-side sessions, CSRF
protection, rate limiting, workspaces, members and seller accounts with owner/member roles. Milestone 4
(import pipeline): orders CSV and settlement workbook upload → preview → confirm, with idempotency,
transactions and order status history (see [Imports](#imports-milestone-4)). Milestone 5 (orders and
settlements): order list / detail / status history, settlement entries with as-reported totals, and
settlement ↔ order reconciliation (see [Orders, settlements and reconciliation](#orders-settlements-and-reconciliation-milestone-5)).
Milestone 6 (products, costs and expenses): one product per SKU mapped to orders, effective-dated unit costs
with each order's product cost, and manual expenses without double counting (see
[Products, costs and expenses](#products-costs-and-expenses-milestone-6)).
Milestone 7 (dashboard and reports): documented metrics for one seller account or a whole workspace with an
account comparison, order-date / payment-date basis, trends, and CSV exports of orders, settlements and expenses
(see [Dashboard and reports](#dashboard-and-reports-milestone-7)).
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
| `GET /accounts/:accountId/imports?page&pageSize` | member | `{ items: ImportSummary[], page, pageSize, total }`, newest first (every list: `page` at most 2000, see below) |
| `GET /imports/:importId` | member | ImportDetail (summary + `preview`: sheets, planned counts, first 10 rows without errors) |
| `GET /imports/:importId/rows?status&page&pageSize` | member | staged rows in file order; `status` ∈ valid / error / skipped / imported |
| `GET /imports/:importId/errors?page&pageSize` | member | rows with errors (`error`, or `skipped` after a confirm that skipped them) |
| `POST /imports/:importId/confirm` `{ skipErrorRows? }` | member | 200 `completed`; 409 not previewed / no valid rows / errors not acknowledged / file already imported / account disabled; 500 system failure (job becomes `failed`) |
| `POST /imports/:importId/retry` | member | `failed`, or `importing` for more than 15 minutes → runs again from the staged rows → 200 `completed` |
| `POST /imports/:importId/cancel` | member | `previewed` / `failed` / stale `importing` → `cancelled`; deletes the staged rows (the job and its counts stay) |
| `GET /accounts/:accountId/orders?page&pageSize&sort&status&from&to&q&settlement&paymentFrom&paymentTo` | member | `{ items: OrderSummary[], page, pageSize, total }` (default 25 per page, `-orderDate`) |
| `GET /accounts/:accountId/orders/statuses` | member | `{ items: [{ status, count }] }`: raw current statuses, most orders first |
| `GET /accounts/:accountId/orders/:orderId` | member | OrderDetail (status history, matched entries, first / last import); 404 for an order of another account |
| `GET /accounts/:accountId/orders/:orderId/status-history` | member | `{ items: StatusEvent[] }`, oldest observation first |
| `GET /accounts/:accountId/settlements?page&pageSize&sort&entryType&dateBasis&from&to&q&match&includeSuperseded` | member | `{ items, page, pageSize, total, totals: { settlementAmount, count } }` (default `-paymentDate`; `from` / `to` on the payment date unless `dateBasis=order_date`) |
| `GET /accounts/:accountId/reconciliation` | member | overview: counts and as-reported sums, orders with / without settlement, last run |
| `GET /accounts/:accountId/reconciliation/unmatched-settlements?page&pageSize&sort` | member | entries with a sub order no and no order |
| `GET /accounts/:accountId/reconciliation/orders-without-settlement?page&pageSize&status&sort` | member | orders with no matched, non-superseded entry |
| `GET /accounts/:accountId/reconciliation/runs?page&pageSize` | member | matching runs, newest first |
| `POST /accounts/:accountId/reconciliation/runs` | member | 201 RunSummary (trigger `manual`); 409 account disabled |
| `POST /accounts/:accountId/reconciliation/manual-match` `{ settlementEntryId, orderId }` | owner | 200 SettlementEntry; 404 entry / order not in this account; 409 superseded / account-level entry / account disabled |
| `POST /accounts/:accountId/reconciliation/manual-unmatch` `{ settlementEntryId }` | owner | 200 SettlementEntry; 404; 409 not matched / superseded / account disabled |
| `GET /accounts/:accountId/products?page&pageSize&sort&q&status&cost` | member | `{ items: ProductSummary[], page, pageSize, total }` (default `sku`, `status=active`; `cost=missing\|known\|incomplete`) |
| `POST /accounts/:accountId/products` `{ sku, name?, catalogId? }` | member | 201 ProductDetail (links the account's orders with that SKU); 409 SKU exists (details `sku`) / account disabled |
| `POST /accounts/:accountId/products/sync` | member | 200 `{ createdProducts, linkedOrders }` (idempotent); 409 account disabled |
| `GET /products/:productId` | member | ProductDetail (summary + `costHistory`, newest `effectiveFrom` first) |
| `PATCH /products/:productId` `{ name?, status? }` | member | 200 ProductDetail (`name: null` clears; `archived` / `active`); 409 account disabled |
| `POST /products/:productId/cost-history` `{ effectiveFrom, unitCost, note? }` | owner | 201 CostEntry; 409 a cost already starts that day (details `effectiveFrom`) / account disabled |
| `DELETE /products/:productId/cost-history/:costId` | owner | 204; 404 when the entry is not one of this product |
| `GET /expenses/categories` | signed in | `{ items: [{ key, label, help, descriptionRequired }] }` |
| `GET /accounts/:accountId/expenses?page&pageSize&sort&from&to&category` | member | `{ items: Expense[], page, pageSize, total, totals: { amount, count } }` (default `-expenseDate`) |
| `GET /workspaces/:workspaceId/expenses?…&scope=workspace\|all` | member | same shape; `workspace` (default) = workspace-wide only, `all` = also every account's |
| `POST /accounts/:accountId/expenses`, `POST /workspaces/:workspaceId/expenses` `{ expenseDate, category, description?, amount }` | owner | 201 Expense (scope `account` / `workspace` from the route); 409 account disabled |
| `PATCH /expenses/:expenseId` `{ expenseDate?, category?, description?, amount? }` | owner | 200 Expense (scope and account never change); 409 account disabled |
| `DELETE /expenses/:expenseId` | owner | 204 |
| `GET /accounts/:accountId/dashboard?from&to&basis&status&granularity` | member | Dashboard of one seller account (see [Dashboard and reports](#dashboard-and-reports-milestone-7)); 400 bad dates / range > 731 days / `to` < `from` / bad basis or granularity |
| `GET /workspaces/:workspaceId/dashboard?from&to&basis&status&granularity` | member | Dashboard of every account of the workspace + workspace-wide expenses, with `accounts` (one row per seller account, disabled ones too) |
| `GET /accounts/:accountId/reports/orders.csv?<orders list filters, no page>` | member | CSV download (or 422 `EXPORT_TOO_LARGE`, 429 `RATE_LIMITED` when 2 exports are already streaming); `HEAD` = the row-count check only |
| `GET /accounts/:accountId/reports/settlements.csv?<settlements list filters incl. dateBasis, no page>` | member | CSV download (or 422) |
| `GET /accounts/:accountId/reports/expenses.csv?from&to&category&sort` | member | CSV download (or 422) |
| `GET /workspaces/:workspaceId/reports/expenses.csv?from&to&category&sort&scope=workspace\|all` | member | CSV download (or 422); `scope` default `workspace` (workspace-wide only), `all` adds every account's |

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
  `audit_logs` (changed fields only) in the same transaction as the change; so are imports (M4), manual
  settlement matches / unmatches (M5), and product create / edit / sync, cost rows and expenses (M6).
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
erases a value an earlier report gave. Statuses are stored raw (trimmed, case kept) and M5 keeps them raw (no
normalisation yet). Prices are stored as reported (per unit vs line total still unknown); `is_estimate`
stays false (supersession deferred). Since M5 every completed confirm also runs the settlement ↔ order
matcher in the same transaction (see below); since M6 an orders confirm also creates the missing products
and sets `product_id` by SKU (see Milestone 6).

**Audit and logs.** `import.confirmed` (counts; for an orders CSV also `createdProducts` / `linkedOrders`,
M6) and `import.cancelled` are written to `audit_logs` in the same transaction. Logs carry the job id, account id, counts and durations: never row values or file names.

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

## Orders, settlements and reconciliation (Milestone 5)

> **Amounts are as reported by Meesho, not profit.** Every amount is the value of the source row (DECIMAL text,
> `null` = not reported, never 0). The only arithmetic is a plain `SUM(settlement_amount)`, done by MySQL in
> DECIMAL, over exactly the rows the request selects. TCS / TDS are separate columns and are never netted.
> Estimated contribution (never "profit"): see [Dashboard and reports](#dashboard-and-reports-milestone-7).

**Access.** Reads and "run matching now": members; manual match / unmatch: owner. A non-member gets 404 on every
route. Every query filters on the workspace + account ids that `requireAccount` resolved, so an order or entry
id of another account (even in the same workspace) is 404. Matching changes on a disabled account → 409.
Run / match / unmatch that cannot get the account lock in time (an import holds it: MySQL lock wait timeout
1205) or lose a deadlock (1213) → 409 "An import or another change is running for this account; try again
shortly." (rolled back; not recorded as a failed run).

**Lists.** Offset pagination (`page` 1–2000, `pageSize` 1–100, default 25) with `total`. The 2000-page cap
applies to EVERY list endpoint, imports included (400 above it): deep OFFSET pages make MySQL read and discard
every earlier row (2000 × 100 = 200 000 rows; staged import rows past 40 000 need `pageSize` ≥ 25). A page,
its `total` and its `totals` (and every number of the overview) are read in ONE read-only REPEATABLE READ
transaction, so they agree even while an import commits. `sort` is an allowlisted key,
`-` prefix = descending, ties break on id in the same direction (stable pages); MySQL puts missing dates first
ascending and last descending. Unknown parameters, a bad sort key, a repeated `sort`, an unknown entry type /
match state / settlement filter, a date that is not a real `YYYY-MM-DD`, `to` before `from`, or `q` over 100
characters → 400. Repeatable filters (`status`, `entryType`) are sent as `?status=A&status=B` (at most 50).
- Orders: `sort` ∈ `orderDate` (default `-orderDate`), `subOrderNo`, `currentStatus` (case-insensitive order),
  `updatedAt`; `status` = raw statuses compared exactly (binary, as `GET .../orders/statuses` lists them: `DELIVERED`
  and `Delivered` are different values); `from` / `to` = order date (inclusive); `settlement=matched|unmatched`;
  `paymentFrom` / `paymentTo` (M7) = the order's FIRST payment date (earliest matched, non-superseded entry), the
  dashboard's payment-date order set.
- Settlements: `sort` ∈ `paymentDate` (default `-paymentDate`), `settlementAmount`, `orderDate`, `createdAt`;
  `from` / `to` = payment date, or with `dateBasis=order_date` (M7) the matched order's order date, else the entry's
  own order date, account-level entries by their payment date (the dashboard's order-date basis);
  `match=matched|unmatched|account_level`; `includeSuperseded=true|false` (default false).
- Search `q` (trimmed; blank = no search): sub order no / SKU (orders) or sub order no / transaction id
  (settlements) STARTING WITH the text, exact case (index friendly); orders also match product names
  CONTAINING it, any case. `%` and `_` are escaped and match themselves.

**Totals.** `GET .../settlements` returns `totals: { settlementAmount, count }` over ALL rows matching the filters
(not just the page), always excluding superseded rows, even with `includeSuperseded=true` (then `total` counts
them but `totals.count` does not). `settlementAmount` is `null` when no row is summed. An order's `settlement`
is `{ entryCount, amount }` of its matched, non-superseded entries. Repeated transaction IDs are separate rows
and are each summed.

**Match state** of an entry: `matched` (has an order), `unmatched` (has a sub order no, no order: an exception),
`account_level` (no sub order no: ads, referral, …; never an exception).

**Automatic matching** runs inside every completed import's confirm transaction (orders AND settlement
imports, since either may arrive first), after the import's writes and under the same account row lock, and
records a `reconciliation_runs` row with trigger `import`; `POST .../reconciliation/runs` does the same with
trigger `manual` (its own READ COMMITTED transaction, account row locked first). The rule: an entry with a sub
order no, no order, not superseded and not `auto_match_blocked` gets the order of the same account with the
same sub order no (exact, case-sensitive) → `match_method = 'auto'`, `matched_at`. It never touches an
existing match (auto or manual), so nothing is re-pointed. An import run looks only at what that job can
newly match: a settlement import at its own entries (`import_job_id`), an orders import at entries waiting for
orders it created (`first_import_job_id`); everything matchable before was matched by an earlier confirm. A
manual run checks the whole account (it also picks up entries left unmatched by older code). A run records `matchedCount` (entries it matched)
and, after matching, `unmatchedSettlementCount` and `unmatchedOrderCount`. A failing match rolls the import
back (the job becomes `failed`, retryable); a failing manual run is recorded as a `failed` run.

**Manual match / unmatch** (owner; account row locked; audit row in the same transaction):
- match `{ settlementEntryId, orderId }`: sets `manual`, `matched_by_user_id`, `matched_at` and clears
  `auto_match_blocked`; may re-point an existing match. Same order again → 200 without a change (no audit).
  Audit `settlement_entry.matched` with before / after `{ orderId, matchMethod }`.
- unmatch `{ settlementEntryId }`: clears the match and sets `auto_match_blocked`, so later runs leave the entry
  unmatched until someone matches it by hand. Audit `settlement_entry.unmatched`.
- 404 when the entry or order is not in this account; 409 for a superseded entry, an entry without a sub order
  no (account-level: an ads cost matched to an order would mislead), or unmatching an entry that is not matched.

**Exceptions.** `unmatched-settlements` = entries with a sub order no, no order, not superseded;
`orders-without-settlement` = orders with no matched, non-superseded entry (filter by raw `status`). The
overview counts the same sets.

**Supersession: deferred.** No real file shows how Meesho revises figures (`is_estimate` is never set), so
nothing sets `superseded_by_entry_id` yet. Every total, exception list, order summary and match already
excludes superseded rows, and manual (un)matching refuses them, so a later milestone can add it safely.

**Indexes.** None added. EXPLAIN with 20,000 orders and 20,000 entries in each of two accounts: every query is an
index lookup on the account (`ref` / `range` / `eq_ref` on an existing account-prefixed key: order date, payment
date, order id, sub order no); default pages read in index order and stop at the page size. Counts, sums, the
status filter and search read the account's rows through those keys (no cross-account scans). Matching: an
import run uses `ix_orders_account_first_import_job` / `ix_settlement_entries_account_import_job` (an import
with nothing new to match took 1–2 ms on 20k rows); the manual whole-account pass took 0.2–0.5 s with nothing
left to match.

**Limitations.** Synthetic fixtures only (no real Meesho file yet). Statuses are raw: case and spelling variants
are separate statuses. Settlement search does not look at the matched order's SKU. Runs are synchronous inside
the request and the confirm transaction: on the dev MySQL (READ COMMITTED, two 20k accounts) one job that newly
matches 16,200 entries took ~4.2 s (the row writes themselves), and the after-run exception counts 0.1–0.3 s
per confirm. Batch or queue it if real files are much larger (later decision).

## Products, costs and expenses (Milestone 6)

> **Never 0 for unknown.** A cost that is not known is `null` with state `unknown` (or `no_product`), never 0:
> missing costs make profit incomplete, not falsely precise. A real cost of zero is `0.0000` with state `known`.

**Access.** Reads: members. Product create / edit / sync: members. Cost rows and expenses: owner only. A
non-member gets 404 on every route; a product, cost entry or expense id of another account or workspace is 404
(`/products/:id` and `/expenses/:id` resolve through one query joined to the caller's membership:
`requireProduct` / `requireExpense`). A disabled seller account is read-only: product, cost and account-expense
writes → 409 (workspace-wide expenses are not affected).

**Mapping rule (product = SKU).** One product per (account, SKU); SKUs compare exactly (case-sensitive, as
imported). `orders.product_id` equals the product with the order's SKU in that account, or NULL when the order
has no SKU or the SKU has no product (yet). Every write that creates a product or changes an order's SKU
re-links every order of the account with that SKU, in the same transaction and account lock:
- every orders import confirm: after the order upserts, it creates a product for each SKU of the job's orders
  that has none (name and catalog id from that SKU's latest order in the job with a product name), re-links the
  orders the job observed (an order whose SKU changed in a newer report moves to the right product), then
  re-links EVERY order of the account carrying one of the job's SKUs (e.g. orders imported before M6, so they
  get the new product and its costs; a SKU can never be erased: a blank cell never overwrites a value);
- `POST .../products` (a SKU not seen yet): links the account's existing orders with exactly that SKU;
- `POST .../products/sync` (members, idempotent): the same for every SKU of the account. Needed only for data
  imported before M6 whose SKU appears in no later import: until then those orders are `no_product` (their SKU
  has no product, so the rule still holds).

Auto-creation never updates an existing product, so a name a user edited is never overwritten. The SKU of a
product never changes and products are never deleted. **Archived products** only leave the default list: their
orders stay mapped, new orders with their SKU are still linked to them, and their costs still apply to those
orders (archive is a display choice, not "stop costing"). Several SKUs → one product is not supported. Every product write (and the import confirm) runs in a
READ COMMITTED transaction whose first statement locks the seller account row (`inAccountTransaction`, shared with
M5 reconciliation), so writes of one account are serialised; lock timeout / deadlock → 409, retry.

**Cost rule.** Unit cost on date D = the cost row with the greatest `effectiveFrom <= D` (`db/SCHEMA.md`); no
such row → unknown. Order product cost = unit cost on the ORDER date × quantity, computed by MySQL in DECIMAL and
returned exactly with 4 decimals (`2 × 549.5000 = 1099.0000`, `3 × 333.3333 = 999.9999`; the UI shows 2).
`OrderSummary` / `OrderDetail` / orders-without-settlement items carry `productId` and
`productCost: { state, unitCost, effectiveFrom, total }`: `known`; `unknown` (mapped product, no cost on that
date); `no_product` (no SKU, or a SKU whose product does not exist yet: run sync). A product's `currentCost` is
the cost effective TODAY in India (a future-dated cost is ignored until its day); `ordersWithoutCost` counts its
orders in state `unknown`. The rule lives in one file, `src/products/effective-cost.ts`, in two equivalent forms:
a per-row join for orders (date = each order's date) and grouped per-account CTEs for product lists (current =
`MAX(effective_from) <= today`; without cost = order date before the first `effective_from`).
- Cost rows (owner): `effectiveFrom` YYYY-MM-DD, at most 366 days after today (planned price changes);
  `unitCost` decimal string (a JSON number is accepted) 0 ≤ x < 100000000 with at most 4 decimals; `note` ≤ 255.
  One cost per start date (409); no in-place edit: delete the wrong row and add it again. Audit
  `product_cost.created` / `product_cost.deleted` with the row (`productId`, `sku`, `effectiveFrom`,
  `unitCost`, `note`).
- Product list: `sort` ∈ `sku` (default), `name`, `orderCount`, `currentUnitCost` (`-` = descending; products
  without a name / current cost sort last both ways; ties on id); `status=active|archived|all` (default active);
  `cost=missing` (no cost effective today, i.e. `currentCost` null) / `known` (`currentCost` set) / `incomplete`
  (`ordersWithoutCost > 0`: at least one order dated before the product's first cost, or no cost at all);
  `q` = SKU starting with (exact case) or name containing (any case). ProductSummary / ProductDetail carry
  `workspaceId` (with `sellerAccountId`) so the caller's role can be read from `GET /auth/me` without another
  request. Audit `product.created`, `product.updated` (changed fields), `products.synced` (only when something
  changed).

**Expenses.** Scope `account` (`/accounts/:id/expenses`) or `workspace` (`/workspaces/:id/expenses`), fixed by
the route at creation and never changed (`scope`, `sellerAccountId`, `workspaceId` in a body → 400).
`expenseDate` YYYY-MM-DD, not after today in India; `amount` decimal string (a JSON number is accepted)
0 < x < 10000000000 with at most 2 decimals, stored and returned with 2; `description` ≤ 255, required when the
category is `other` (also when a PATCH makes it `other` or clears it; invisible format characters such as a
zero-width space are removed from descriptions and notes first, so they do not count as text). Lists: `sort` ∈
`expenseDate` (default `-expenseDate`), `amount`, `category` (by the LABEL shown, e.g. "Salaries & staff" before
"Software & tools", not by key), `createdAt`; `from` / `to` (expense date, inclusive); `category`
repeatable; the workspace list shows workspace-wide expenses only, or every expense of the workspace with
`scope=all`. `totals: { amount, count }` = `SUM(amount)` in DECIMAL over ALL rows matching the filters (not just
the page; `amount` null when none), read in the same snapshot as the page. Hard delete. Audit
`expense.created` / `expense.updated` (changed fields) / `expense.deleted` (the row).

**Categories and double counting.** An app-level allowlist (`src/expenses/expense-categories.ts`;
`GET /expenses/categories`): `packaging` Packaging & labels · `own_shipping` Own courier / transport (not Meesho
shipping) · `warehousing` Own storage / warehouse · `staff` Salaries & staff · `rent_utilities` Rent & utilities
· `software_tools` Software & tools · `external_marketing` Marketing outside Meesho (not Meesho Ads) ·
`professional_fees` Accounting & legal · `bank_charges` Bank charges · `other` Other (description required). It
deliberately has no category for what the settlement workbook already deducts (Meesho commission, shipping,
ads, TCS/TDS, recoveries/penalties) or for product purchase cost (entered per unit on Products): "Meesho
commission, shipping, ads, TCS/TDS and recoveries come from your settlement workbook, and product purchase cost
is entered per unit on Products — don't enter them here, or they are counted twice." Contribution / profit
formulas that combine these are Milestone 7.

**Indexes and performance.** None added: cost lookups use `uq_product_cost_history_product_effective_from`,
order counts per product `ix_orders_account_product`, SKU links `ix_orders_account_sku` /
`uq_products_account_sku`, the import pass `ix_order_status_events_account_import_job`, expense lists
`ix_expenses_account_expense_date` / `ix_expenses_workspace_expense_date`. Lists page by ids first (deferred
join): the page's ids come from `orders` / `products` alone, and only those rows get their cost and statistics;
the product statistics (grouped CTEs, driven from the account's products so other tenants' rows are never
scanned) are computed only when the sort or filter reads them. EXPLAIN ANALYZE on the test MySQL with one account
of 5,000 products / 5,905 cost rows / 20,000 orders plus a second account (2,000 / 20,000), median of 5 runs
(page + total + summaries): products by `sku` 19 ms, by `-orderCount` 65 ms, by `currentUnitCost` 110 ms,
`cost=missing` 86 ms, `cost=incomplete` 203 ms, product detail 1.4 ms; orders page 1 12 ms, page 400 13 ms. The
first version (a correlated subquery per product, cost joined before LIMIT) took 1,034 / 408 ms for the two
statistic sorts, 110–240 ms for each total and 425 ms for orders page 400. Writes (in a rolled-back
transaction): an import pass over 2,000 orders whose links are already right 91 ms; a whole-account sync with
nothing to do 209 ms, re-linking 9,000 orders 0.8 s.

**Limitations.** One product per SKU (no merging of SKU variants). Re-linking bumps `orders.updated_at` of the
orders it changes. Products can be archived, not deleted. Costs and expenses are INR only. The timings above are
from a development machine with synthetic data (and varied by up to ~2× between runs).

## Dashboard and reports (Milestone 7)

> **Estimated contribution, never profit.** The dashboard never says "sales", "revenue" or "profit"; bank payout is
> not represented anywhere; TCS / TDS are not tax advice or a filed liability. Read-only aggregation; one migration
> adds a covering index (`20261101000019`, see Indexes and performance).

**Metric definitions** (the single source of truth, quoted verbatim from the M7 design, with the 2026-11-01 user
decision on cancelled / returned orders added to definition 6; the same words are in the code comments of
`src/dashboard/*` and the Swagger descriptions):

> Filters: `from`, `to` (inclusive YYYY-MM-DD, max range 731 days, default last 30 days ending today IST), `basis`
> (`order_date` | `payment_date`, default `order_date`), optional `status` (repeatable raw order statuses; applies to
> order metrics and, in order-date basis, to which orders' settlements/costs are included).
>
> Orders in scope:
> - `order_date` basis: orders with `order_date` in range (and status filter).
> - `payment_date` basis: orders that have at least one matched, non-superseded settlement entry, and whose
>   EARLIEST matched non-superseded entry `payment_date` is in range (each order counted in exactly one period).
>
> 1. **Orders** = count of orders in scope; **Units** = Σ quantity; **Status counts** = orders in scope grouped by raw
>    `current_status`.
> 2. **Order value (as reported)** = Σ `supplier_discounted_price` of orders in scope, plus the same for
>    `supplier_listed_price` shown separately. Labelled "as reported by Meesho — whether this is per unit or per order
>    line is not confirmed yet"; `pricesMissing` = orders in scope with a NULL discounted price (shown, never treated
>    as 0). Never called "sales" or "revenue".
> 3. **Settlement amount (as reported)** = Σ `settlement_amount` of non-superseded entries in scope:
>    - `order_date` basis: entries matched to an order in scope + unmatched entries whose own `order_date` is in range +
>      account-level entries (no sub order) whose `payment_date` is in range (they have no order date — stated in UI).
>    - `payment_date` basis: entries whose `payment_date` is in range.
>    Entries that lack the date the basis needs are excluded and counted as `undatedEntries`.
>    Breakdown by `entry_type` (order payment, ads, referral, compensation, recovery, other) and informational sums of
>    sale, return, commission, shipping, TCS, TDS, recovery, compensation over the same entries ("already included in
>    the settlement amount — not deducted again"). TCS/TDS: "not tax advice or a filed liability".
> 4. **Product cost (known)** = Σ M6 order product cost (effective unit cost on order date × quantity) of orders in
>    scope with state `known`; `ordersCostUnknown` (state unknown) and `ordersNoProduct` (state no_product) counted.
> 5. **Expenses** = Σ expense `amount` with `expense_date` in range (regardless of basis): account dashboard → that
>    account's expenses; workspace dashboard → all account expenses of the workspace + workspace-wide expenses (shown as
>    their own line).
> 6. **Estimated contribution** = Settlement amount (3) − Product cost known (4) − Expenses (5).
>    Settlement amount is Meesho's net figure (commission, shipping, returns, recoveries, TCS/TDS already reflected), so
>    nothing else is deducted. Flags (each with a count, shown as "Incomplete because …"): `costUnknown` (4 has unknown or
>    no-product orders), `ordersWithoutSettlement` (orders in scope with no matched non-superseded entry — not settled
>    yet or unmatched), `unmatchedSettlements` (unmatched entries in scope), `pricesMissing`, `cancelledOrReturned`
>    (orders in scope — the same orders as the product cost (4) — whose raw `current_status` contains, case-insensitively,
>    `CANCEL`, `RTO` or `RETURN`: a keyword match until the real Meesho statuses are confirmed; their known product cost
>    is still deducted, reported as `productCost.cancelledOrReturnedOrders` and `productCost.cancelledOrReturnedCost`,
>    already included in the known cost). `complete` = no flag.
>    Never shown as "profit" without "estimated"; bank payout is NOT represented anywhere.
> 7. **Trend** = per bucket (`granularity` day|week (ISO, Monday)|month; default day ≤ 62 days, week ≤ 366, else month)
>    of: orders, order value, settlement amount, product cost known, expenses — using each metric's own date per basis.
>    Buckets with no data are present with zeros for counts and null for sums? → counts 0, sums "0.00" only when the
>    bucket truly has rows summing to zero; buckets without rows → null sums (UI shows a gap, not 0).
>
> All sums: SQL DECIMAL, decimal strings (2 dp; product cost exact then rounded HALF-UP to 2 dp for display totals —
> return both `productCostKnown` (2 dp) and `productCostKnownExact` (4 dp)). Null when no rows.

**How the definitions are applied** (interpretations):
- Range lengths count days inclusively (`from` = `to` is 1 day; 731 is the longest). `to` defaults to today in
  India, `from` to `to` − 29. A `from` after the defaulted `to` → 400 on `from`.
- Status filter, payment-date basis: it narrows the order metrics (count, units, status counts, order value,
  `pricesMissing`) only; product cost covers all orders in scope, like the settlement amount (which a status filter
  does not narrow in that basis). Order-date basis with a status filter: unmatched and account-level entries have no
  order status and stay in the settlement amount.
- An order matched only to entries without a payment date has no first payment date and falls in no payment period.
- `undatedEntries` counts every non-superseded entry of the scope without the basis date, regardless of the date range
  (all time; it is not narrowed to the selected period): payment
  basis = no payment date; order basis = unmatched entries without an order date (matched entries use the order's date,
  account-level ones their payment date).
- `byType` always lists the six entry types in the same order (`amount` null, `count` 0 when none).
- `productCostKnown` / `productCostKnownExact` are returned as `productCost.known` / `productCost.knownExact`.
- Cancelled / returned ("count it, but warn"): the classification is one constant + one SQL fragment
  (`src/orders/order-status-classes.ts`: `UPPER(current_status) LIKE '%CANCEL%' OR … '%RTO%' OR … '%RETURN%'`, its JS
  twin unit-tested); `cancelledOrReturnedCost` is their known cost rounded HALF-UP to 2 dp (null when none of them has a
  known cost); each account row carries `cancelledOrReturnedOrders` and its `complete` reflects the flag.
  Contribution uses the 2-dp `known` (the number shown next to it), so the shown numbers subtract exactly; a null part
  counts as nothing, and all three null gives null.
- `expenses.workspaceAmount` is null on an account dashboard; there `accountAmount` = `amount` (the account's own).
- Trend: buckets start on the day, the ISO Monday or the 1st of the month (the first / last bucket may be partial;
  only rows dated in the range count); product cost is rounded to 2 dp per bucket (buckets can differ from the 2-dp
  total by a paisa when unit costs have 4 decimals; `knownExact` always adds up).
- Account comparison (workspace dashboard): `accounts` = `{ id, displayName, status, orders, orderValueDiscounted,
  settlementAmount, productCostKnown, expenses, contribution, complete, cancelledOrReturnedOrders }` per seller account
  (disabled ones too, by name). The rows and the totals are exact sums (`decimal-text.ts`, BigInt) of the SAME grouped
  rows (one scan per table), so Σ rows + `expenses.workspaceAmount` = the workspace totals (product cost is rounded per
  account, which can differ from the rounded workspace total only with 4-decimal unit costs in several accounts;
  `knownExact` always adds up).

**One number, one source (traceability).** Every row set is built by the list's own filter code, in one read-only
snapshot: orders through `addOrderListFilters` (`?from&to&status`, or `?paymentFrom&paymentTo&status` =
`firstPaymentInRangeSql`), settlement entries through `addEntryDateRange` + `NOT_SUPERSEDED_SQL`
(`GET .../settlements?dateBasis=…&from&to`; the order basis = `orderBasisRangeSql`), expenses through
`addExpenseFilters` (`GET .../expenses?from&to`, workspace `?scope=all`), product costs by the effective-cost rule
(`effective-cost.ts`: `orderCostRangesJoin`, the aggregate twin of `ORDER_COST_JOIN`). So: `orders.count` = the orders list `total`; `settlements.amount` / `count` = the
settlements list `totals`; `flags.ordersWithoutSettlement` = `?settlement=unmatched`; `flags.unmatchedSettlements` =
`?match=unmatched`; each `byType` row = `?entryType=…`; expenses = the expenses list `totals`;
`productCost.knownExact` = Σ of the listed orders' `productCost.total` (state known). The e2e suite asserts each of
these. With a status filter in the order-date basis, the settlement amount has no exact list twin (the settlements
list has no order-status filter).

**Reports (CSV).** `GET .../reports/orders.csv` and `.../settlements.csv` take exactly the filters and `sort` of the
matching list (no `page` / `pageSize`: 400); `.../expenses.csv` takes `from&to&category&sort` (workspace: `&scope`).
Members; a non-member → 404. `text/csv; charset=utf-8`, UTF-8 BOM, CRLF, a header row,
`Content-Disposition: attachment; filename="<name>-<type>-<from>_<to>.csv"; filename*=UTF-8''<name>-<type>-…` (the
ASCII name: accents dropped, other characters → `-`, at most 60; the RFC 5987 name keeps letters and digits of any
script, percent-encoded; `…-from-<d>.csv` / `…-to-<d>.csv` / `<name>-<type>.csv` with one or no bound; the orders CSV
uses `paymentFrom` / `paymentTo` when `from` / `to` are absent; CORS exposes `Content-Disposition`),
`Cache-Control: no-store`. Resources: at most 2 exports stream at once in the process (more → 429 `RATE_LIMITED`
"Exports are busy, try again in a moment.", `Retry-After: 5`); each holds ONE pooled connection at a time — a short
write transaction counts the rows (over the cap → 422, nothing written) and records the audit row, then the read-only
snapshot counts again (rows imported meanwhile may make it 422 before any byte: never a partial file); a client that
leaves releases the slot and the connection at once, and one that accepts no data for 60 s is cut off. Then, in that
snapshot: COUNT first — more than `REPORT_MAX_ROWS` (env; default and maximum 100000) → 422 `EXPORT_TOO_LARGE`
("narrow the filters") before any byte; then the ids in list order (ids only), then rows in batches of 1000 by primary
key, mapped by the list's own mappers and streamed with backpressure (a client that leaves stops the export). Amounts
are plain numbers as stored (dot decimal, no ₹, no grouping, negatives keep "-"); missing = empty cell; product cost
totals exact (4 dp); timestamps ISO-8601 UTC. CSV-injection guard: a TEXT cell starting with TAB or CR, or with `=` `+` `-` `@` (or the
full-width ＝ ＋ － ＠) after any leading spaces / TAB / CR / LF, gets a leading `'` (numeric cells are never touched).
Audit `report.exported` (entity = the seller account, or the workspace for the workspace expenses CSV; `after` =
`{ type, filters, rowCount }`) before the snapshot opens. `HEAD` on the
same URL runs only the count check (200 with the download headers, or 422) and writes no audit row.
- orders.csv: Order ID, Sub Order No, Order No, Order Date, Product Name, SKU, Size, Quantity, Customer State, Supplier
  Listed Price (as reported), Supplier Discounted Price (as reported), Current Status, Status Observed At (UTC),
  Settlement Match (matched / unmatched), Settlement Entries, Settlement Amount (as reported), First Payment Date,
  Product ID, Product Cost State, Unit Cost, Cost Effective From, Product Cost Total, Source Import ID, Source Import
  File (the import the current values came from).
- settlements.csv: Entry ID, Entry Type, Sheet, Transaction ID, Sub Order No, Order Date (entry), Payment Date,
  Settlement Amount (as reported), Sale Amount, Return Amount, Meesho Commission, Shipping Charge, TCS, TDS, Recovery,
  Compensation, Is Estimate, Superseded By Entry ID, Match State, Match Method, Matched Order ID, Matched Order Sub Order
  No, Matched Order Date, Matched At (UTC), Matched By (email), Auto Match Blocked, Source Import ID, Source Import File,
  Created At (UTC).
- expenses.csv: Expense ID, Expense Date, Scope, Seller Account ID, Seller Account, Category, Category Label,
  Description, Amount (INR), Created By (email), Created At (UTC), Updated At (UTC).

**Indexes and performance.** One index, `ix_settlement_entries_account_order_payment (seller_account_id, order_id,
superseded_by_entry_id, payment_date)` (migration `20261101000019`, reversible; `db/SCHEMA.md`). A dashboard is 4
queries (+1 account list on a workspace), each table read ONCE: orders + costs grouped by (account, raw status,
trend bucket), entries grouped by (account, type, bucket), expenses grouped by (account, bucket), and the undated
count; the service adds the groups up exactly into the totals, the account rows, the status counts, the type breakdown
and the trend. No per-row correlated subquery: the first payment date is one materialised grouping (`fp`, also giving
"has a settlement"), the order basis of entries is a branch per match state with one materialised subquery of the
scope's orders in range, and costs join the scope's cost rows turned into date ranges once (`LEAD`). Measured with
`test/perf/dashboard.perf-spec.ts` (run on demand) on the test MySQL: 3 accounts × 20,000 orders × 20,000 entries
(+200 SKUs with costs, 1,600 expenses), median of 7 HTTP calls, before → after this rewrite (ms):

| Scenario | Before | After |
| --- | --- | --- |
| Account dashboard, order basis, 184 days (weekly) | 3126 | 429 |
| Account dashboard, payment basis, 184 days | 4465 | 324 |
| Account dashboard, order basis, October (daily) | 1454 | 196 |
| Account dashboard, payment basis, October | 2267 | 194 |
| Workspace dashboard (3 accounts), order basis, 184 days | 16247 | 1641 |
| Workspace dashboard (3 accounts), payment basis, 184 days | 19001 | 1030 |
| Orders list `?paymentFrom&paymentTo` (October), page + total | 389 | 95 |
| Settlements list `?dateBasis=order_date` (October), page + totals | 563 | 152 |

EXPLAIN ANALYZE of the two list filters (COUNT, one account): first payment in October 252 ms (a dependent subquery
per order, 20,000 loops) → 60 ms (the grouped subquery materialised once, then one lookup per order); order-basis
entries in October 188 ms (two dependent subqueries per entry) → 64 ms (the orders-in-range subquery materialised once).
What is left is reading and grouping the rows of the scope (20k / 60k).

**Limitations.** Synthetic fixtures only (no real Meesho file). Statuses are raw (case and spelling variants are
separate; the cancelled / returned keyword match is provisional). The export limiter is in memory (one API instance).
Timings are from a development machine (they varied by ~±20% between runs).

Errors always use `{ "error": { "code", "message", "requestId", "details"? } }`; codes and
their HTTP status live in `src/common/errors/error-codes.ts` (an `ApiException` carries an explicit code,
e.g. `PARSE_ERROR` / `EXPORT_TOO_LARGE` 422). Every response carries an
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
