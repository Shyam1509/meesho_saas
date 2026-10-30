import {
  allowedActions,
  STALE_IMPORTING_MINUTES,
  staleImportingCutoff,
  type ActionFacts,
} from './import-actions';

const NOW = Date.UTC(2026, 9, 30, 12, 0, 0);
const minutesAgo = (m: number) => new Date(NOW - m * 60 * 1000);

const facts = (overrides: Partial<ActionFacts>): ActionFacts => ({
  status: 'previewed',
  validRows: 3,
  confirmedAt: null,
  accountActive: true,
  ...overrides,
});

describe('allowedActions', () => {
  it.each([
    [facts({}), ['confirm', 'cancel']],
    [facts({ validRows: 0 }), ['cancel']],
    [facts({ accountActive: false }), ['cancel']],
    [
      facts({ status: 'failed', confirmedAt: minutesAgo(1) }),
      ['retry', 'cancel'],
    ],
    [facts({ status: 'failed', accountActive: false }), ['cancel']],
    [facts({ status: 'importing', confirmedAt: minutesAgo(14) }), []],
    [
      facts({ status: 'importing', confirmedAt: minutesAgo(16) }),
      ['retry', 'cancel'],
    ],
    [facts({ status: 'completed', confirmedAt: minutesAgo(60) }), []],
    [facts({ status: 'cancelled' }), []],
  ] as const)('%o → %p', (input, expected) => {
    expect(allowedActions(input, NOW)).toEqual(expected);
  });

  it('stale means confirmed more than 15 minutes ago', () => {
    expect(STALE_IMPORTING_MINUTES).toBe(15);
    expect(staleImportingCutoff(NOW).toISOString()).toBe(
      '2026-10-30T11:45:00.000Z',
    );
  });
});
