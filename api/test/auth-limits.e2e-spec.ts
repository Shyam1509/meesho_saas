import request from 'supertest';
import { createE2eApp, type E2eApp, newRunId } from './support/e2e-app';
import { API, type ErrorBody, TestClient } from './support/test-client';

const LIMIT = 3;

/**
 * Settings the main auth suite keeps out of the way: registration switched off and a low per-IP
 * limit (AUTH_RATE_LIMIT_PER_MINUTE = 3). Creates no rows.
 */
describe('auth limits (e2e, registration disabled, 3 requests/minute)', () => {
  let ctx: E2eApp;
  const runId = newRunId();

  beforeAll(async () => {
    ctx = await createE2eApp({
      authRegistrationEnabled: false,
      authRateLimitPerMinute: LIMIT,
    });
  });

  afterAll(async () => {
    await ctx?.app.close();
  });

  it('GET /auth/config reports registration disabled', async () => {
    const res = await request(ctx.server).get(`${API}/auth/config`).expect(200);
    expect(res.body).toEqual({ registrationEnabled: false });
  });

  it('POST /auth/register → 403 when disabled, whatever the body', async () => {
    const c = new TestClient(ctx.server);
    await c.primeCsrf();
    for (const body of [
      {
        email: `closed-${runId}@example.test`,
        password: 'long enough password',
      },
      { email: 'not-an-email' },
    ]) {
      const res = await c.post('/auth/register', body);
      expect(res.status).toBe(403);
      expect(res.body).toEqual({
        error: {
          code: 'FORBIDDEN',
          message: 'Registration is disabled.',
          requestId: expect.any(String) as string,
        },
      });
    }
  });

  it('POST /auth/login: the request over the per-IP limit → 429 RATE_LIMITED with Retry-After', async () => {
    const c = new TestClient(ctx.server);
    // Distinct unknown emails, so the per-email limiter (5 failures) never triggers here.
    for (let i = 0; i < LIMIT; i += 1) {
      const res = await c.login(
        `ip-limit-${i}-${runId}@example.test`,
        'some password',
      );
      expect([i, res.status]).toEqual([i, 401]);
    }

    const limited = await c.login(`ip-limit-x-${runId}@example.test`, 'pw');
    expect(limited.status).toBe(429);
    expect((limited.body as ErrorBody).error).toEqual({
      code: 'RATE_LIMITED',
      message: 'Too many requests. Please try again later.',
      requestId: expect.any(String) as string,
    });
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('GET endpoints are not rate limited', async () => {
    for (let i = 0; i < LIMIT + 2; i += 1) {
      await request(ctx.server).get(`${API}/auth/config`).expect(200);
    }
  });
});
