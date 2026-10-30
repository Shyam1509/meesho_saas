import { createHash } from 'node:crypto';
import { QueryTypes } from 'sequelize';
import request from 'supertest';
import { LoginAttemptLimiter } from '../src/auth/login-attempt-limiter.service';
import { UserSession } from '../src/database/models';
import {
  createE2eApp,
  deleteRunData,
  type E2eApp,
  newRunId,
} from './support/e2e-app';
import {
  API,
  type ErrorBody,
  SESSION_COOKIE,
  setCookieFor,
  TestClient,
  withoutRequestId,
  XSRF_COOKIE,
} from './support/test-client';

const PASSWORD = 'correct horse battery';
const SEVEN_DAYS_S = 7 * 24 * 60 * 60;

interface MeBody {
  user: { id: string; email: string; displayName: string | null };
  workspaces: { id: string; name: string; role: string }[];
}

/**
 * Auth endpoints, sessions, CSRF and the per-email limiter against meesho_test. Every user has a
 * unique email for this run; afterAll deletes the run's rows.
 */
describe('auth (e2e)', () => {
  let ctx: E2eApp;
  const runId = newRunId();
  const email = (label: string) => `${label}-${runId}@example.test`;
  const client = () => new TestClient(ctx.server);
  /** A client the app sees as coming from `ip` (test-only header, see createE2eApp). */
  const clientFrom = (ip: string) => new TestClient(ctx.server, ip);

  async function signedIn(label: string): Promise<TestClient> {
    const c = client();
    const res = await c.register(email(label), PASSWORD);
    expect(res.status).toBe(201);
    return c;
  }

  async function sessionRows(userId: string) {
    return ctx.sequelize.query<{
      tokenHash: string;
      revokedAt: Date | null;
    }>(
      'SELECT token_hash AS tokenHash, revoked_at AS revokedAt FROM user_sessions WHERE user_id = ? ORDER BY id',
      { replacements: [userId], type: QueryTypes.SELECT },
    );
  }

  const sha256 = (value: string) =>
    createHash('sha256').update(value).digest('hex');

  /**
   * Rewrites a session's timestamps through the model (UTC-safe; Sequelize formats Date values in raw
   * replacements in the machine's local time zone).
   */
  async function setSessionTimes(
    token: string,
    times: { lastUsedAt?: Date; absoluteExpiresAt?: Date },
  ): Promise<void> {
    const [updated] = await UserSession.update(times, {
      where: { tokenHash: sha256(token) },
    });
    expect(updated).toBe(1);
  }

  beforeAll(async () => {
    ctx = await createE2eApp();
  });

  afterAll(async () => {
    if (ctx) {
      await deleteRunData(ctx.sequelize, runId);
      await ctx.app.close();
    }
  });

  describe('GET /auth/config, GET /auth/csrf, XSRF seeding', () => {
    it('config is public', async () => {
      const res = await request(ctx.server)
        .get(`${API}/auth/config`)
        .expect(200);
      expect(res.body).toEqual({ registrationEnabled: true });
    });

    it('csrf → 204 with a readable SameSite=Strict msaas_xsrf cookie; a valid token is kept', async () => {
      const c = client();
      const first = await c.get('/auth/csrf');
      expect(first.status).toBe(204);
      const cookie = setCookieFor(first, XSRF_COOKIE) ?? '';
      expect(cookie).toMatch(/^msaas_xsrf=[A-Za-z0-9_-]{43};/);
      expect(cookie).toContain('Path=/');
      expect(cookie).toContain('SameSite=Strict');
      expect(cookie).not.toContain('HttpOnly');
      const token = c.xsrf;

      const again = await c.get('/auth/csrf');
      expect(again.status).toBe(204);
      expect(c.xsrf).toBe(token);
    });

    it('any response seeds the token when the request has none, even a 401 from /auth/me', async () => {
      const res = await request(ctx.server).get(`${API}/auth/me`).expect(401);
      expect(setCookieFor(res, XSRF_COOKIE)).toBeDefined();
    });
  });

  describe('POST /auth/register', () => {
    it('201: MeResponse, session cookie, XSRF rotated; user, workspace, owner membership and audit row in one go', async () => {
      const c = client();
      await c.primeCsrf();
      const xsrfBefore = c.xsrf;

      const res = await c.post('/auth/register', {
        email: `  Reg.Ok-${runId}@Example.TEST `,
        password: PASSWORD,
        displayName: 'Reg User',
        workspaceName: 'Reg Shop',
      });

      expect(res.status).toBe(201);
      const body = res.body as MeBody;
      expect(body).toEqual({
        user: {
          id: expect.stringMatching(/^[1-9][0-9]*$/) as string,
          email: `reg.ok-${runId}@example.test`,
          displayName: 'Reg User',
        },
        workspaces: [
          {
            id: expect.stringMatching(/^[1-9][0-9]*$/) as string,
            name: 'Reg Shop',
            role: 'owner',
          },
        ],
      });
      expect(JSON.stringify(body)).not.toMatch(/hash|password/i);

      const session = setCookieFor(res, SESSION_COOKIE) ?? '';
      expect(session).toMatch(/^msaas_sid=[A-Za-z0-9_-]{43};/);
      expect(session).toContain('HttpOnly');
      expect(session).toContain('SameSite=Strict');
      expect(session).toContain('Path=/');
      expect(session).not.toMatch(/Domain=/i);
      expect(c.xsrf).toBeDefined();
      expect(c.xsrf).not.toBe(xsrfBefore);

      const [user] = await ctx.sequelize.query<{
        passwordHash: string;
        lastLoginAt: Date | null;
      }>(
        'SELECT password_hash AS passwordHash, last_login_at AS lastLoginAt FROM users WHERE id = ?',
        { replacements: [body.user.id], type: QueryTypes.SELECT },
      );
      expect(user.passwordHash).toMatch(/^\$argon2id\$/);
      expect(user.passwordHash).not.toContain(PASSWORD);
      expect(user.lastLoginAt).not.toBeNull();

      const audit = await ctx.sequelize.query<{
        action: string;
        actorUserId: number;
        afterData: unknown;
      }>(
        `SELECT action, actor_user_id AS actorUserId, after_data AS afterData
         FROM audit_logs WHERE workspace_id = ?`,
        { replacements: [body.workspaces[0].id], type: QueryTypes.SELECT },
      );
      expect(audit).toEqual([
        {
          action: 'workspace.created',
          actorUserId: Number(body.user.id),
          afterData: { name: 'Reg Shop' },
        },
      ]);

      // The cookie works: /auth/me returns the same user.
      const me = await c.get('/auth/me');
      expect(me.status).toBe(200);
      expect(me.body).toEqual(body);
    });

    it('registering while signed in revokes the presented session (old cookie then 401)', async () => {
      const c = await signedIn('reg-fixation-a');
      const oldToken = c.session as string;

      const res = await c.register(email('reg-fixation-b'), PASSWORD);
      expect(res.status).toBe(201);
      expect(c.session).toBeDefined();
      expect(c.session).not.toBe(oldToken);

      const replay = await request(ctx.server)
        .get(`${API}/auth/me`)
        .set('Cookie', `${SESSION_COOKIE}=${oldToken}`);
      expect(replay.status).toBe(401);
      const me = await c.get('/auth/me');
      expect((me.body as MeBody).user.email).toBe(email('reg-fixation-b'));
    });

    it('default workspace name is "My workspace"', async () => {
      const res = await client().register(email('reg-default'), PASSWORD);
      expect(res.status).toBe(201);
      expect((res.body as MeBody).workspaces).toEqual([
        expect.objectContaining({ name: 'My workspace', role: 'owner' }),
      ]);
      expect((res.body as MeBody).user.displayName).toBeNull();
    });

    it('409 for a registered email in any letter case, naming the field', async () => {
      await signedIn('reg-dup');
      const res = await client().register(
        email('reg-dup').toUpperCase(),
        PASSWORD,
      );
      expect(res.status).toBe(409);
      expect(res.body).toEqual({
        error: {
          code: 'CONFLICT',
          message: 'An account with this email already exists.',
          requestId: expect.any(String) as string,
          details: [
            { field: 'email', reasons: ['email is already registered'] },
          ],
        },
      });
    });

    it('400 for a short password and a bad email; values are not echoed', async () => {
      const res = await client().register('not-an-email', 'short-pw-11');
      expect(res.status).toBe(400);
      const body = res.body as ErrorBody;
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.details?.map((d) => d.field).sort()).toEqual([
        'email',
        'password',
      ]);
      expect(JSON.stringify(body)).not.toContain('short-pw-11');
    });
  });

  describe('POST /auth/login', () => {
    it('200: MeResponse; session cookie HttpOnly, SameSite=Strict, Path=/, Max-Age 7 days; XSRF rotated', async () => {
      await signedIn('login-ok');
      const c = client();
      await c.primeCsrf();
      const xsrfBefore = c.xsrf;

      const res = await c.post('/auth/login', {
        email: ` LOGIN-OK-${runId}@example.test`,
        password: PASSWORD,
      });

      expect(res.status).toBe(200);
      expect((res.body as MeBody).user.email).toBe(email('login-ok'));
      expect((res.body as MeBody).workspaces).toHaveLength(1);
      const session = setCookieFor(res, SESSION_COOKIE) ?? '';
      expect(session).toContain('HttpOnly');
      expect(session).toContain('SameSite=Strict');
      expect(session).toContain('Path=/');
      expect(session).toContain(`Max-Age=${SEVEN_DAYS_S}`);
      expect(session).not.toContain('Secure'); // COOKIE_SECURE is off outside production
      expect(c.xsrf).not.toBe(xsrfBefore);
      expect((await c.get('/auth/me')).status).toBe(200);
    });

    it('wrong password and unknown email give the identical 401 body (except requestId)', async () => {
      await signedIn('login-enum');
      const wrong = await client().login(email('login-enum'), `${PASSWORD}!`);
      const unknown = await client().login(email('login-nobody'), PASSWORD);

      expect(wrong.status).toBe(401);
      expect(unknown.status).toBe(401);
      expect(wrong.body).toEqual({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Invalid email or password.',
          requestId: expect.any(String) as string,
        },
      });
      expect(withoutRequestId(wrong.body)).toEqual(
        withoutRequestId(unknown.body),
      );
      expect(setCookieFor(wrong, SESSION_COOKIE)).toBeUndefined();
    });

    it('a disabled user gets the same 401 at login, and their existing session stops working', async () => {
      const c = await signedIn('login-disabled');
      const userId = (await c.get('/auth/me').then((r) => r.body as MeBody))
        .user.id;
      await ctx.sequelize.query(
        "UPDATE users SET status = 'disabled' WHERE id = ?",
        { replacements: [userId] },
      );

      const me = await c.get('/auth/me');
      expect(me.status).toBe(401);
      expect((me.body as ErrorBody).error.message).toBe(
        'Authentication required.',
      );

      const login = await client().login(email('login-disabled'), PASSWORD);
      expect(login.status).toBe(401);
      expect((login.body as ErrorBody).error.message).toBe(
        'Invalid email or password.',
      );
    });

    it('revokes the session presented at login (no fixation)', async () => {
      const c = await signedIn('login-fixation');
      const oldToken = c.session as string;

      const res = await c.login(email('login-fixation'), PASSWORD);
      expect(res.status).toBe(200);
      expect(c.session).not.toBe(oldToken);

      const reused = await request(ctx.server)
        .get(`${API}/auth/me`)
        .set('Cookie', `${SESSION_COOKIE}=${oldToken}`);
      expect(reused.status).toBe(401);
      expect((await c.get('/auth/me')).status).toBe(200);
    });

    it('login deletes the user’s revoked and expired sessions', async () => {
      const c = await signedIn('login-purge');
      const userId = (await c.get('/auth/me').then((r) => r.body as MeBody))
        .user.id;
      // A second session of the same user, then idle-expired.
      const idle = client();
      await idle.login(email('login-purge'), PASSWORD);
      await setSessionTimes(idle.session as string, {
        lastUsedAt: new Date(Date.now() - 13 * 60 * 60_000),
      });
      // The first one revoked by logout.
      await c.post('/auth/logout');
      const ended = await sessionRows(userId);
      expect(ended).toHaveLength(2); // both kept until the user's next login
      expect(ended[0].revokedAt).not.toBeNull();

      await c.login(email('login-purge'), PASSWORD);
      const rows = await sessionRows(userId);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toEqual({
        tokenHash: sha256(c.session as string),
        revokedAt: null,
      });
    });
  });

  describe('sessions', () => {
    it('no cookie or a garbage cookie → 401 "Authentication required."', async () => {
      for (const cookie of [undefined, `${SESSION_COOKIE}=garbage`]) {
        const req = request(ctx.server).get(`${API}/auth/me`);
        const res = await (cookie ? req.set('Cookie', cookie) : req);
        expect(res.status).toBe(401);
        expect(res.body).toEqual({
          error: {
            code: 'UNAUTHORIZED',
            message: 'Authentication required.',
            requestId: expect.any(String) as string,
          },
        });
      }
    });

    it('the database holds only the SHA-256 of the session token', async () => {
      const c = await signedIn('session-hash');
      const userId = (await c.get('/auth/me').then((r) => r.body as MeBody))
        .user.id;
      const rows = await sessionRows(userId);
      expect(rows.map((r) => r.tokenHash)).toEqual([
        sha256(c.session as string),
      ]);
    });

    it('logout → 204, clears the cookie, rotates XSRF and revokes: the old cookie then gets 401', async () => {
      const c = await signedIn('logout');
      const token = c.session as string;
      const xsrfBefore = c.xsrf;

      const res = await c.post('/auth/logout');
      expect(res.status).toBe(204);
      expect(setCookieFor(res, SESSION_COOKIE)).toMatch(
        /^msaas_sid=;.*Expires=Thu, 01 Jan 1970/,
      );
      expect(c.session).toBeUndefined();
      expect(c.xsrf).not.toBe(xsrfBefore);

      const replay = await request(ctx.server)
        .get(`${API}/auth/me`)
        .set('Cookie', `${SESSION_COOKIE}=${token}`);
      expect(replay.status).toBe(401);
    });

    it('logout without a session is still 204', async () => {
      const c = client();
      await c.primeCsrf();
      expect((await c.post('/auth/logout')).status).toBe(204);
    });

    it('idle for longer than SESSION_IDLE_MINUTES → 401; just inside the window still works', async () => {
      const c = await signedIn('session-idle');
      const token = c.session as string;
      const idleMs = ctx.config.sessionIdleMinutes * 60_000;

      await setSessionTimes(token, {
        lastUsedAt: new Date(Date.now() - idleMs + 60_000),
      });
      expect((await c.get('/auth/me')).status).toBe(200);

      await setSessionTimes(token, {
        lastUsedAt: new Date(Date.now() - idleMs - 1000),
      });
      expect((await c.get('/auth/me')).status).toBe(401);
    });

    it('past its absolute expiry → 401, even if used a moment ago', async () => {
      const c = await signedIn('session-absolute');
      const token = c.session as string;

      await setSessionTimes(token, {
        absoluteExpiresAt: new Date(Date.now() + 60_000),
      });
      expect((await c.get('/auth/me')).status).toBe(200);

      await setSessionTimes(token, {
        absoluteExpiresAt: new Date(Date.now() - 1000),
        lastUsedAt: new Date(),
      });
      expect((await c.get('/auth/me')).status).toBe(401);
    });

    it('new sessions expire SESSION_ABSOLUTE_HOURS after creation', async () => {
      const c = await signedIn('session-lifetime');
      const session = await UserSession.findOne({
        where: { tokenHash: sha256(c.session as string) },
      });
      const lifetimeMs =
        (session?.absoluteExpiresAt.getTime() ?? 0) -
        (session?.createdAt.getTime() ?? 0);
      expect(lifetimeMs).toBe(ctx.config.sessionAbsoluteHours * 3_600_000);
      expect(
        Math.abs((session?.createdAt.getTime() ?? 0) - Date.now()),
      ).toBeLessThan(60_000);
    });

    it('refreshes last_used_at once it is 5+ minutes old, not before', async () => {
      const c = await signedIn('session-touch');
      const token = c.session as string;
      const lastUsed = async () =>
        (
          await UserSession.findOne({ where: { tokenHash: sha256(token) } })
        )?.lastUsedAt.getTime() ?? 0;

      const recent = new Date(Date.now() - 4 * 60_000);
      await setSessionTimes(token, { lastUsedAt: recent });
      expect((await c.get('/auth/me')).status).toBe(200);
      expect(await lastUsed()).toBe(recent.getTime());

      const old = new Date(Date.now() - 6 * 60_000);
      await setSessionTimes(token, { lastUsedAt: old });
      expect((await c.get('/auth/me')).status).toBe(200);
      expect(await lastUsed()).toBeGreaterThan(Date.now() - 60_000);
    });
  });

  describe('CSRF', () => {
    it('unsafe requests without X-XSRF-TOKEN → 403 (public and protected routes)', async () => {
      const c = await signedIn('csrf-missing');
      for (const [path, body] of [
        ['/auth/login', { email: email('csrf-missing'), password: PASSWORD }],
        ['/auth/logout', undefined],
        ['/workspaces', { name: 'X' }],
      ] as const) {
        const res = await c.post(path, body, { csrf: false });
        expect([path, res.status]).toEqual([path, 403]);
        expect(res.body).toEqual({
          error: {
            code: 'FORBIDDEN',
            message: 'Missing or invalid CSRF token.',
            requestId: expect.any(String) as string,
          },
        });
      }
      // The session survived the rejected logout.
      expect((await c.get('/auth/me')).status).toBe(200);
    });

    it('a header that does not match the cookie → 403', async () => {
      const c = await signedIn('csrf-mismatch');
      const res = await c.post(
        '/workspaces',
        { name: 'X' },
        { csrf: 'A'.repeat(43) },
      );
      expect(res.status).toBe(403);
    });

    it('a header without the cookie → 403', async () => {
      const token = 'B'.repeat(43);
      const res = await request(ctx.server)
        .post(`${API}/auth/login`)
        .set('X-XSRF-TOKEN', token)
        .send({ email: email('csrf-nocookie'), password: PASSWORD });
      expect(res.status).toBe(403);
    });

    it('a foreign Origin → 403 even with a valid token; an allowed Origin passes', async () => {
      const c = await signedIn('csrf-origin');
      const foreign = await c.post(
        '/workspaces',
        { name: 'Evil' },
        { headers: { Origin: 'http://evil.example' } },
      );
      expect(foreign.status).toBe(403);
      expect((foreign.body as ErrorBody).error.message).toBe(
        'Request origin is not allowed.',
      );

      const allowed = await c.post(
        '/workspaces',
        { name: 'Allowed origin' },
        { headers: { Origin: ctx.config.corsOrigins[0] } },
      );
      expect(allowed.status).toBe(201);
    });

    it('CSRF is checked before authentication; GET needs no token', async () => {
      const c = client();
      await c.primeCsrf();
      expect(
        (await c.post('/workspaces', { name: 'X' }, { csrf: false })).status,
      ).toBe(403);
      expect((await c.post('/workspaces', { name: 'X' })).status).toBe(401);
      expect((await c.get('/workspaces')).status).toBe(401);
    });
  });

  describe('failed-login limits: 5 per (email, IP), 50 per email, per 15 minutes', () => {
    const IP_A = '203.0.113.10';
    const IP_B = '203.0.113.20';

    it('5 failures from one IP → 429 for that email from that IP only; the owner on another IP still signs in', async () => {
      await signedIn('limit');
      await signedIn('limit-other');
      const attacker = clientFrom(IP_A);
      for (let i = 0; i < 5; i += 1) {
        const res = await attacker.login(email('limit'), `wrong password ${i}`);
        expect([i, res.status]).toEqual([i, 401]);
      }

      const blocked = await attacker.login(email('limit'), PASSWORD);
      expect(blocked.status).toBe(429);
      expect(blocked.body).toEqual({
        error: {
          code: 'RATE_LIMITED',
          message: 'Too many failed sign-in attempts. Please try again later.',
          requestId: expect.any(String) as string,
        },
      });
      expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
      expect(setCookieFor(blocked, SESSION_COOKIE)).toBeUndefined();
      // Another letter case is the same email; another email from the same IP is unaffected.
      expect(
        (await attacker.login(email('limit').toUpperCase(), PASSWORD)).status,
      ).toBe(429);
      expect(
        (await attacker.login(email('limit-other'), PASSWORD)).status,
      ).toBe(200);

      // The real user, from their own IP, is not locked out...
      expect(
        (await clientFrom(IP_B).login(email('limit'), PASSWORD)).status,
      ).toBe(200);
      // ...and their success does not unblock the attacker's pair.
      expect((await attacker.login(email('limit'), PASSWORD)).status).toBe(429);
    }, 30_000);

    it('applies to emails that have no account', async () => {
      const c = clientFrom('203.0.113.30');
      for (let i = 0; i < 5; i += 1) {
        expect((await c.login(email('limit-ghost'), PASSWORD)).status).toBe(
          401,
        );
      }
      expect((await c.login(email('limit-ghost'), PASSWORD)).status).toBe(429);
      expect(
        (await clientFrom('203.0.113.31').login(email('limit-ghost'), PASSWORD))
          .status,
      ).toBe(401);
    });

    it('50 failures for one email from many IPs block it from every IP, the owner’s included', async () => {
      await signedIn('limit-wide');
      for (let n = 0; n < 10; n += 1) {
        const c = clientFrom(`198.51.100.${n}`);
        for (let i = 0; i < 5; i += 1) {
          const res = await c.login(email('limit-wide'), `guess ${n}-${i}`);
          expect([n, i, res.status]).toEqual([n, i, 401]);
        }
      }
      const owner = await clientFrom('192.0.2.1').login(
        email('limit-wide'),
        PASSWORD,
      );
      expect(owner.status).toBe(429);
      expect(Number(owner.headers['retry-after'])).toBeGreaterThan(0);
    }, 60_000); // 51 Argon2 verifications
  });

  describe('lookalike emails (invisible or fullwidth characters)', () => {
    it('login: soft-hyphen and fullwidth variants of a real email → 400 on email, never reaching the limiter', async () => {
      await signedIn('lookalike');
      const variants = [
        `look­alike-${runId}@example.test`, // soft hyphen
        `ｌookalike-${runId}@example.test`, // fullwidth "l"
        `LOOKALIKE-${runId}@EXAMPLE.TESＴ`, // fullwidth "T" (stays fullwidth when lower-cased)
      ];
      const limiter = ctx.app.get(LoginAttemptLimiter);
      const recordFailure = jest.spyOn(limiter, 'recordFailure');
      const retryAfter = jest.spyOn(limiter, 'retryAfterSeconds');
      const c = clientFrom('203.0.113.40');
      try {
        for (const variant of variants) {
          for (let i = 0; i < 6; i += 1) {
            const res = await c.login(variant, `wrong ${i}`);
            expect(res.status).toBe(400);
            expect((res.body as ErrorBody).error.code).toBe('VALIDATION_ERROR');
            expect(
              (res.body as ErrorBody).error.details?.map((d) => d.field),
            ).toEqual(['email']);
          }
        }
        expect(recordFailure).not.toHaveBeenCalled();
        expect(retryAfter).not.toHaveBeenCalled();
      } finally {
        recordFailure.mockRestore();
        retryAfter.mockRestore();
      }
      expect((await c.login(email('lookalike'), PASSWORD)).status).toBe(200);
    });

    it('register: a lookalike of a registered email → 400 (not 409, no second account)', async () => {
      await signedIn('lookalike-reg');
      const res = await client().register(
        `lookalike­-reg-${runId}@example.test`,
        PASSWORD,
      );
      expect(res.status).toBe(400);
      expect(
        (res.body as ErrorBody).error.details?.map((d) => d.field),
      ).toEqual(['email']);
    });
  });

  describe('Cache-Control', () => {
    it('every /api/v1 response is no-store: success, 401, 400, 404 and public routes', async () => {
      const c = await signedIn('no-store');
      const responses = [
        await c.get('/auth/me'),
        await c.get('/auth/config'),
        await c.get('/auth/csrf'),
        await c.post('/auth/login', { email: 'bad', password: 'x' }),
        await request(ctx.server).get(`${API}/auth/me`),
        await request(ctx.server).get(`${API}/does-not-exist`),
        await request(ctx.server).get(`${API}/health`),
      ];
      expect(responses.map((r) => r.status)).toEqual([
        200, 200, 204, 400, 401, 404, 200,
      ]);
      for (const res of responses) {
        expect(res.headers['cache-control']).toBe('no-store');
      }
    });
  });

  describe('OpenAPI', () => {
    it('documents the new endpoints with cookie and XSRF security; health stays public', async () => {
      const res = await request(ctx.server).get('/api/docs-json').expect(200);
      const doc = res.body as {
        paths: Record<string, Record<string, { security?: unknown[] }>>;
        components: { securitySchemes: Record<string, unknown> };
      };
      expect(Object.keys(doc.paths)).toEqual(
        expect.arrayContaining([
          '/api/v1/auth/config',
          '/api/v1/auth/csrf',
          '/api/v1/auth/register',
          '/api/v1/auth/login',
          '/api/v1/auth/logout',
          '/api/v1/auth/me',
          '/api/v1/workspaces',
          '/api/v1/workspaces/{workspaceId}',
          '/api/v1/workspaces/{workspaceId}/members',
          '/api/v1/workspaces/{workspaceId}/accounts',
          '/api/v1/accounts/{accountId}',
        ]),
      );
      expect(doc.components.securitySchemes).toEqual(
        expect.objectContaining({
          session: expect.objectContaining({
            in: 'cookie',
            name: SESSION_COOKIE,
          }) as unknown,
          xsrf: expect.objectContaining({
            in: 'header',
            name: 'X-XSRF-TOKEN',
          }) as unknown,
        }),
      );
      expect(doc.paths['/api/v1/auth/me'].get.security).toEqual([
        { session: [] },
      ]);
      expect((await request(ctx.server).get(`${API}/health`)).status).toBe(200);
    });
  });
});
