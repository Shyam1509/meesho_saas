import { QueryTypes } from 'sequelize';
import type { Response } from 'supertest';
import { WorkspaceMember } from '../src/database/models';
import {
  createE2eApp,
  deleteRunData,
  type E2eApp,
  newRunId,
} from './support/e2e-app';
import {
  type ErrorBody,
  TestClient,
  withoutRequestId,
} from './support/test-client';

const PASSWORD = 'correct horse battery';

interface MeBody {
  user: { id: string };
  workspaces: { id: string; name: string; role: string }[];
}

interface AccountBody {
  id: string;
  workspaceId: string;
  displayName: string;
  meeshoSupplierId: string | null;
  status: 'active' | 'disabled';
  createdAt: string;
  updatedAt: string;
}

interface AuditRow {
  action: string;
  entityType: string;
  entityId: string;
  sellerAccountId: number | null;
  actorUserId: number;
  beforeData: unknown;
  afterData: unknown;
  requestId: string | null;
}

/**
 * Workspaces, members and seller accounts: roles (owner ⊇ member), cross-tenant denial (404, never
 * revealing existence), id validation, duplicate names (409) and audit rows.
 *
 * Alice owns workspace A (accounts a1, a2); Carol is a member of A; Bob owns workspace B and is a
 * stranger to A.
 */
describe('workspaces & seller accounts: roles and tenancy (e2e)', () => {
  let ctx: E2eApp;
  const runId = newRunId();
  const email = (label: string) => `${label}-${runId}@example.test`;

  let alice: TestClient;
  let bob: TestClient;
  let carol: TestClient;
  let aliceId: string;
  let carolId: string;
  let wsA: string;
  let wsB: string;
  let a1: AccountBody;
  let a2: AccountBody;

  async function register(label: string, workspaceName: string) {
    const client = new TestClient(ctx.server);
    const res = await client.register(email(label), PASSWORD, {
      displayName: label,
      workspaceName,
    });
    expect(res.status).toBe(201);
    return { client, me: res.body as MeBody };
  }

  async function auditRows(workspaceId: string): Promise<AuditRow[]> {
    return ctx.sequelize.query<AuditRow>(
      `SELECT action, entity_type AS entityType, entity_id AS entityId,
              seller_account_id AS sellerAccountId, actor_user_id AS actorUserId,
              before_data AS beforeData, after_data AS afterData, request_id AS requestId
       FROM audit_logs WHERE workspace_id = ? ORDER BY id`,
      { replacements: [workspaceId], type: QueryTypes.SELECT },
    );
  }

  async function accountRow(id: string) {
    const [row] = await ctx.sequelize.query<{
      displayName: string;
      status: string;
      meeshoSupplierId: string | null;
    }>(
      `SELECT display_name AS displayName, status, meesho_supplier_id AS meeshoSupplierId
       FROM seller_accounts WHERE id = ?`,
      { replacements: [id], type: QueryTypes.SELECT },
    );
    return row;
  }

  function expectError(res: Response, status: number, code: string): void {
    expect({
      status: res.status,
      code: (res.body as ErrorBody).error?.code,
    }).toEqual({
      status,
      code,
    });
  }

  beforeAll(async () => {
    ctx = await createE2eApp();
    const a = await register('alice', 'Workspace A');
    const b = await register('bob', 'Workspace B');
    const c = await register('carol', 'Carol own');
    alice = a.client;
    bob = b.client;
    carol = c.client;
    aliceId = a.me.user.id;
    carolId = c.me.user.id;
    wsA = a.me.workspaces[0].id;
    wsB = b.me.workspaces[0].id;

    // Invitations are a later milestone: add Carol to A directly.
    await WorkspaceMember.create({
      workspaceId: Number(wsA),
      userId: Number(carolId),
      role: 'member',
    });

    const r1 = await alice.post(`/workspaces/${wsA}/accounts`, {
      displayName: 'Main Shop',
      meeshoSupplierId: 'SUP-001',
    });
    const r2 = await alice.post(`/workspaces/${wsA}/accounts`, {
      displayName: 'Alpha Outlet',
    });
    expect([r1.status, r2.status]).toEqual([201, 201]);
    a1 = r1.body as AccountBody;
    a2 = r2.body as AccountBody;
  });

  afterAll(async () => {
    if (ctx) {
      await deleteRunData(ctx.sequelize, runId);
      await ctx.app.close();
    }
  });

  describe('workspaces', () => {
    it('GET /workspaces lists the caller’s workspaces with their role, sorted by name', async () => {
      const res = await carol.get('/workspaces');
      expect(res.status).toBe(200);
      const items = (
        res.body as {
          items: {
            id: string;
            name: string;
            role: string;
            createdAt: string;
          }[];
        }
      ).items;
      expect(items.map((w) => [w.name, w.role])).toEqual([
        ['Carol own', 'owner'],
        ['Workspace A', 'member'],
      ]);
      for (const w of items) {
        expect(w.id).toMatch(/^[1-9][0-9]*$/);
        expect(new Date(w.createdAt).toISOString()).toBe(w.createdAt);
      }
    });

    it('POST /workspaces → 201, caller is owner, audit workspace.created; it shows up in /auth/me', async () => {
      const res = await bob.post('/workspaces', { name: '  Second B  ' });
      expect(res.status).toBe(201);
      const body = res.body as { id: string; name: string; role: string };
      expect(body).toEqual({
        id: expect.stringMatching(/^[1-9][0-9]*$/) as string,
        name: 'Second B',
        role: 'owner',
        createdAt: expect.any(String) as string,
      });
      const audit = await auditRows(body.id);
      expect(audit).toEqual([
        expect.objectContaining({
          action: 'workspace.created',
          entityType: 'workspace',
          entityId: body.id,
          afterData: { name: 'Second B' },
          beforeData: null,
          requestId: res.headers['x-request-id'],
        }),
      ]);
      const me = (await bob.get('/auth/me')).body as MeBody;
      expect(me.workspaces.map((w) => w.name)).toEqual([
        'Second B',
        'Workspace B',
      ]);
    });

    it('member: 200 on GET workspace and members; 403 on rename', async () => {
      const get = await carol.get(`/workspaces/${wsA}`);
      expect(get.status).toBe(200);
      // Same object as in the list (raw access query and model query agree, timestamps included).
      const listed = (
        (await carol.get('/workspaces')).body as { items: { id: string }[] }
      ).items.find((w) => w.id === wsA);
      expect(get.body).toEqual(listed);
      expect(get.body).toEqual(
        expect.objectContaining({
          id: wsA,
          name: 'Workspace A',
          role: 'member',
        }),
      );
      // Created moments ago, stored and read back as UTC.
      const createdAt = new Date((get.body as { createdAt: string }).createdAt);
      expect(Math.abs(createdAt.getTime() - Date.now())).toBeLessThan(120_000);

      const members = await carol.get(`/workspaces/${wsA}/members`);
      expect(members.status).toBe(200);
      expect(members.headers['cache-control']).toBe('no-store');
      const items = (members.body as { items: Record<string, unknown>[] })
        .items;
      expect(
        items.map((m) => [m.userId, m.email, m.displayName, m.role]),
      ).toEqual([
        [aliceId, email('alice'), 'alice', 'owner'],
        [carolId, email('carol'), 'carol', 'member'],
      ]);
      expect(Object.keys(items[0]).sort()).toEqual([
        'displayName',
        'email',
        'joinedAt',
        'role',
        'userId',
      ]);

      const rename = await carol.patch(`/workspaces/${wsA}`, {
        name: 'Hijacked',
      });
      expectError(rename, 403, 'FORBIDDEN');
      expect((rename.body as ErrorBody).error.message).toBe(
        'You do not have permission to perform this action.',
      );
    });

    it('owner rename → 200 and one workspace.renamed audit row; renaming to the same name writes nothing', async () => {
      const before = (await auditRows(wsA)).length;
      const res = await alice.patch(`/workspaces/${wsA}`, {
        name: 'Workspace A+',
      });
      expect(res.status).toBe(200);
      expect(res.body).toEqual(
        expect.objectContaining({
          id: wsA,
          name: 'Workspace A+',
          role: 'owner',
        }),
      );
      const same = await alice.patch(`/workspaces/${wsA}`, {
        name: 'Workspace A+',
      });
      expect(same.status).toBe(200);

      const audit = (await auditRows(wsA)).slice(before);
      expect(audit).toEqual([
        expect.objectContaining({
          action: 'workspace.renamed',
          actorUserId: Number(aliceId),
          beforeData: { name: 'Workspace A' },
          afterData: { name: 'Workspace A+' },
        }),
      ]);
      await alice.patch(`/workspaces/${wsA}`, { name: 'Workspace A' });
    });
  });

  describe('cross-tenant denial: a non-member gets 404 everywhere, identical to a missing id', () => {
    const missing = '999999999999';

    it.each([
      ['GET', (ws: string) => `/workspaces/${ws}`],
      ['PATCH', (ws: string) => `/workspaces/${ws}`],
      ['GET', (ws: string) => `/workspaces/${ws}/members`],
      ['GET', (ws: string) => `/workspaces/${ws}/accounts`],
      ['POST', (ws: string) => `/workspaces/${ws}/accounts`],
    ] as const)('%s %s', async (method, path) => {
      const body =
        method === 'PATCH'
          ? { name: 'Mine now' }
          : method === 'POST'
            ? { displayName: 'Planted' }
            : undefined;
      const send = (target: string) =>
        bob.send(
          method.toLowerCase() as 'get' | 'patch' | 'post',
          path(target),
          {
            body,
          },
        );

      const foreign = await send(wsA);
      const absent = await send(missing);
      expectError(foreign, 404, 'NOT_FOUND');
      expect(withoutRequestId(foreign.body)).toEqual(
        withoutRequestId(absent.body),
      );
      expect((foreign.body as ErrorBody).error.message).toBe(
        'Workspace not found.',
      );
    });

    it.each([
      ['GET', undefined],
      ['PATCH', { displayName: 'Stolen', status: 'disabled' }],
      ['DELETE', undefined],
    ] as const)(
      '%s /accounts/:id of another workspace',
      async (method, body) => {
        const send = (id: string) =>
          bob.send(
            method.toLowerCase() as 'get' | 'patch' | 'delete',
            `/accounts/${id}`,
            {
              body,
            },
          );
        const foreign = await send(a1.id);
        const absent = await send(missing);
        expectError(foreign, 404, 'NOT_FOUND');
        expect(withoutRequestId(foreign.body)).toEqual(
          withoutRequestId(absent.body),
        );
        expect((foreign.body as ErrorBody).error.message).toBe(
          'Seller account not found.',
        );
      },
    );

    it('nothing changed in A after all of the above', async () => {
      expect(await accountRow(a1.id)).toEqual({
        displayName: 'Main Shop',
        status: 'active',
        meeshoSupplierId: 'SUP-001',
      });
      const list = (await alice.get(`/workspaces/${wsA}/accounts`)).body as {
        items: AccountBody[];
      };
      expect(list.items.map((a) => a.displayName)).toEqual([
        'Alpha Outlet',
        'Main Shop',
      ]);
      expect((await alice.get(`/workspaces/${wsA}`)).body).toEqual(
        expect.objectContaining({ name: 'Workspace A' }),
      );
    });

    it('Alice cannot reach B either, and nobody signed out reaches anything', async () => {
      expectError(await alice.get(`/workspaces/${wsB}`), 404, 'NOT_FOUND');
      const anonymous = new TestClient(ctx.server);
      await anonymous.primeCsrf();
      for (const res of [
        await anonymous.get('/workspaces'),
        await anonymous.get(`/workspaces/${wsA}`),
        await anonymous.get(`/workspaces/${wsA}/accounts`),
        await anonymous.get(`/accounts/${a1.id}`),
        await anonymous.patch(`/accounts/${a1.id}`, { displayName: 'x' }),
        await anonymous.delete(`/accounts/${a1.id}`),
      ]) {
        expectError(res, 401, 'UNAUTHORIZED');
      }
    });
  });

  describe('invalid ids → 400 naming the parameter', () => {
    it.each(['0', 'abc', '01', '-1', '1.5', '1e3', '12345678901234567'])(
      '%s',
      async (bad) => {
        for (const [res, field] of [
          [await alice.get(`/workspaces/${bad}`), 'workspaceId'],
          [
            await alice.patch(`/workspaces/${bad}`, { name: 'x' }),
            'workspaceId',
          ],
          [await alice.get(`/workspaces/${bad}/members`), 'workspaceId'],
          [await alice.get(`/workspaces/${bad}/accounts`), 'workspaceId'],
          [
            await alice.post(`/workspaces/${bad}/accounts`, {
              displayName: 'x',
            }),
            'workspaceId',
          ],
          [await alice.get(`/accounts/${bad}`), 'accountId'],
          [
            await alice.patch(`/accounts/${bad}`, { displayName: 'x' }),
            'accountId',
          ],
          [await alice.delete(`/accounts/${bad}`), 'accountId'],
        ] as const) {
          expectError(res, 400, 'VALIDATION_ERROR');
          expect((res.body as ErrorBody).error.details).toEqual([
            { field, reasons: ['must be a positive integer id'] },
          ]);
        }
      },
    );
  });

  describe('seller accounts', () => {
    it('create → 201 with string ids and ISO timestamps; audit seller_account.created', async () => {
      expect(a1).toEqual({
        id: expect.stringMatching(/^[1-9][0-9]*$/) as string,
        workspaceId: wsA,
        displayName: 'Main Shop',
        meeshoSupplierId: 'SUP-001',
        status: 'active',
        createdAt: expect.any(String) as string,
        updatedAt: expect.any(String) as string,
      });
      expect(new Date(a1.createdAt).toISOString()).toBe(a1.createdAt);
      const created = (await auditRows(wsA)).filter(
        (r) => r.action === 'seller_account.created' && r.entityId === a1.id,
      );
      expect(created).toEqual([
        expect.objectContaining({
          entityType: 'seller_account',
          sellerAccountId: Number(a1.id),
          actorUserId: Number(aliceId),
          beforeData: null,
          afterData: {
            displayName: 'Main Shop',
            meeshoSupplierId: 'SUP-001',
            status: 'active',
          },
        }),
      ]);
    });

    it('member: 200 on list and GET; 403 on create, PATCH and DELETE (and nothing changes)', async () => {
      expect((await carol.get(`/workspaces/${wsA}/accounts`)).status).toBe(200);
      const one = await carol.get(`/accounts/${a1.id}`);
      expect(one.status).toBe(200);
      expect(one.body).toEqual(a1);

      expectError(
        await carol.post(`/workspaces/${wsA}/accounts`, {
          displayName: 'By member',
        }),
        403,
        'FORBIDDEN',
      );
      expectError(
        await carol.patch(`/accounts/${a1.id}`, { displayName: 'By member' }),
        403,
        'FORBIDDEN',
      );
      expectError(await carol.delete(`/accounts/${a1.id}`), 403, 'FORBIDDEN');
      expect((await accountRow(a1.id)).displayName).toBe('Main Shop');
      expect((await accountRow(a1.id)).status).toBe('active');
    });

    it('409 for a duplicate displayName (case- and accent-insensitive) or supplier id, naming each field', async () => {
      const dupName = await alice.post(`/workspaces/${wsA}/accounts`, {
        displayName: 'main shöp',
      });
      expectError(dupName, 409, 'CONFLICT');
      expect((dupName.body as ErrorBody).error.details).toEqual([
        {
          field: 'displayName',
          reasons: [
            'Another seller account in this workspace already has this name.',
          ],
        },
      ]);

      const both = await alice.post(`/workspaces/${wsA}/accounts`, {
        displayName: 'MAIN SHOP',
        meeshoSupplierId: 'SUP-001',
      });
      expectError(both, 409, 'CONFLICT');
      expect(
        (both.body as ErrorBody).error.details?.map((d) => d.field),
      ).toEqual(['displayName', 'meeshoSupplierId']);

      // Supplier ids are exact (case-sensitive): a different case is a different id.
      const otherCase = await alice.post(`/workspaces/${wsA}/accounts`, {
        displayName: 'Case Shop',
        meeshoSupplierId: 'sup-001',
      });
      expect(otherCase.status).toBe(201);

      // Renaming onto another account's name is a conflict too.
      const rename = await alice.patch(`/accounts/${a2.id}`, {
        displayName: 'Main Shop',
      });
      expectError(rename, 409, 'CONFLICT');
      expect((rename.body as ErrorBody).error.details?.[0].field).toBe(
        'displayName',
      );

      // The same name is fine in another workspace.
      expect(
        (
          await bob.post(`/workspaces/${wsB}/accounts`, {
            displayName: 'Main Shop',
            meeshoSupplierId: 'SUP-001',
          })
        ).status,
      ).toBe(201);
    });

    it('PATCH: changed fields only in seller_account.updated; status changes are their own audit rows; no-op writes nothing', async () => {
      const start = (await auditRows(wsA)).length;

      const edit = await alice.patch(`/accounts/${a2.id}`, {
        displayName: 'Alpha Outlet',
        meeshoSupplierId: 'SUP-002',
      });
      expect(edit.status).toBe(200);
      expect(edit.body).toEqual(
        expect.objectContaining({
          id: a2.id,
          meeshoSupplierId: 'SUP-002',
          status: 'active',
        }),
      );
      expect(
        new Date((edit.body as AccountBody).updatedAt).getTime(),
      ).toBeGreaterThanOrEqual(new Date(a2.updatedAt).getTime());

      const noop = await alice.patch(`/accounts/${a2.id}`, {
        meeshoSupplierId: 'SUP-002',
      });
      expect(noop.status).toBe(200);
      const empty = await alice.patch(`/accounts/${a2.id}`, {});
      expect(empty.status).toBe(200);

      const disable = await alice.patch(`/accounts/${a2.id}`, {
        status: 'disabled',
      });
      expect((disable.body as AccountBody).status).toBe('disabled');
      const enable = await alice.patch(`/accounts/${a2.id}`, {
        status: 'active',
        meeshoSupplierId: null,
      });
      expect(enable.body).toEqual(
        expect.objectContaining({ status: 'active', meeshoSupplierId: null }),
      );

      const audit = (await auditRows(wsA)).slice(start);
      expect(audit.map((r) => [r.action, r.beforeData, r.afterData])).toEqual([
        [
          'seller_account.updated',
          { meeshoSupplierId: null },
          { meeshoSupplierId: 'SUP-002' },
        ],
        [
          'seller_account.disabled',
          { status: 'active' },
          { status: 'disabled' },
        ],
        [
          'seller_account.updated',
          { meeshoSupplierId: 'SUP-002' },
          { meeshoSupplierId: null },
        ],
        [
          'seller_account.enabled',
          { status: 'disabled' },
          { status: 'active' },
        ],
      ]);
      for (const row of audit) {
        expect(row.sellerAccountId).toBe(Number(a2.id));
        expect(row.actorUserId).toBe(Number(aliceId));
      }
    });

    it('DELETE disables (200, idempotent, never deletes); list still shows it', async () => {
      const start = (await auditRows(wsA)).length;
      const first = await alice.delete(`/accounts/${a2.id}`);
      expect(first.status).toBe(200);
      expect((first.body as AccountBody).status).toBe('disabled');
      const second = await alice.delete(`/accounts/${a2.id}`);
      expect(second.status).toBe(200);
      expect((second.body as AccountBody).status).toBe('disabled');

      expect(await accountRow(a2.id)).toEqual(
        expect.objectContaining({ status: 'disabled' }),
      );
      const audit = (await auditRows(wsA)).slice(start);
      expect(audit.map((r) => r.action)).toEqual(['seller_account.disabled']);

      const list = (await carol.get(`/workspaces/${wsA}/accounts`)).body as {
        items: AccountBody[];
      };
      expect(list.items.map((a) => [a.displayName, a.status])).toEqual([
        ['Alpha Outlet', 'disabled'],
        ['Case Shop', 'active'],
        ['Main Shop', 'active'],
      ]);
    });

    it('rejects client-chosen workspace ids and unknown fields in bodies', async () => {
      const res = await alice.post(`/workspaces/${wsA}/accounts`, {
        displayName: 'Sneaky',
        workspaceId: wsB,
      });
      expectError(res, 400, 'VALIDATION_ERROR');
      expect(
        (res.body as ErrorBody).error.details?.map((d) => d.field),
      ).toEqual(['workspaceId']);
    });

    it('responses never expose hashes or internal columns', async () => {
      const bodies = [
        (await alice.get('/auth/me')).body,
        (await alice.get('/workspaces')).body,
        (await alice.get(`/workspaces/${wsA}/members`)).body,
        (await alice.get(`/workspaces/${wsA}/accounts`)).body,
        (await alice.get(`/accounts/${a1.id}`)).body,
      ];
      const text = JSON.stringify(bodies);
      expect(text).not.toMatch(/password|token|hash|createdBy/i);
    });
  });
});
