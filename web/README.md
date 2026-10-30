# Web (Angular frontend)

Angular 21 + Tailwind CSS 4 frontend for Meesho Seller SaaS. Built so far: app shell and the API
status panel on Overview (Milestone 1); sign-in, registration, workspace switcher, Seller accounts
and Workspace settings (Milestone 3). Every other screen is a placeholder.

Auth: the API keeps the session in an HttpOnly cookie, so the app learns who is signed in only from
`GET /auth/me` at startup (`AuthStateService`). Angular's XSRF support copies the `msaas_xsrf`
cookie into the `X-XSRF-TOKEN` header on unsafe requests (`provideApiHttpClient`). Shell routes are
guarded (`authGuard` → `/login?returnUrl=…`, internal paths only), and a 401 from any other API
call signs the user out (`unauthorizedInterceptor`).

All commands run from `web/`. On this machine keep the npm cache on D: (`npm_config_cache`).

| Task | Command |
| --- | --- |
| Install | `npm ci` |
| Dev server (http://localhost:4310, proxies `/api` → `http://localhost:3100`) | `npm start` |
| Lint (angular-eslint) | `npx ng lint` |
| Type-check | `npx tsc --noEmit -p tsconfig.app.json` (specs: `-p tsconfig.spec.json`) |
| Unit tests (Vitest + jsdom, no browser) | `npx ng test --watch=false` |
| Production build (`dist/web/browser`) | `npx ng build` |

The API base URL is the `API_BASE_URL` injection token (`src/app/core/api/api-base-url.ts`),
default `/api/v1`. Proxy settings: `proxy.conf.json`.
