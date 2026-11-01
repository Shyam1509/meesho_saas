import { ValidationPipe, type Type } from '@nestjs/common';
import { VALIDATION_PIPE_OPTIONS } from '../app.setup';
import { RequestValidationException } from '../common/errors/request-validation.exception';
import { addDays, todayInIndia } from '../common/time/india-date';
import {
  CreateExpenseDto,
  descriptionProblem,
  EXPENSE_SORTS,
  ListExpensesQueryDto,
  ListWorkspaceExpensesQueryDto,
  UpdateExpenseDto,
} from './dto/expense.dto';
import {
  categoryLabel,
  categoryRequiresDescription,
  DESCRIPTION_REQUIRED_REASON,
  EXPENSE_CATEGORIES,
  EXPENSE_CATEGORY_KEYS,
} from './expense-categories';
import {
  accountExpenseScope,
  addExpenseFilters,
  CATEGORY_LABEL_ORDER_SQL,
  expenseOrderBy,
  toExpenseDto,
  workspaceExpenseScope,
} from './expense-queries';

const pipe = new ValidationPipe(VALIDATION_PIPE_OPTIONS);

async function accept<T>(
  metatype: Type<T>,
  value: object,
  type: 'query' | 'body' = 'body',
): Promise<T> {
  return (await pipe.transform(value, { type, metatype })) as T;
}

async function reject(
  metatype: Type<unknown>,
  value: object,
  type: 'query' | 'body' = 'body',
): Promise<Record<string, string[]>> {
  try {
    await pipe.transform(value, { type, metatype });
  } catch (err) {
    if (err instanceof RequestValidationException) {
      return Object.fromEntries(err.details.map((d) => [d.field, d.reasons]));
    }
    throw err;
  }
  throw new Error(`accepted ${JSON.stringify(value)}`);
}

describe('expense categories', () => {
  it('is the agreed allowlist, in order; only "other" needs a description', () => {
    expect(EXPENSE_CATEGORY_KEYS).toEqual([
      'packaging',
      'own_shipping',
      'warehousing',
      'staff',
      'rent_utilities',
      'software_tools',
      'external_marketing',
      'professional_fees',
      'bank_charges',
      'other',
    ]);
    expect(
      EXPENSE_CATEGORIES.filter((c) => c.descriptionRequired).map((c) => c.key),
    ).toEqual(['other']);
    expect(categoryRequiresDescription('other')).toBe(true);
    expect(categoryRequiresDescription('packaging')).toBe(false);
    expect(categoryRequiresDescription(undefined)).toBe(false);
    expect(categoryLabel('own_shipping')).toBe(
      'Own courier / transport (not Meesho shipping)',
    );
    expect(categoryLabel('legacy_key')).toBe('legacy_key');
  });

  it('excludes everything the settlement workbook already deducts, and product cost (no double counting)', () => {
    const keys = EXPENSE_CATEGORY_KEYS.join(' ');
    for (const word of [
      'commission',
      'tcs',
      'tds',
      'recovery',
      'penalt',
      'ads',
      'product',
      'purchase',
    ]) {
      expect({ word, found: keys.includes(word) }).toEqual({
        word,
        found: false,
      });
    }
  });
});

describe('expense list SQL', () => {
  it('ORDER BY from the allowlist with an id tie-break', () => {
    expect(EXPENSE_SORTS).toEqual([
      'expenseDate',
      '-expenseDate',
      'amount',
      '-amount',
      'category',
      '-category',
      'createdAt',
      '-createdAt',
    ]);
    expect(expenseOrderBy('-expenseDate')).toBe(
      'e.expense_date DESC, e.id DESC',
    );
    expect(expenseOrderBy('amount')).toBe('e.amount ASC, e.id ASC');
  });

  it('sort=category follows the label people see (case-insensitive), not the key', () => {
    expect(CATEGORY_LABEL_ORDER_SQL).toBe(
      "FIELD(e.category, 'professional_fees', 'bank_charges', 'external_marketing', 'other', 'own_shipping', 'warehousing', 'packaging', 'rent_utilities', 'staff', 'software_tools')",
    );
    expect(expenseOrderBy('-category')).toBe(
      `${CATEGORY_LABEL_ORDER_SQL} DESC, e.id DESC`,
    );
    // e.g. "Salaries & staff" (staff) before "Software & tools" (software_tools), the reverse of key order.
    const labels = EXPENSE_CATEGORIES.map((c) => c.label).sort((a, b) =>
      a.localeCompare(b, 'en', { sensitivity: 'base' }),
    );
    expect(labels.indexOf('Salaries & staff')).toBeLessThan(
      labels.indexOf('Software & tools'),
    );
  });

  it('scopes: one account; workspace-wide only; or the whole workspace; then date / category filters', () => {
    expect(accountExpenseScope({ id: 3, workspaceId: 2 })).toEqual({
      conditions: [
        'e.workspace_id = :workspaceId',
        'e.seller_account_id = :sellerAccountId',
      ],
      replacements: { workspaceId: 2, sellerAccountId: 3 },
    });
    expect(workspaceExpenseScope(2, 'workspace').conditions).toEqual([
      'e.workspace_id = :workspaceId',
      'e.seller_account_id IS NULL',
    ]);
    expect(workspaceExpenseScope(2, 'all').conditions).toEqual([
      'e.workspace_id = :workspaceId',
    ]);
    const filter = addExpenseFilters(workspaceExpenseScope(2, 'all'), {
      from: '2026-10-01',
      to: '2026-10-31',
      category: ['staff', 'other', 'staff'],
    });
    expect(filter.conditions.slice(1)).toEqual([
      'e.expense_date >= :from',
      'e.expense_date <= :to',
      'e.category IN (:categories)',
    ]);
    expect(filter.replacements.categories).toEqual(['staff', 'other']);
  });

  it('maps a row with its category label; amount stays the exact DECIMAL text', () => {
    expect(
      toExpenseDto({
        id: 31,
        workspaceId: 2,
        sellerAccountId: null,
        scope: 'workspace',
        expenseDate: '2026-10-05',
        category: 'packaging',
        description: null,
        amount: '1200.50',
        createdAt: new Date('2026-10-30T10:00:00.000Z'),
        updatedAt: new Date('2026-10-30T10:00:00.000Z'),
        createdById: 1,
        createdByDisplayName: 'Asha',
        createdByEmail: 'asha@example.test',
      }),
    ).toEqual({
      id: '31',
      workspaceId: '2',
      sellerAccountId: null,
      scope: 'workspace',
      expenseDate: '2026-10-05',
      category: 'packaging',
      categoryLabel: 'Packaging & labels',
      description: null,
      amount: '1200.50',
      createdBy: { id: '1', displayName: 'Asha', email: 'asha@example.test' },
      createdAt: '2026-10-30T10:00:00.000Z',
      updatedAt: '2026-10-30T10:00:00.000Z',
    });
  });
});

describe('expense DTOs (through the global ValidationPipe)', () => {
  const today = todayInIndia();

  it('create: valid rows; blank description → null; a JSON number amount → text', async () => {
    expect(
      await accept(CreateExpenseDto, {
        expenseDate: '2026-10-05',
        category: 'packaging',
        description: '   ',
        amount: 1200.5,
      }),
    ).toEqual({
      expenseDate: '2026-10-05',
      category: 'packaging',
      description: null,
      amount: '1200.5',
    });
    expect(
      (
        await accept(CreateExpenseDto, {
          expenseDate: today,
          category: 'other',
          description: ' Stall fee ',
          amount: '99.99',
        })
      ).description,
    ).toBe('Stall fee');
  });

  it('"other" needs a description: missing, null, blank or only invisible characters → 400 on description with one reason', async () => {
    for (const description of [undefined, null, '   ', '​', ' ​‍﻿­ ']) {
      expect(
        await reject(CreateExpenseDto, {
          expenseDate: '2026-10-05',
          category: 'other',
          amount: '10',
          ...(description === undefined ? {} : { description }),
        }),
      ).toEqual({ description: [DESCRIPTION_REQUIRED_REASON] });
    }
    expect(descriptionProblem('d'.repeat(256))).toBe(
      'description must be at most 255 characters',
    );
    expect(descriptionProblem('d'.repeat(255))).toBeNull();
    // Invisible characters are removed from real text too (stored as the visible text).
    expect(
      (
        await accept(CreateExpenseDto, {
          expenseDate: '2026-10-05',
          category: 'other',
          amount: '10',
          description: '​Stall​ fee ',
        })
      ).description,
    ).toBe('Stall fee');
    expect(
      (await accept(UpdateExpenseDto, { description: '​' })).description,
    ).toBeNull();
  });

  it('amount > 0 with ≤ 2 decimals and < 10000000000; date not in the future (India); category allowlisted', async () => {
    const base = { expenseDate: today, category: 'staff' };
    for (const amount of ['0', '0.00', '-5', '10.123', '10000000000', 'ten']) {
      expect({
        amount,
        fields: Object.keys(
          await reject(CreateExpenseDto, { ...base, amount }),
        ),
      }).toEqual({ amount, fields: ['amount'] });
    }
    expect(
      (await accept(CreateExpenseDto, { ...base, amount: '9999999999.99' }))
        .amount,
    ).toBe('9999999999.99');
    expect(
      await reject(CreateExpenseDto, {
        ...base,
        expenseDate: addDays(today, 1),
        amount: '1',
      }),
    ).toEqual({
      expenseDate: ['expenseDate must not be after today (India time)'],
    });
    expect(
      Object.keys(
        await reject(CreateExpenseDto, {
          expenseDate: today,
          category: 'meesho_commission',
          amount: '1',
        }),
      ),
    ).toEqual(['category']);
  });

  it('the scope and the account cannot be sent (create or update)', async () => {
    expect(
      Object.keys(
        await reject(CreateExpenseDto, {
          expenseDate: today,
          category: 'staff',
          amount: '1',
          scope: 'workspace',
          sellerAccountId: '3',
        }),
      ).sort(),
    ).toEqual(['scope', 'sellerAccountId']);
    expect(
      Object.keys(await reject(UpdateExpenseDto, { scope: 'account' })),
    ).toEqual(['scope']);
  });

  it('update: every field optional; null description allowed by the DTO (the service checks "other"); nulls elsewhere refused', async () => {
    expect(await accept(UpdateExpenseDto, {})).toEqual({});
    expect(
      await accept(UpdateExpenseDto, { description: null, amount: '1300.5' }),
    ).toEqual({ description: null, amount: '1300.5' });
    expect(
      Object.keys(
        await reject(UpdateExpenseDto, {
          expenseDate: null,
          category: null,
          amount: null,
        }),
      ).sort(),
    ).toEqual(['amount', 'category', 'expenseDate']);
    expect(
      Object.keys(
        await reject(UpdateExpenseDto, { expenseDate: addDays(today, 1) }),
      ),
    ).toEqual(['expenseDate']);
  });

  it('list queries: default sort -expenseDate; repeatable category; workspace scope workspace|all; bad values → 400', async () => {
    const dto = await accept(ListExpensesQueryDto, {}, 'query');
    expect([dto.sort, dto.page, dto.pageSize]).toEqual(['-expenseDate', 1, 25]);
    expect(
      (await accept(ListExpensesQueryDto, { category: 'staff' }, 'query'))
        .category,
    ).toEqual(['staff']);
    expect(
      (
        await accept(
          ListWorkspaceExpensesQueryDto,
          { category: ['staff', 'other'] },
          'query',
        )
      ).scope,
    ).toBe('workspace');
    expect(
      Object.keys(
        await reject(
          ListWorkspaceExpensesQueryDto,
          {
            sort: 'description',
            category: ['staff', 'ads'],
            scope: 'account',
            from: '2026-10-10',
            to: '2026-10-01',
          },
          'query',
        ),
      ).sort(),
    ).toEqual(['category', 'scope', 'sort', 'to']);
    expect(
      Object.keys(
        await reject(ListExpensesQueryDto, { scope: 'all' }, 'query'),
      ),
    ).toEqual(['scope']);
  });
});
