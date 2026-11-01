import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { expect, test, type Page } from '@playwright/test';

import { ARTIFACTS_DIR, SCREENSHOTS_DIR } from './support/env';
import { knownIssueForKey } from './support/known-issues';
import {
  DIALOGS,
  PAGES,
  type PagesSeed,
  anyDialog,
  openPage,
  pageDef,
  seedForPages,
} from './support/pages';
import { horizontalOverflow, overflowCulprits, waitForSettled } from './support/ui';

/**
 * Every page (and the key dialogs) at 360, 768 and 1280 px:
 * - `screenshots: …` always saves full-page screenshots to SCREENSHOTS_DIR/<page>-<width>.png (and the
 *   overflow measurements to ARTIFACTS_DIR/layout/<page>.json), even while a layout issue is open;
 * - `no horizontal scroll: …` asserts `documentElement.scrollWidth <= clientWidth` at each width
 *   (wide tables must scroll inside their own container) and names what sticks out.
 */
let seed: PagesSeed;
test.beforeAll(async ({ browser }) => {
  seed = await seedForPages(browser, 'layout');
});

const WIDTHS = [360, 768, 1280];
const LAYOUT_DIR = path.join(ARTIFACTS_DIR, 'layout');

/** Overflow problems at the current width ("" when none). */
async function overflowProblem(page: Page, width: number): Promise<string> {
  const o = await horizontalOverflow(page);
  return o.overflow
    ? `${width}px: scrollWidth ${o.scrollWidth} > clientWidth ${o.clientWidth}; ` +
        (await overflowCulprits(page)).join('; ')
    : '';
}

/** A dialog that does not fit the screen width. */
async function dialogProblem(page: Page, width: number): Promise<string> {
  const dialogs = anyDialog(page);
  const box = (await dialogs.count()) > 0 ? await dialogs.boundingBox() : null;
  return box && (box.x < 0 || box.x + box.width > width + 1)
    ? `dialog is ${Math.round(box.width)}px wide at x=${Math.round(box.x)} on a ${width}px screen`
    : '';
}

for (const def of PAGES) {
  test(`screenshots: ${def.key}`, async ({ page }) => {
    await page.setViewportSize({ width: WIDTHS[0]!, height: 900 });
    await openPage(page, seed, def);
    const measured: Record<string, string> = {};
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 900 });
      await waitForSettled(page);
      await page.screenshot({
        path: path.join(SCREENSHOTS_DIR, `${def.key}-${width}.png`),
        fullPage: true,
      });
      measured[width] = (await overflowProblem(page, width)) || 'ok';
    }
    mkdirSync(LAYOUT_DIR, { recursive: true });
    writeFileSync(path.join(LAYOUT_DIR, `${def.key}.json`), JSON.stringify(measured, null, 2));
  });

  test(`no horizontal scroll: ${def.key}`, async ({ page }) => {
    knownIssueForKey(`layout:${def.key}`);
    await page.setViewportSize({ width: WIDTHS[0]!, height: 900 });
    await openPage(page, seed, def);
    const problems: string[] = [];
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 900 });
      await waitForSettled(page);
      const problem = await overflowProblem(page, width);
      if (problem) problems.push(problem);
    }
    expect(problems, problems.join('\n')).toEqual([]);
  });
}

for (const dialog of DIALOGS) {
  const width = dialog.onlyWidth ?? 360;

  test(`screenshots: ${dialog.key}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 740 });
    await openPage(page, seed, pageDef(dialog.page));
    await dialog.open(page);
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, `${dialog.key}-${width}.png`) });
    const problems = [await overflowProblem(page, width), await dialogProblem(page, width)];
    mkdirSync(LAYOUT_DIR, { recursive: true });
    writeFileSync(
      path.join(LAYOUT_DIR, `${dialog.key}.json`),
      JSON.stringify({ [width]: problems.filter(Boolean).join('; ') || 'ok' }, null, 2),
    );
  });

  test(`no horizontal scroll: ${dialog.key}`, async ({ page }) => {
    knownIssueForKey(`layout:${dialog.key}`);
    await page.setViewportSize({ width, height: 740 });
    await openPage(page, seed, pageDef(dialog.page));
    await dialog.open(page);
    // The dialog fits the screen and the page behind it does not scroll sideways.
    const problems = [await overflowProblem(page, width), await dialogProblem(page, width)].filter(
      Boolean,
    );
    expect(problems, problems.join('\n')).toEqual([]);
  });
}
