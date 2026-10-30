import { Injectable, signal } from '@angular/core';

/** localStorage key for the last workspace the user picked in the header. */
export const SELECTED_WORKSPACE_STORAGE_KEY = 'msaas.selectedWorkspaceId';

/** The API's id format (decimal BIGINT as a string). */
const WORKSPACE_ID_PATTERN = /^[1-9][0-9]{0,15}$/;

/**
 * The user's preferred workspace id, in memory and in localStorage. Depends on nothing, so both
 * `WorkspaceContextService` (reads, sets) and `AuthStateService` (clears when a session ends) can
 * use it. Storage can be missing or throw (private mode, blocked site data, quota): every access
 * is wrapped, and without it the choice simply is not remembered.
 */
@Injectable({ providedIn: 'root' })
export class SelectedWorkspaceStore {
  private readonly id = signal<string | null>(readStoredId());

  readonly preferredId = this.id.asReadonly();

  set(workspaceId: string): void {
    this.id.set(workspaceId);
    try {
      localStorage.setItem(SELECTED_WORKSPACE_STORAGE_KEY, workspaceId);
    } catch {
      // Not remembered; the in-memory choice still applies.
    }
  }

  /** Forgets the choice, so the next person on a shared machine starts clean. */
  clear(): void {
    this.id.set(null);
    try {
      localStorage.removeItem(SELECTED_WORKSPACE_STORAGE_KEY);
    } catch {
      // Nothing more we can do; a stale id is still validated against memberships on read.
    }
  }
}

function readStoredId(): string | null {
  try {
    const value = localStorage.getItem(SELECTED_WORKSPACE_STORAGE_KEY);
    return value !== null && WORKSPACE_ID_PATTERN.test(value) ? value : null;
  } catch {
    return null;
  }
}
