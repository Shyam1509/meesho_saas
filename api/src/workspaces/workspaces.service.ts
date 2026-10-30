import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import type { Transaction } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { AuditService } from '../audit/audit.service';
import type { Actor } from '../auth/auth.types';
import { WorkspaceAccessService } from '../authorization/workspace-access.service';
import {
  User,
  Workspace,
  WorkspaceMember,
  type WorkspaceRole,
} from '../database/models';
import type {
  WorkspaceMemberDto,
  WorkspaceSummaryDto,
} from './dto/workspace.dto';

export function toWorkspaceSummary(
  workspace: { id: number; name: string; createdAt: Date },
  role: WorkspaceRole,
): WorkspaceSummaryDto {
  return {
    id: String(workspace.id),
    name: workspace.name,
    role,
    createdAt: workspace.createdAt.toISOString(),
  };
}

@Injectable()
export class WorkspacesService {
  constructor(
    @InjectConnection() private readonly sequelize: Sequelize,
    private readonly access: WorkspaceAccessService,
    private readonly audit: AuditService,
  ) {}

  /** The user's workspaces with their role, sorted by name, then id. */
  async listForUser(
    userId: number,
    transaction?: Transaction,
  ): Promise<WorkspaceSummaryDto[]> {
    const memberships = await WorkspaceMember.findAll({
      where: { userId },
      attributes: ['role'],
      include: [
        {
          model: Workspace,
          as: 'workspace',
          required: true,
          attributes: ['id', 'name', 'createdAt'],
        },
      ],
      order: [
        [{ model: Workspace, as: 'workspace' }, 'name', 'ASC'],
        [{ model: Workspace, as: 'workspace' }, 'id', 'ASC'],
      ],
      transaction,
    });
    return memberships.map((m) =>
      toWorkspaceSummary(m.workspace as Workspace, m.role),
    );
  }

  async create(actor: Actor, name: string): Promise<WorkspaceSummaryDto> {
    return this.sequelize.transaction((transaction) =>
      this.createOwned(actor, name, transaction),
    );
  }

  /** Creates a workspace owned by the actor, with its audit row, inside the caller's transaction. */
  async createOwned(
    actor: Actor,
    name: string,
    transaction: Transaction,
  ): Promise<WorkspaceSummaryDto> {
    const workspace = await Workspace.create(
      { name, createdByUserId: actor.userId },
      { transaction },
    );
    await WorkspaceMember.create(
      { workspaceId: workspace.id, userId: actor.userId, role: 'owner' },
      { transaction },
    );
    await this.audit.record(
      {
        action: 'workspace.created',
        entityType: 'workspace',
        entityId: workspace.id,
        workspaceId: workspace.id,
        actorUserId: actor.userId,
        requestId: actor.requestId,
        after: { name },
      },
      transaction,
    );
    return toWorkspaceSummary(workspace, 'owner');
  }

  async get(userId: number, workspaceId: string): Promise<WorkspaceSummaryDto> {
    const { workspace, role } = await this.access.requireWorkspace(
      userId,
      workspaceId,
      'member',
    );
    return toWorkspaceSummary(workspace, role);
  }

  /** Owner only. Writes `workspace.renamed` when the name actually changes. */
  async rename(
    actor: Actor,
    workspaceId: string,
    name: string,
  ): Promise<WorkspaceSummaryDto> {
    return this.sequelize.transaction(async (transaction) => {
      const { workspace, role } = await this.access.requireWorkspace(
        actor.userId,
        workspaceId,
        'owner',
        { transaction, lock: true },
      );
      if (workspace.name !== name) {
        await Workspace.update(
          { name },
          { where: { id: workspace.id }, transaction },
        );
        await this.audit.record(
          {
            action: 'workspace.renamed',
            entityType: 'workspace',
            entityId: workspace.id,
            workspaceId: workspace.id,
            actorUserId: actor.userId,
            requestId: actor.requestId,
            before: { name: workspace.name },
            after: { name },
          },
          transaction,
        );
      }
      return toWorkspaceSummary({ ...workspace, name }, role);
    });
  }

  /** Members of a workspace the caller belongs to, sorted by join time, then user id. */
  async listMembers(
    userId: number,
    workspaceId: string,
  ): Promise<WorkspaceMemberDto[]> {
    const { workspace } = await this.access.requireWorkspace(
      userId,
      workspaceId,
      'member',
    );
    const members = await WorkspaceMember.findAll({
      where: { workspaceId: workspace.id },
      attributes: ['userId', 'role', 'createdAt'],
      include: [
        {
          model: User,
          as: 'user',
          required: true,
          attributes: ['id', 'email', 'displayName'],
        },
      ],
      order: [
        ['createdAt', 'ASC'],
        ['userId', 'ASC'],
      ],
    });
    return members.map((m) => ({
      userId: String(m.userId),
      email: (m.user as User).email,
      displayName: (m.user as User).displayName,
      role: m.role,
      joinedAt: m.createdAt.toISOString(),
    }));
  }
}
