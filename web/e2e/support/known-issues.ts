import { test } from '@playwright/test';

/**
 * App issues found by this suite and still open (each one is written up, with the same id, in the
 * notes file `meesho_saas-M8-e2e-findings.md`). A test that fails ONLY because of one of them calls
 * {@link knownIssue}, which marks it `fixme` so the suite stays green while the issue is open.
 *
 * Once the app is fixed: delete the entry here (and the `knownIssue(...)` call). To run every fixme
 * test anyway (to see which issues are fixed), set `E2E_RUN_FIXME=1`.
 */
export const KNOWN_ISSUES: Record<string, string> = {};

/** Marks the current test fixme for an open issue (no-op when `E2E_RUN_FIXME=1`). */
export function knownIssue(id: string, condition = true): void {
  const description = KNOWN_ISSUES[id];
  if (description === undefined) {
    throw new Error(`Unknown issue id ${id}: add it to KNOWN_ISSUES first.`);
  }
  test.fixme(condition && !process.env['E2E_RUN_FIXME'], `${id}: ${description}`);
}

/**
 * Generated checks (axe scans, layout checks) that fail only because of an open issue, by test key
 * (`axe:<page>@<width>`, `axe:<dialog>@<width>`, `layout:<page>`) → issue id.
 */
export const KNOWN_BY_KEY: Record<string, string> = {};

/** {@link knownIssue} for a generated check, when its key is listed in {@link KNOWN_BY_KEY}. */
export function knownIssueForKey(key: string): void {
  const id = KNOWN_BY_KEY[key];
  if (id !== undefined) {
    knownIssue(id);
  }
}
