import { createHash } from 'node:crypto';
import {
  fingerprintFields,
  type SheetProfile,
} from '../profiles/meesho-profiles';
import type { RowValues } from './parsed-report';

/** settlement_entries.fingerprint_version written with fingerprints from this file. */
export const FINGERPRINT_VERSION = 2;

/**
 * The tuple of fingerprint v2, without the occurrence index: [sheet key, ...the values of the sheet's
 * REQUIRED fields in profile order]. For Order Payments that is [sub-order no, transaction id, payment date,
 * final settlement amount]; for the other sheets their amount and date (plus nothing else).
 * Optional columns never enter it, so adding, dropping or renaming one, or a blank versus a zero in one,
 * cannot change a fingerprint. The entry type is left out on purpose: on most sheets the sheet key already
 * fixes it, and on "Compensation and Recovery" it comes from the optional Type column (or the sign), so
 * hashing it would let a Type column added later duplicate the same row.
 */
export function fingerprintTuple(
  profile: SheetProfile,
  values: RowValues,
): (string | null)[] {
  return [
    profile.key,
    ...fingerprintFields(profile).map((field) => values[field] ?? null),
  ];
}

/** sha256 (hex) of JSON([...tuple, occurrenceIndex]). */
export function fingerprintOf(
  tuple: (string | null)[],
  occurrence: number,
): string {
  return createHash('sha256')
    .update(JSON.stringify([...tuple, occurrence]))
    .digest('hex');
}

/**
 * Assigns fingerprints in file order: the n-th row (0-based) with an identical tuple gets occurrence n.
 * Two genuinely separate rows with identical required values (e.g. a repeated transaction ID with the same
 * amount) therefore stay separate, while re-importing the same rows — or an overlapping file that contains
 * them in the same order — yields the same fingerprints again.
 */
export class FingerprintSequencer {
  private readonly seen = new Map<string, number>();

  next(tuple: (string | null)[]): string {
    const key = JSON.stringify(tuple);
    const occurrence = this.seen.get(key) ?? 0;
    this.seen.set(key, occurrence + 1);
    return fingerprintOf(tuple, occurrence);
  }
}

/** sha256 (hex) of the values with sorted keys: the row_hash of an order row. */
export function valuesHash(values: RowValues): string {
  const sorted = Object.keys(values)
    .sort()
    .map((key) => [key, values[key]]);
  return createHash('sha256').update(JSON.stringify(sorted)).digest('hex');
}
