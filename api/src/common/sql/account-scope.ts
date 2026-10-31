/**
 * The workspace + seller account ids every account-scoped query filters on. Always taken from
 * WorkspaceAccessService.requireAccount (the resolved row), never from the client.
 */
export interface AccountScope {
  workspaceId: number;
  sellerAccountId: number;
}

export function scopeOf(account: {
  id: number;
  workspaceId: number;
}): AccountScope {
  return { workspaceId: account.workspaceId, sellerAccountId: account.id };
}

/** WHERE conditions (joined with AND) and their named replacements; values are never spliced into SQL. */
export interface SqlFilter {
  conditions: string[];
  replacements: Record<string, unknown>;
}

export function whereClause(filter: SqlFilter): string {
  return filter.conditions.length > 0
    ? `WHERE ${filter.conditions.join('\n         AND ')}`
    : '';
}
