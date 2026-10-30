import type { WorkspaceRole } from '../database/models';

/** Higher rank includes every permission of a lower one: owner ⊇ member. */
const ROLE_RANK: Readonly<Record<WorkspaceRole, number>> = {
  member: 1,
  owner: 2,
};

/** Whether `role` grants at least `minRole`. */
export function hasRole(role: WorkspaceRole, minRole: WorkspaceRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[minRole];
}
