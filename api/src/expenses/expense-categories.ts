/**
 * Expense categories: an app-level allowlist (expenses.category is VARCHAR(64) without a CHECK, so the list
 * can grow without a migration). It deliberately EXCLUDES everything the settlement workbook already deducts
 * (Meesho commission, Meesho shipping, Meesho Ads, TCS / TDS, recoveries / penalties) and product purchase
 * cost (entered per unit on Products): entering those here would count them twice.
 */
export interface ExpenseCategory {
  key: string;
  label: string;
  help: string;
  descriptionRequired: boolean;
}

export const EXPENSE_CATEGORIES = [
  {
    key: 'packaging',
    label: 'Packaging & labels',
    help: 'Boxes, poly bags, tape, labels and printing you buy yourself.',
    descriptionRequired: false,
  },
  {
    key: 'own_shipping',
    label: 'Own courier / transport (not Meesho shipping)',
    help: 'Transport you pay for yourself, e.g. getting stock to your premises. Meesho shipping charges are already in the settlement workbook.',
    descriptionRequired: false,
  },
  {
    key: 'warehousing',
    label: 'Own storage / warehouse',
    help: 'Rent or fees for space used to store stock.',
    descriptionRequired: false,
  },
  {
    key: 'staff',
    label: 'Salaries & staff',
    help: 'Wages and payments to people who work for the business.',
    descriptionRequired: false,
  },
  {
    key: 'rent_utilities',
    label: 'Rent & utilities',
    help: 'Office or shop rent, electricity, internet and phone.',
    descriptionRequired: false,
  },
  {
    key: 'software_tools',
    label: 'Software & tools',
    help: 'Subscriptions and tools used to run the business.',
    descriptionRequired: false,
  },
  {
    key: 'external_marketing',
    label: 'Marketing outside Meesho (not Meesho Ads)',
    help: 'Promotion you pay for outside Meesho. Meesho Ads costs are already in the settlement workbook.',
    descriptionRequired: false,
  },
  {
    key: 'professional_fees',
    label: 'Accounting & legal',
    help: 'Accountant, tax filing, legal and other professional fees.',
    descriptionRequired: false,
  },
  {
    key: 'bank_charges',
    label: 'Bank charges',
    help: 'Fees your bank charges (not Meesho deductions).',
    descriptionRequired: false,
  },
  {
    key: 'other',
    label: 'Other (description required)',
    help: 'Anything else that is not already in the settlement workbook or in product costs. Describe it.',
    descriptionRequired: true,
  },
] as const satisfies readonly ExpenseCategory[];

export type ExpenseCategoryKey = (typeof EXPENSE_CATEGORIES)[number]['key'];

export const EXPENSE_CATEGORY_KEYS: readonly ExpenseCategoryKey[] =
  EXPENSE_CATEGORIES.map((c) => c.key);

const BY_KEY: ReadonlyMap<string, ExpenseCategory> = new Map(
  EXPENSE_CATEGORIES.map((c) => [c.key, c]),
);

/** The category's label; an unknown stored key (none can be written) shows as itself. */
export function categoryLabel(key: string): string {
  return BY_KEY.get(key)?.label ?? key;
}

export function categoryRequiresDescription(key: unknown): boolean {
  return (
    typeof key === 'string' && BY_KEY.get(key)?.descriptionRequired === true
  );
}

export const DESCRIPTION_REQUIRED_REASON =
  'description is required for the category "Other"';

/** Shown wherever expenses are entered (also documented in the README). */
export const DOUBLE_COUNTING_NOTE =
  "Meesho commission, shipping, ads, TCS/TDS and recoveries come from your settlement workbook, and product purchase cost is entered per unit on Products — don't enter them here, or they are counted twice.";
