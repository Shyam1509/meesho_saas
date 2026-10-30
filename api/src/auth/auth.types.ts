import type { Request } from 'express';

/** The signed-in user as resolved from the session (ids are the database's numbers internally). */
export interface AuthenticatedUser {
  id: number;
  email: string;
  displayName: string | null;
}

/** What AuthGuard attaches to the request after validating the session cookie. */
export interface AuthContext {
  user: AuthenticatedUser;
  sessionId: number;
}

export type AuthenticatedRequest = Request & { auth?: AuthContext };

/** Who performs a change: used for authorisation and written to audit_logs. */
export interface Actor {
  userId: number;
  requestId: string;
}
