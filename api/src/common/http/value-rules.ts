import type { TransformFnParams } from 'class-transformer';
import {
  buildMessage,
  ValidateBy,
  type ValidationOptions,
} from 'class-validator';
import { addDays, todayInIndia } from '../time/india-date';

/**
 * Exact decimal input (money, unit costs). Values are kept as decimal STRINGS end to end: never parsed into
 * a JS float. The rules of one kind of value (how many decimals, how large, whether zero is allowed) live in
 * a DecimalRule so DTO validation and the canonical form written to MySQL agree.
 */
export interface DecimalRule {
  /** Most digits after the point (the column's scale). */
  scale: number;
  /** Most digits before the point (precision - scale): the value is < 10^integerDigits. */
  integerDigits: number;
  /** true: 0 is allowed (unit cost); false: the value must be > 0 (expense amount). */
  allowZero: boolean;
  /** Human description of the bounds, used in error messages. */
  boundsText: string;
}

/** product_cost_history.unit_cost DECIMAL(12,4): 0 ≤ x < 100 000 000, at most 4 decimals. */
export const UNIT_COST_RULE: DecimalRule = {
  scale: 4,
  integerDigits: 8,
  allowZero: true,
  boundsText: 'at least 0 and below 100000000',
};

/** expenses.amount DECIMAL(12,2): 0 < x < 10 000 000 000, at most 2 decimals. */
export const EXPENSE_AMOUNT_RULE: DecimalRule = {
  scale: 2,
  integerDigits: 10,
  allowZero: false,
  boundsText: 'greater than 0 and below 10000000000',
};

/** Plain decimal text: no sign, no exponent, no grouping, no leading zeros ("0.5" yes, "00.5" / ".5" / "5." no). */
const DECIMAL_TEXT = /^(0|[1-9]\d*)(\.(\d+))?$/;

/**
 * @Transform for a decimal body field: a string is trimmed; a finite JSON number becomes its shortest
 * decimal text (a number that JS prints with an exponent, e.g. 1e21 or 1e-7, stays text the validator
 * rejects). Anything else passes through to be rejected.
 */
export function toDecimalText({ value }: TransformFnParams): unknown {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return value;
}

/** Why `value` breaks `rule`, or null when it is valid. Never echoes the value. */
export function decimalProblem(
  value: unknown,
  rule: DecimalRule,
): string | null {
  if (typeof value !== 'string')
    return 'must be a decimal number given as a string';
  const match = DECIMAL_TEXT.exec(value);
  if (!match) {
    return 'must be a plain decimal number such as 549.50 (digits and one ".", no sign, spaces or commas)';
  }
  const [, integer, , fraction = ''] = match;
  if (fraction.length > rule.scale) {
    return `must have at most ${rule.scale} decimal places`;
  }
  if (integer.length > rule.integerDigits) {
    return `must be ${rule.boundsText}`;
  }
  if (!rule.allowZero && /^0$/.test(integer) && /^0*$/.test(fraction)) {
    return `must be ${rule.boundsText}`;
  }
  return null;
}

/**
 * A valid decimal text in the column's canonical form (exactly `scale` decimals), the way MySQL returns
 * it: '549.5' → '549.5000' (scale 4), '100' → '100.00' (scale 2). Plain string padding, no float maths.
 */
export function canonicalDecimal(value: string, rule: DecimalRule): string {
  const [integer, fraction = ''] = value.split('.');
  return `${integer}.${fraction.padEnd(rule.scale, '0')}`;
}

export function IsDecimalText(
  rule: DecimalRule,
  validationOptions?: ValidationOptions,
): PropertyDecorator {
  return ValidateBy(
    {
      name: 'isDecimalText',
      constraints: [rule],
      validator: {
        validate: (value: unknown) => decimalProblem(value, rule) === null,
        defaultMessage: buildMessage(
          (each, args) =>
            `${each}$property ${decimalProblem(args?.value, rule) ?? 'is invalid'}`,
          validationOptions,
        ),
      },
    },
    validationOptions,
  );
}

/**
 * The YYYY-MM-DD date is not after today in India plus `daysAhead` days (0 = not in the future). Passes
 * for a value that is not a string: IsCalendarDate reports those.
 */
export function IsNotAfterIndiaToday(
  daysAhead = 0,
  validationOptions?: ValidationOptions,
): PropertyDecorator {
  return ValidateBy(
    {
      name: 'isNotAfterIndiaToday',
      constraints: [daysAhead],
      validator: {
        validate: (value: unknown) =>
          typeof value !== 'string' ||
          value <= addDays(todayInIndia(), daysAhead),
        defaultMessage: buildMessage(
          (each) =>
            daysAhead === 0
              ? `${each}$property must not be after today (India time)`
              : `${each}$property must not be more than ${daysAhead} days after today (India time)`,
          validationOptions,
        ),
      },
    },
    validationOptions,
  );
}
