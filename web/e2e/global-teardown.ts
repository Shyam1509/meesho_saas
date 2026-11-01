import { deleteE2eData, tableCounts } from './support/db';

/**
 * After the run: delete every user the suite created (emails `e2e-…@example.test`), their
 * workspaces and every row in them, so the API's own `test:db` / `test:e2e` suites find meesho_test
 * as before. Prints the row counts afterwards (counts only, never connection settings).
 */
export default async function globalTeardown(): Promise<void> {
  const deleted = await deleteE2eData();
  const counts = await tableCounts();
  const line = Object.entries(counts)
    .map(([table, c]) => `${table} ${c.all} (e2e ${c.e2e})`)
    .join(', ');
  console.log(`[e2e] cleanup: deleted ${deleted} e2e user(s); meesho_test now has ${line}`);
  if (Object.values(counts).some((c) => c.e2e !== 0)) {
    throw new Error('[e2e] cleanup left e2e rows behind');
  }
}
