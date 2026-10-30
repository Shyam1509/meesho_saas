import { Injectable } from '@nestjs/common';
import { Op, type Transaction } from 'sequelize';
import { AppConfigService } from '../config/app-config.service';
import { User, UserSession } from '../database/models';
import type { AuthContext } from './auth.types';
import {
  generateOpaqueToken,
  isWellFormedToken,
  sha256Hex,
} from './opaque-token';
import {
  absoluteExpiry,
  idleCutoff,
  needsTouch,
  type SessionPolicy,
  sessionPolicy,
  sessionState,
} from './session-policy';

export interface IssuedSession {
  /** Opaque token for the cookie. Returned once; only its SHA-256 is stored. */
  token: string;
  absoluteExpiresAt: Date;
}

/** Server-side sessions in user_sessions: issue, validate (idle/absolute/revoked/disabled), revoke. */
@Injectable()
export class SessionService {
  constructor(private readonly config: AppConfigService) {}

  get policy(): SessionPolicy {
    return sessionPolicy(
      this.config.sessionIdleMinutes,
      this.config.sessionAbsoluteHours,
    );
  }

  async create(
    userId: number,
    transaction?: Transaction,
  ): Promise<IssuedSession> {
    const token = generateOpaqueToken();
    const now = new Date();
    const absoluteExpiresAt = absoluteExpiry(now, this.policy);
    await UserSession.create(
      {
        userId,
        tokenHash: sha256Hex(token),
        createdAt: now,
        lastUsedAt: now,
        absoluteExpiresAt,
      },
      { transaction },
    );
    return { token, absoluteExpiresAt };
  }

  /**
   * The user behind a session token, or null when the token is malformed, unknown, revoked, idle- or
   * absolute-expired, or its user is disabled. Refreshes last_used_at at most every 5 minutes.
   */
  async authenticate(token: string): Promise<AuthContext | null> {
    if (!isWellFormedToken(token)) return null;
    const session = await UserSession.findOne({
      where: { tokenHash: sha256Hex(token) },
      attributes: ['id', 'lastUsedAt', 'absoluteExpiresAt', 'revokedAt'],
      include: [
        {
          model: User,
          as: 'user',
          required: true,
          attributes: ['id', 'email', 'displayName', 'status'],
        },
      ],
    });
    const user = session?.user;
    if (!session || !user || user.status !== 'active') return null;

    const now = new Date();
    if (sessionState(session, now, this.policy) !== 'active') return null;
    if (needsTouch(session.lastUsedAt, now)) {
      await UserSession.update(
        { lastUsedAt: now },
        { where: { id: session.id, revokedAt: null } },
      );
    }
    return {
      sessionId: session.id,
      user: { id: user.id, email: user.email, displayName: user.displayName },
    };
  }

  /** Revokes the session behind `token`, if any (idempotent; unknown or malformed tokens are ignored). */
  async revoke(token: string, transaction?: Transaction): Promise<void> {
    if (!isWellFormedToken(token)) return;
    await UserSession.update(
      { revokedAt: new Date() },
      { where: { tokenHash: sha256Hex(token), revokedAt: null }, transaction },
    );
  }

  /** Deletes the user's revoked and expired sessions (called at login, so the table does not grow). */
  async purgeEndedForUser(
    userId: number,
    transaction?: Transaction,
  ): Promise<void> {
    const now = new Date();
    await UserSession.destroy({
      where: {
        userId,
        [Op.or]: [
          { revokedAt: { [Op.ne]: null } },
          { absoluteExpiresAt: { [Op.lte]: now } },
          { lastUsedAt: { [Op.lte]: idleCutoff(now, this.policy) } },
        ],
      },
      transaction,
    });
  }
}
