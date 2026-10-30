# Web (Angular frontend)

Angular 21 + Tailwind CSS 4 frontend for Meesho Seller SaaS. Milestone 1 scope: app shell and the
API status panel on Overview; every other screen is a placeholder.

All commands run from `web/`. On this machine keep the npm cache on D: (`npm_config_cache`).

| Task | Command |
| --- | --- |
| Install | `npm ci` |
| Dev server (http://localhost:4300, proxies `/api` → `http://localhost:3100`) | `npm start` |
| Lint (angular-eslint) | `npx ng lint` |
| Type-check | `npx tsc --noEmit -p tsconfig.app.json` |
| Unit tests (Vitest + jsdom, no browser) | `npx ng test --watch=false` |
| Production build (`dist/web/browser`) | `npx ng build` |

The API base URL is the `API_BASE_URL` injection token (`src/app/core/api/api-base-url.ts`),
default `/api/v1`. Proxy settings: `proxy.conf.json`.
