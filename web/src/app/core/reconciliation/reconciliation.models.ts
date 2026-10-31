import { PageQuery } from '../api/paged-response';
import { UserRef } from '../api/refs';

export type ReconciliationTriggerType = 'import' | 'manual';

export type ReconciliationRunStatus = 'running' | 'completed' | 'failed';

/** One matching run: after every completed import (`import`) or on request (`manual`). */
export interface RunSummary {
  id: string;
  triggerType: ReconciliationTriggerType;
  status: ReconciliationRunStatus;
  importJobId: string | null;
  triggeredBy: UserRef | null;
  startedAt: string;
  finishedAt: string | null;
  matchedCount: number | null;
  unmatchedSettlementCount: number | null;
  unmatchedOrderCount: number | null;
  failureMessage: string | null;
}

/** `GET /accounts/:accountId/reconciliation`. Amounts are as-reported sums (`null` = no rows). */
export interface ReconciliationOverview {
  lastRun: RunSummary | null;
  settlements: {
    total: number;
    matched: number;
    unmatched: number;
    accountLevel: number;
    matchedAmount: string | null;
    unmatchedAmount: string | null;
    accountLevelAmount: string | null;
  };
  orders: {
    total: number;
    withSettlement: number;
    withoutSettlement: number;
  };
  withoutSettlementByStatus: { status: string; count: number }[];
}

/** Body of `POST …/reconciliation/manual-match` (owner). */
export interface ManualMatchRequest {
  settlementEntryId: string;
  orderId: string;
}

/** Body of `POST …/reconciliation/manual-unmatch` (owner). */
export interface ManualUnmatchRequest {
  settlementEntryId: string;
}

export type RunsQuery = PageQuery;

const TRIGGER_LABELS: Record<ReconciliationTriggerType, string> = {
  import: 'After an import',
  manual: 'Run by hand',
};

const RUN_STATUS_LABELS: Record<ReconciliationRunStatus, string> = {
  running: 'Running',
  completed: 'Completed',
  failed: 'Failed',
};

export function runTriggerLabel(trigger: string): string {
  return TRIGGER_LABELS[trigger as ReconciliationTriggerType] ?? trigger;
}

export function runStatusLabel(status: string): string {
  return RUN_STATUS_LABELS[status as ReconciliationRunStatus] ?? status;
}
