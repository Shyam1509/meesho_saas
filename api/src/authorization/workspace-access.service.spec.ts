import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { Transaction } from 'sequelize';
import type { Sequelize } from 'sequelize-typescript';
import { hasRole } from './roles';
import {
  ACCOUNT_NOT_FOUND_MESSAGE,
  INSUFFICIENT_ROLE_MESSAGE,
  WORKSPACE_NOT_FOUND_MESSAGE,
  WorkspaceAccessService,
} from './workspace-access.service';

describe('hasRole', () => {
  it.each([
    ['owner', 'owner', true],
    ['owner', 'member', true],
    ['member', 'member', true],
    ['member', 'owner', false],
  ] as const)('%s satisfies %s: %s', (role, minRole, expected) => {
    expect(hasRole(role, minRole)).toBe(expected);
  });
});

describe('WorkspaceAccessService (query stubbed)', () => {
  const created = new Date('2026-10-30T00:00:00.000Z');
  let query: jest.Mock;
  let service: WorkspaceAccessService;

  beforeEach(() => {
    query = jest.fn();
    service = new WorkspaceAccessService({ query } as unknown as Sequelize);
  });

  it('returns the workspace and role for a member with enough role', async () => {
    query.mockResolvedValue([
      {
        id: 7,
        name: 'W',
        createdAt: created,
        updatedAt: created,
        role: 'owner',
      },
    ]);

    await expect(service.requireWorkspace(1, '7', 'owner')).resolves.toEqual({
      workspace: { id: 7, name: 'W', createdAt: created, updatedAt: created },
      role: 'owner',
    });
    const [sql, options] = query.mock.calls[0] as [
      string,
      { replacements: unknown },
    ];
    expect(sql).toContain('JOIN workspace_members m');
    expect(sql).toContain('CAST(:workspaceId AS UNSIGNED)');
    expect(sql).not.toContain('FOR UPDATE');
    expect(options.replacements).toEqual({ userId: 1, workspaceId: '7' });
  });

  it('404 when no row (missing OR not a member): same error either way', async () => {
    query.mockResolvedValue([]);
    await expect(service.requireWorkspace(1, '7', 'member')).rejects.toEqual(
      new NotFoundException(WORKSPACE_NOT_FOUND_MESSAGE),
    );
    await expect(service.requireAccount(1, '9', 'member')).rejects.toEqual(
      new NotFoundException(ACCOUNT_NOT_FOUND_MESSAGE),
    );
  });

  it('403 for a member asking for an owner action', async () => {
    query.mockResolvedValue([
      {
        id: 9,
        workspaceId: 7,
        displayName: 'A',
        meeshoSupplierId: null,
        status: 'active',
        createdAt: created,
        updatedAt: created,
        role: 'member',
      },
    ]);
    await expect(service.requireAccount(1, '9', 'owner')).rejects.toEqual(
      new ForbiddenException(INSUFFICIENT_ROLE_MESSAGE),
    );
    await expect(service.requireAccount(1, '9', 'member')).resolves.toEqual(
      expect.objectContaining({ role: 'member' }),
    );
  });

  it('adds FOR UPDATE only with lock + transaction, and refuses lock without a transaction', async () => {
    query.mockResolvedValue([]);
    const transaction = {} as Transaction;
    await expect(
      service.requireAccount(1, '9', 'owner', { transaction, lock: true }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect((query.mock.calls[0] as [string])[0]).toContain('FOR UPDATE');

    await expect(
      service.requireAccount(1, '9', 'owner', { lock: true }),
    ).rejects.toThrow('lock requires a transaction');
  });
});
