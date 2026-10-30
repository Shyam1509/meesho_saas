import { randomBytes } from 'node:crypto';
import { Injectable, type OnModuleInit } from '@nestjs/common';
import * as argon2 from 'argon2';

/**
 * Argon2id with the argon2 library's defaults (64 MiB, 3 passes, 4 lanes), spelled out so that
 * needsRehash() keeps working if the library's defaults change.
 */
export const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 65_536,
  timeCost: 3,
  parallelism: 4,
} as const;

/** Password hashing. Hashes are only ever compared here; they never leave the server. */
@Injectable()
export class PasswordHasherService implements OnModuleInit {
  private dummyHash?: Promise<string>;

  /** Precompute the dummy hash so the first unknown-email login costs the same as any other. */
  async onModuleInit(): Promise<void> {
    await this.getDummyHash();
  }

  hash(password: string): Promise<string> {
    return argon2.hash(password, ARGON2_OPTIONS);
  }

  /** False for a wrong password and for a malformed stored hash (never throws on bad input). */
  async verify(hash: string, password: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, password);
    } catch {
      return false;
    }
  }

  /** True when the stored hash uses weaker parameters than ARGON2_OPTIONS (or cannot be parsed). */
  needsRehash(hash: string): boolean {
    try {
      return argon2.needsRehash(hash, ARGON2_OPTIONS);
    } catch {
      return true;
    }
  }

  /**
   * Same work as verify() against a hash nobody knows the password of: used when the email is unknown,
   * so response time does not reveal whether an account exists.
   */
  async verifyDummy(password: string): Promise<void> {
    await this.verify(await this.getDummyHash(), password);
  }

  private getDummyHash(): Promise<string> {
    this.dummyHash ??= this.hash(randomBytes(32).toString('base64url'));
    return this.dummyHash;
  }
}
