import { expect, test } from '@playwright/test';

import { knownIssueForKey } from './support/known-issues';
import { DIALOGS, PAGES, type PagesSeed, openPage, pageDef, seedForPages } from './support/pages';
import { axeScan, blockingFindings, describeFindings } from './support/ui';

/**
 * axe (WCAG 2.0 / 2.1 / 2.2 A + AA rules) on every page and on the key dialogs open, at desktop
 * width (1280) and at 390 px, after the data has loaded. Serious and critical WCAG violations fail
 * the test; moderate / minor ones and axe best-practice rules are recorded (annotations + AXE_DIR/<scan>.json) for the findings
 * notes. Runs in the desktop project only (the mobile project runs @smoke tests); widths are set here.
 */
let seed: PagesSeed;
test.beforeAll(async ({ browser }) => {
  seed = await seedForPages(browser, 'a11y');
});

const WIDTHS = [
  { label: '1280', viewport: { width: 1280, height: 800 } },
  { label: '390', viewport: { width: 390, height: 844 } },
];

for (const { label, viewport } of WIDTHS) {
  test.describe(`axe @ ${label}px`, () => {
    test.use({ viewport });

    for (const def of PAGES) {
      test(`axe: ${def.key} @ ${label}`, async ({ page }, testInfo) => {
        knownIssueForKey(`axe:${def.key}@${label}`);
        await openPage(page, seed, def);
        const findings = await axeScan(page, `${def.key}@${label}`, testInfo);
        const blocking = blockingFindings(findings);
        expect(blocking, describeFindings(blocking)).toEqual([]);
        // One <h1>, a language, and a page-specific title.
        expect(await page.locator('h1').count()).toBe(1);
        expect(await page.locator('html').getAttribute('lang')).toBe('en');
        expect(await page.title()).toMatch(/\S · Meesho Seller SaaS$/);
      });
    }

    for (const dialog of DIALOGS) {
      if (dialog.onlyWidth !== undefined && String(dialog.onlyWidth) !== label) continue;
      test(`axe: ${dialog.key} @ ${label}`, async ({ page }, testInfo) => {
        knownIssueForKey(`axe:${dialog.key}@${label}`);
        await openPage(page, seed, pageDef(dialog.page));
        await dialog.open(page);
        const findings = await axeScan(page, `${dialog.key}@${label}`, testInfo);
        const blocking = blockingFindings(findings);
        expect(blocking, describeFindings(blocking)).toEqual([]);
      });
    }
  });
}
