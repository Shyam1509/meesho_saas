import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { NonNullableFormBuilder, ReactiveFormsModule } from '@angular/forms';
import { Observable, Subject, catchError, map, merge, of, startWith, switchMap } from 'rxjs';

import { describeApiError, toApiError } from '../../core/api/api-error';
import { AuthStateService } from '../../core/auth/auth-state.service';
import { NAME_MAX_LENGTH, roleLabel } from '../../core/auth/auth.models';
import { WorkspaceContextService } from '../../core/workspaces/workspace-context.service';
import { WorkspaceMember } from '../../core/workspaces/workspace.models';
import { WorkspacesApiService } from '../../core/workspaces/workspaces-api.service';
import {
  applyServerFieldErrors,
  errorMessage,
  focusFirstInvalidControl,
  maxLengthTrimmed,
  requiredTrimmed,
  showError,
} from '../../shared/forms/form-helpers';

type MembersState =
  | { kind: 'loading' }
  | { kind: 'ready'; members: WorkspaceMember[] }
  | { kind: 'error'; message: string };

/**
 * The selected workspace: its name (owners can rename it), the caller's role and the members list.
 * Members are read-only here; inviting and managing them is a later milestone.
 */
@Component({
  selector: 'app-workspace-settings-page',
  imports: [ReactiveFormsModule, DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './workspace-settings-page.html',
})
export class WorkspaceSettingsPage {
  private readonly auth = inject(AuthStateService);
  private readonly context = inject(WorkspaceContextService);
  private readonly api = inject(WorkspacesApiService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  private readonly destroyRef = inject(DestroyRef);
  private readonly errorAlert = viewChild<ElementRef<HTMLElement>>('renameErrorAlert');
  private readonly memberReloads = new Subject<void>();

  protected readonly workspace = this.context.selected;
  protected readonly isOwner = this.context.isOwner;
  protected readonly roleText = computed(() => {
    const role = this.context.role();
    return role ? roleLabel(role) : '';
  });
  protected readonly roleLabel = roleLabel;

  protected readonly form = inject(NonNullableFormBuilder).group({
    name: ['', [requiredTrimmed, maxLengthTrimmed(NAME_MAX_LENGTH)]],
  });
  protected readonly messages = {
    name: {
      required: 'Enter a workspace name.',
      maxlength: `Workspace name must be at most ${NAME_MAX_LENGTH} characters.`,
    },
  } as const;
  protected readonly renaming = signal(false);
  protected readonly renameError = signal<string | null>(null);
  protected readonly renameNotice = signal('');
  protected readonly members = signal<MembersState>({ kind: 'loading' });
  protected readonly showError = showError;
  protected readonly errorMessage = errorMessage;

  constructor() {
    // Show the selected workspace's current name in the rename field.
    effect(() => {
      const workspace = this.workspace();
      untracked(() => {
        this.form.reset({ name: workspace?.name ?? '' });
        this.renameError.set(null);
      });
    });

    merge(
      toObservable(this.context.selectedId),
      this.memberReloads.pipe(map(() => this.context.selectedId())),
    )
      .pipe(
        switchMap((workspaceId) => this.loadMembers(workspaceId)),
        takeUntilDestroyed(),
      )
      .subscribe((state) => this.members.set(state));
  }

  protected retryMembers(): void {
    this.memberReloads.next();
  }

  /** `PATCH /workspaces/:id { name }` (owners only; the API enforces it too). */
  protected rename(): void {
    const workspace = this.workspace();
    if (!workspace || !this.isOwner() || this.renaming()) {
      return;
    }
    this.renameError.set(null);
    this.renameNotice.set('');
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      focusFirstInvalidControl(this.host.nativeElement, this.form);
      return;
    }
    const name = this.form.controls.name.value.trim();
    if (name === workspace.name) {
      this.renameNotice.set('The name is unchanged.');
      return;
    }

    this.renaming.set(true);
    this.api
      .rename(workspace.id, name)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (summary) => {
          this.renaming.set(false);
          this.auth.renameWorkspace(summary.id, summary.name);
          this.renameNotice.set(`Workspace renamed to ${summary.name}.`);
        },
        error: (error: unknown) => {
          this.renaming.set(false);
          applyServerFieldErrors(this.form, toApiError(error));
          this.renameError.set(describeApiError(error));
          afterNextRender(() => this.errorAlert()?.nativeElement.focus(), {
            injector: this.injector,
          });
        },
      });
  }

  private loadMembers(workspaceId: string | null): Observable<MembersState> {
    if (workspaceId === null) {
      return of<MembersState>({ kind: 'ready', members: [] });
    }
    return this.api.members(workspaceId).pipe(
      map((members): MembersState => ({ kind: 'ready', members })),
      catchError((error: unknown) =>
        of<MembersState>({ kind: 'error', message: describeApiError(error) }),
      ),
      startWith<MembersState>({ kind: 'loading' }),
    );
  }
}
