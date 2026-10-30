import type { ImportJobStatus } from '../database/models';

/** An 'importing' job whose confirm started longer ago than this is treated as crashed. */
export const STALE_IMPORTING_MINUTES = 15;

export const IMPORT_ACTIONS = ['confirm', 'retry', 'cancel'] as const;
export type ImportAction = (typeof IMPORT_ACTIONS)[number];

/** confirmed_at before this instant marks an 'importing' job as stale (retryable / cancellable). */
export function staleImportingCutoff(now = Date.now()): Date {
  return new Date(now - STALE_IMPORTING_MINUTES * 60 * 1000);
}

export interface ActionFacts {
  status: ImportJobStatus;
  validRows: number | null;
  confirmedAt: Date | null;
  accountActive: boolean;
}

/**
 * What the caller may do with an import right now (every member may act; the server decides, the UI
 * only shows these):
 * - previewed: confirm (when it has valid rows and the account is active), cancel;
 * - failed, or importing for more than 15 minutes: retry (account active), cancel;
 * - anything else: nothing.
 */
export function allowedActions(
  facts: ActionFacts,
  now = Date.now(),
): ImportAction[] {
  const actions: ImportAction[] = [];
  const stale =
    facts.status === 'importing' &&
    facts.confirmedAt !== null &&
    facts.confirmedAt < staleImportingCutoff(now);
  if (facts.status === 'previewed') {
    if (facts.accountActive && (facts.validRows ?? 0) > 0) {
      actions.push('confirm');
    }
    actions.push('cancel');
  } else if (facts.status === 'failed' || stale) {
    if (facts.accountActive) actions.push('retry');
    actions.push('cancel');
  }
  return actions;
}
