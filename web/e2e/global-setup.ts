import { mkdirSync } from 'node:fs';

import { deleteE2eData } from './support/db';
import { ARTIFACTS_DIR, AXE_DIR, DOWNLOADS_DIR, SCREENSHOTS_DIR } from './support/env';

/**
 * Before the run: the artifact folders exist, the test database is reachable, and nothing is left
 * over from an earlier run that was interrupted (users `e2e-…@example.test` and their data).
 */
export default async function globalSetup(): Promise<void> {
  for (const dir of [ARTIFACTS_DIR, SCREENSHOTS_DIR, DOWNLOADS_DIR, AXE_DIR]) {
    mkdirSync(dir, { recursive: true });
  }
  const leftovers = await deleteE2eData();
  if (leftovers > 0) {
    console.log(
      `[e2e] removed ${leftovers} leftover e2e user(s) and their data from an earlier run`,
    );
  }
}
