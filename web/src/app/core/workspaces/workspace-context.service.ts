import { Injectable, computed, inject } from '@angular/core';

import { AuthStateService } from '../auth/auth-state.service';
import { WorkspaceMembership } from '../auth/auth.models';
import { SelectedWorkspaceStore } from './selected-workspace.store';

export { SELECTED_WORKSPACE_STORAGE_KEY } from './selected-workspace.store';

/**
 * The workspace the screens work in: the user's pick (remembered in localStorage, forgotten when
 * the session ends) when they are still a member of it, otherwise their first workspace. Only ever
 * one of their memberships, so a stale or tampered stored id can never select someone else's
 * workspace.
 */
@Injectable({ providedIn: 'root' })
export class WorkspaceContextService {
  private readonly auth = inject(AuthStateService);
  private readonly store = inject(SelectedWorkspaceStore);

  readonly workspaces = this.auth.workspaces;
  readonly selected = computed<WorkspaceMembership | null>(() => {
    const workspaces = this.auth.workspaces();
    const preferred = this.store.preferredId();
    return workspaces.find((w) => w.id === preferred) ?? workspaces[0] ?? null;
  });
  /** Changes only when a different workspace is selected (not on a rename). */
  readonly selectedId = computed(() => this.selected()?.id ?? null);
  readonly role = computed(() => this.selected()?.role ?? null);
  readonly isOwner = computed(() => this.role() === 'owner');

  /** Selects one of the user's workspaces and remembers it. Returns false for any other id. */
  select(workspaceId: string): boolean {
    if (!this.auth.workspaces().some((w) => w.id === workspaceId)) {
      return false;
    }
    this.store.set(workspaceId);
    return true;
  }
}
