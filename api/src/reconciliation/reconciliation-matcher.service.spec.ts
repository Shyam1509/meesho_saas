import type { Transaction } from 'sequelize';
import type { Sequelize } from 'sequelize-typescript';
import { ReconciliationRun } from '../database/models';
import { HAS_SETTLEMENT_SQL } from '../orders/order-queries';
import {
  MATCH_STATE_SQL,
  NOT_SUPERSEDED_SQL,
} from '../settlements/settlement-entry-queries';
import {
  AUTO_MATCH_SQL,
  AUTO_MATCH_SQL_BY_TRIGGER,
  EXCEPTION_COUNTS_SQL,
  ReconciliationMatcherService,
} from './reconciliation-matcher.service';
import { toRunSummaryDto } from './reconciliation.service';

/** Whitespace-normalised SQL, so assertions do not depend on indentation. */
const flat = (sql: string) => sql.replace(/\s+/g, ' ').trim();

describe('auto-match rule (AUTO_MATCH_SQL)', () => {
  const sql = flat(AUTO_MATCH_SQL);

  it('joins the order of the SAME account by the SAME sub order no', () => {
    expect(sql).toContain(
      'JOIN orders o ON o.seller_account_id = se.seller_account_id AND o.sub_order_no = se.sub_order_no',
    );
    expect(sql).toContain('WHERE se.seller_account_id = :sellerAccountId');
    expect(sql).toContain('se.workspace_id = :workspaceId');
  });

  it.each([
    [
      'only entries with a sub order no (account-level entries never)',
      'se.sub_order_no IS NOT NULL',
    ],
    [
      'never re-points or touches an existing (auto or manual) match',
      'se.order_id IS NULL',
    ],
    ['skips superseded entries', 'se.superseded_by_entry_id IS NULL'],
    ['skips entries blocked by a manual unmatch', 'se.auto_match_blocked = 0'],
  ])('%s', (_rule, condition) => {
    expect(sql.slice(sql.indexOf(' WHERE '))).toContain(condition);
  });

  it("sets an 'auto' match with its time (satisfies the match CHECKs) and no user", () => {
    expect(sql).toContain(
      "SET se.order_id = o.id, se.match_method = 'auto', se.matched_at = :now, se.matched_by_user_id = NULL, se.updated_at = :now",
    );
  });

  it('exception counts are built from the SAME fragments as the overview and the exception lists', () => {
    const counts = flat(EXCEPTION_COUNTS_SQL);
    expect(counts).toContain(
      `AND (${flat(MATCH_STATE_SQL.unmatched)}) AND ${flat(NOT_SUPERSEDED_SQL)}) AS unmatchedSettlements`,
    );
    expect(counts).toContain(
      `AND NOT ${flat(HAS_SETTLEMENT_SQL)}) AS unmatchedOrders`,
    );
  });
});

describe('import runs only look at what the job can newly match', () => {
  it('a settlement import: its own entries only', () => {
    const sql = flat(AUTO_MATCH_SQL_BY_TRIGGER.settlement_xlsx);
    expect(sql).toContain('AND se.import_job_id = :importJobId');
    expect(sql).not.toContain('first_import_job_id');
  });

  it('an orders import: entries waiting for orders this job created', () => {
    const sql = flat(AUTO_MATCH_SQL_BY_TRIGGER.orders_csv);
    expect(sql).toContain('AND o.first_import_job_id = :importJobId');
    expect(sql).not.toContain('se.import_job_id');
  });

  it('both keep the full candidate rule; the manual run has no job condition', () => {
    for (const sql of Object.values(AUTO_MATCH_SQL_BY_TRIGGER)) {
      expect(flat(sql)).toContain('AND se.auto_match_blocked = 0');
      expect(flat(sql)).toContain(
        'se.order_id IS NULL AND se.sub_order_no IS NOT NULL',
      );
    }
    expect(AUTO_MATCH_SQL).not.toContain(':importJobId');
  });
});

describe('ReconciliationMatcherService.matchAndRecord (query stubbed)', () => {
  const transaction = {} as Transaction;
  let query: jest.Mock;
  let create: jest.SpyInstance;
  let service: ReconciliationMatcherService;

  beforeEach(() => {
    query = jest
      .fn()
      .mockResolvedValueOnce([undefined, 4])
      .mockResolvedValueOnce([
        { unmatchedSettlements: 1, unmatchedOrders: '3' },
      ]);
    create = jest
      .spyOn(ReconciliationRun, 'create')
      .mockImplementation((values) =>
        Promise.resolve({ id: 9, ...values } as unknown as ReconciliationRun),
      );
    service = new ReconciliationMatcherService({
      query,
    } as unknown as Sequelize);
  });

  afterEach(() => create.mockRestore());

  it('runs the UPDATE in the caller transaction with UTC "now", then records an import run with the counts', async () => {
    await service.matchAndRecord(
      { workspaceId: 2, sellerAccountId: 3 },
      {
        type: 'import',
        importJobId: 12,
        reportType: 'settlement_xlsx',
        userId: 7,
      },
      transaction,
    );
    const [sql, options] = query.mock.calls[0] as [
      string,
      { replacements: Record<string, unknown>; transaction: unknown },
    ];
    expect(sql).toBe(AUTO_MATCH_SQL_BY_TRIGGER.settlement_xlsx);
    expect(options.transaction).toBe(transaction);
    expect(options.replacements).toEqual({
      workspaceId: 2,
      sellerAccountId: 3,
      importJobId: 12,
      now: expect.stringMatching(
        /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}$/,
      ) as string,
    });
    expect(
      (query.mock.calls[1] as [string, { transaction: unknown }])[1]
        .transaction,
    ).toBe(transaction);
    const [values, createOptions] = create.mock.calls[0] as [
      Record<string, unknown>,
      { transaction: unknown },
    ];
    expect(values).toEqual(
      expect.objectContaining({
        workspaceId: 2,
        sellerAccountId: 3,
        triggerType: 'import',
        importJobId: 12,
        triggeredByUserId: 7,
        status: 'completed',
        matchedCount: 4,
        unmatchedSettlementCount: 1,
        unmatchedOrderCount: 3,
      }),
    );
    expect(values.startedAt).toBeInstanceOf(Date);
    expect(values.finishedAt).toBeInstanceOf(Date);
    expect(createOptions.transaction).toBe(transaction);
  });

  it('a manual run has no import job and scans the whole account', async () => {
    await service.matchAndRecord(
      { workspaceId: 2, sellerAccountId: 3 },
      { type: 'manual', userId: 8 },
      transaction,
    );
    expect((query.mock.calls[0] as [string])[0]).toBe(AUTO_MATCH_SQL);
    const [values] = create.mock.calls[0] as [Record<string, unknown>];
    expect(values).toEqual(
      expect.objectContaining({
        triggerType: 'manual',
        importJobId: null,
        triggeredByUserId: 8,
      }),
    );
  });
});

describe('toRunSummaryDto', () => {
  it('maps ids to strings, the user to a ref and timestamps to ISO', () => {
    expect(
      toRunSummaryDto({
        id: 9,
        triggerType: 'import',
        status: 'completed',
        importJobId: 12,
        startedAt: new Date('2026-10-31T10:00:00.000Z'),
        finishedAt: new Date('2026-10-31T10:00:00.250Z'),
        matchedCount: 4,
        unmatchedSettlementCount: 1,
        unmatchedOrderCount: 3,
        failureMessage: null,
        triggeredById: 7,
        triggeredByDisplayName: null,
        triggeredByEmail: 'a@example.test',
      }),
    ).toEqual({
      id: '9',
      triggerType: 'import',
      status: 'completed',
      importJobId: '12',
      triggeredBy: { id: '7', displayName: null, email: 'a@example.test' },
      startedAt: '2026-10-31T10:00:00.000Z',
      finishedAt: '2026-10-31T10:00:00.250Z',
      matchedCount: 4,
      unmatchedSettlementCount: 1,
      unmatchedOrderCount: 3,
      failureMessage: null,
    });
  });

  it('a failed manual run: no import job, null counts', () => {
    const dto = toRunSummaryDto({
      id: 10,
      triggerType: 'manual',
      status: 'failed',
      importJobId: null,
      startedAt: new Date('2026-10-31T10:00:00.000Z'),
      finishedAt: null,
      matchedCount: null,
      unmatchedSettlementCount: null,
      unmatchedOrderCount: null,
      failureMessage: 'x',
      triggeredById: null,
      triggeredByDisplayName: null,
      triggeredByEmail: null,
    });
    expect(dto).toEqual(
      expect.objectContaining({
        importJobId: null,
        triggeredBy: null,
        finishedAt: null,
        matchedCount: null,
      }),
    );
  });
});
