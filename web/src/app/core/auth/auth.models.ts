/** A user's role in one workspace. `owner` can do everything a `member` can, plus changes. */
export type WorkspaceRole = 'owner' | 'member';

/** The signed-in user, as `GET /auth/me` returns it. */
export interface AuthUser {
  id: string;
  email: string;
  displayName: string | null;
}

/** One workspace the signed-in user belongs to, with their role in it. */
export interface WorkspaceMembership {
  id: string;
  name: string;
  role: WorkspaceRole;
}

/** Body of `GET /auth/me`, `POST /auth/login` and `POST /auth/register`. */
export interface MeResponse {
  user: AuthUser;
  /** Sorted by name, then id. */
  workspaces: WorkspaceMembership[];
}

/** Body of `GET /auth/config`. */
export interface AuthConfig {
  registrationEnabled: boolean;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface RegisterRequest {
  email: string;
  password: string;
  /** 1–120 characters; omitted when the user left it blank. */
  displayName?: string;
  /** 1–120 characters; the API names it "My workspace" when omitted. */
  workspaceName?: string;
}

/** Password length rules shared with the API (NIST 800-63B: length only, no composition rules). */
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;
export const EMAIL_MAX_LENGTH = 254;
export const NAME_MAX_LENGTH = 120;

/** Readable cookie the API sets for the double-submit CSRF check, and the header that echoes it. */
export const XSRF_COOKIE_NAME = 'msaas_xsrf';
export const XSRF_HEADER_NAME = 'X-XSRF-TOKEN';

/** Where a signed-in user lands when there is no (safe) return URL. */
export const DEFAULT_SIGNED_IN_URL = '/overview';

/** "Owner" / "Member". */
export function roleLabel(role: WorkspaceRole): string {
  return role === 'owner' ? 'Owner' : 'Member';
}
