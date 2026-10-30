import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { Sequelize } from 'sequelize-typescript';
import { FieldConflictException } from '../common/errors/field-conflict.exception';
import { uniqueConflictDetails } from '../common/errors/unique-conflict';
import { AppConfigService } from '../config/app-config.service';
import { User } from '../database/models';
import { WorkspacesService } from '../workspaces/workspaces.service';
import type { AuthenticatedUser } from './auth.types';
import type { LoginDto, RegisterDto } from './dto/auth-request.dto';
import type { MeResponseDto } from './dto/auth-response.dto';
import { LoginAttemptLimiter } from './login-attempt-limiter.service';
import { PasswordHasherService } from './password-hasher.service';
import { SessionService } from './session.service';

/** The one message for unknown email, wrong password and disabled user (no account enumeration). */
export const INVALID_CREDENTIALS_MESSAGE = 'Invalid email or password.';
export const REGISTRATION_DISABLED_MESSAGE = 'Registration is disabled.';
export const EMAIL_TAKEN_MESSAGE = 'An account with this email already exists.';
export const EMAIL_TAKEN_REASON = 'email is already registered';
export const TOO_MANY_ATTEMPTS_MESSAGE =
  'Too many failed sign-in attempts. Please try again later.';
export const DEFAULT_WORKSPACE_NAME = 'My workspace';

/** 429 from the failed-login limiter; the controller turns retryAfterSeconds into Retry-After. */
export class TooManyLoginAttemptsException extends HttpException {
  constructor(readonly retryAfterSeconds: number) {
    super(TOO_MANY_ATTEMPTS_MESSAGE, HttpStatus.TOO_MANY_REQUESTS);
  }
}

export interface SignedIn {
  /** New session token for the cookie. */
  token: string;
  me: MeResponseDto;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @InjectConnection() private readonly sequelize: Sequelize,
    private readonly config: AppConfigService,
    private readonly hasher: PasswordHasherService,
    private readonly sessions: SessionService,
    private readonly limiter: LoginAttemptLimiter,
    private readonly workspaces: WorkspacesService,
  ) {}

  /**
   * Creates user + workspace (owner membership, audit row) + session in ONE transaction. A session the
   * caller already presented is revoked (no fixation). 403 when registration is disabled, 409 when the
   * email is taken (accepted enumeration trade-off: registration is env-gated and rate-limited).
   */
  async register(
    dto: RegisterDto,
    presentedToken: string | undefined,
    requestId: string,
  ): Promise<SignedIn> {
    if (!this.config.authRegistrationEnabled) {
      throw new ForbiddenException(REGISTRATION_DISABLED_MESSAGE);
    }
    // Hash before opening the transaction: Argon2 is deliberately slow.
    const passwordHash = await this.hasher.hash(dto.password);
    try {
      const { user, token } = await this.sequelize.transaction(
        async (transaction) => {
          const taken = await User.count({
            where: { email: dto.email },
            transaction,
          });
          if (taken > 0) throw emailTaken();
          const created = await User.create(
            {
              email: dto.email,
              passwordHash,
              displayName: dto.displayName ?? null,
              lastLoginAt: new Date(),
            },
            { transaction },
          );
          await this.workspaces.createOwned(
            { userId: created.id, requestId },
            dto.workspaceName ?? DEFAULT_WORKSPACE_NAME,
            transaction,
          );
          if (presentedToken) {
            await this.sessions.revoke(presentedToken, transaction);
          }
          const session = await this.sessions.create(created.id, transaction);
          return { user: created, token: session.token };
        },
      );
      this.logger.log(
        { event: 'auth.registered', userId: user.id },
        'User registered',
      );
      return { token, me: await this.me(userOf(user)) };
    } catch (err) {
      if (uniqueConflictDetails(err, { uq_users_email: EMAIL_FIELD })) {
        throw emailTaken();
      }
      throw err;
    }
  }

  /**
   * Same 401 for unknown email, wrong password and disabled user, with the same Argon2 work in each case.
   * 429 after 5 failures in 15 minutes for this email from this client IP, or 50 for this email from all
   * IPs (whether or not the email exists). Success revokes the presented session, deletes the user's ended
   * sessions and issues a new one.
   */
  async login(
    dto: LoginDto,
    presentedToken: string | undefined,
    clientIp: string | undefined,
  ): Promise<SignedIn> {
    const retryAfter = this.limiter.retryAfterSeconds(dto.email, clientIp);
    if (retryAfter !== null) {
      this.logger.warn({ event: 'auth.login_blocked' }, 'Login blocked');
      throw new TooManyLoginAttemptsException(retryAfter);
    }

    const user = await User.findOne({
      where: { email: dto.email },
      attributes: ['id', 'email', 'displayName', 'passwordHash', 'status'],
    });
    let passwordOk = false;
    if (user) {
      passwordOk = await this.hasher.verify(user.passwordHash, dto.password);
    } else {
      await this.hasher.verifyDummy(dto.password);
    }
    if (!user || !passwordOk || user.status !== 'active') {
      this.limiter.recordFailure(dto.email, clientIp);
      // Never the email: only whether an account matched.
      this.logger.warn(
        { event: 'auth.login_failed', userId: user?.id },
        'Login failed',
      );
      throw new UnauthorizedException(INVALID_CREDENTIALS_MESSAGE);
    }
    this.limiter.recordSuccess(dto.email, clientIp);

    const rehash = this.hasher.needsRehash(user.passwordHash)
      ? await this.hasher.hash(dto.password)
      : undefined;
    const token = await this.sequelize.transaction(async (transaction) => {
      await user.update(
        {
          lastLoginAt: new Date(),
          ...(rehash ? { passwordHash: rehash } : {}),
        },
        { transaction },
      );
      if (presentedToken) {
        await this.sessions.revoke(presentedToken, transaction);
      }
      await this.sessions.purgeEndedForUser(user.id, transaction);
      return (await this.sessions.create(user.id, transaction)).token;
    });
    this.logger.log(
      { event: 'auth.login_succeeded', userId: user.id },
      'Login succeeded',
    );
    return { token, me: await this.me(userOf(user)) };
  }

  /** Revokes the presented session, if any. Always succeeds (logout is idempotent). */
  async logout(presentedToken: string | undefined): Promise<void> {
    if (presentedToken) await this.sessions.revoke(presentedToken);
  }

  async me(user: AuthenticatedUser): Promise<MeResponseDto> {
    const workspaces = await this.workspaces.listForUser(user.id);
    return {
      user: {
        id: String(user.id),
        email: user.email,
        displayName: user.displayName,
      },
      workspaces: workspaces.map(({ id, name, role }) => ({ id, name, role })),
    };
  }
}

const EMAIL_FIELD = { field: 'email', reason: EMAIL_TAKEN_REASON };

function emailTaken(): FieldConflictException {
  return new FieldConflictException(EMAIL_TAKEN_MESSAGE, [
    { field: EMAIL_FIELD.field, reasons: [EMAIL_FIELD.reason] },
  ]);
}

function userOf(user: User): AuthenticatedUser {
  return { id: user.id, email: user.email, displayName: user.displayName };
}
