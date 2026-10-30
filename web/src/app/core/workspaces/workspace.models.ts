import { WorkspaceRole } from '../auth/auth.models';

/** `GET /workspaces/:id`, `PATCH /workspaces/:id`. `role` is the caller's role. */
export interface WorkspaceSummary {
  id: string;
  name: string;
  role: WorkspaceRole;
  /** ISO-8601 UTC. */
  createdAt: string;
}

/** One row of `GET /workspaces/:id/members`. */
export interface WorkspaceMember {
  userId: string;
  email: string;
  displayName: string | null;
  role: WorkspaceRole;
  /** ISO-8601 UTC. */
  joinedAt: string;
}

/** `{ items: T[] }`, the API's list shape. */
export interface ListResponse<T> {
  items: T[];
}
