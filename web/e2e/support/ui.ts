import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, type TestInfo } from '@playwright/test';

import { AXE_DIR, PASSWORD } from './env';

/** Opens a primary navigation item, through the "Menu" button when the navigation is collapsed. */
export async function openNav(page: Page, label: string): Promise<void> {
  const nav = page.getByRole('navigation', { name: 'Main' });
  const link = nav.getByRole('link', { name: label, exact: true });
  if (!(await link.isVisible())) {
    await page.getByRole('button', { name: /menu/i }).click();
  }
  await link.click();
}

/**
 * Waits until the page has finished loading its data: no region is `aria-busy="true"` and no
 * "Loading…" / "Searching…" status is on screen.
 */
export async function waitForSettled(page: Page): Promise<void> {
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0, { timeout: 20_000 });
  await expect(
    page.getByRole('status').filter({ hasText: /^\s*(Loading|Searching|Preparing)\b/ }),
  ).toHaveCount(0, { timeout: 20_000 });
}

/** `document.documentElement` is no wider than the viewport (no horizontal page scroll). */
export async function horizontalOverflow(
  page: Page,
): Promise<{ scrollWidth: number; clientWidth: number; innerWidth: number; overflow: boolean }> {
  return page.evaluate(() => {
    const root = document.documentElement;
    return {
      scrollWidth: root.scrollWidth,
      clientWidth: root.clientWidth,
      innerWidth: window.innerWidth,
      // clientWidth excludes a vertical scrollbar, so this also catches overflow narrower than one.
      overflow: root.scrollWidth > root.clientWidth,
    };
  });
}

/**
 * What makes the page wider than the viewport: elements reaching past the right edge that no
 * scrolling container clips, and absolutely positioned elements (e.g. `sr-only` text inside a
 * scrolling table, which escapes its container when no ancestor is positioned).
 */
export async function overflowCulprits(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    const clipsX = (el: Element | null): boolean =>
      !!el && el !== document.body && getComputedStyle(el).overflowX !== 'visible';
    const clipped = (el: Element): boolean => {
      if (getComputedStyle(el).position === 'absolute') {
        // Clipped only by a scrolling ancestor that is its containing block or contains it.
        const cb = (el as HTMLElement).offsetParent;
        for (let p: Element | null = cb; p && p !== document.body; p = p.parentElement) {
          if (clipsX(p)) return true;
        }
        return false;
      }
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        if (clipsX(p)) return true;
      }
      return false;
    };
    const describe = (el: Element): string => {
      const id = el.id ? `#${el.id}` : '';
      const cls =
        typeof el.className === 'string' && el.className
          ? `.${el.className.trim().split(/\s+/).slice(0, 4).join('.')}`
          : '';
      const text = (el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 40);
      const right = Math.round(el.getBoundingClientRect().right);
      return `${el.tagName.toLowerCase()}${id}${cls} "${text}" (right edge ${right}px)`;
    };
    const out: string[] = [];
    for (const el of document.querySelectorAll('body *')) {
      const rect = el.getBoundingClientRect();
      if (rect.right <= width + 1 || rect.width === 0) continue;
      if (clipped(el)) continue;
      const absolute = getComputedStyle(el).position === 'absolute';
      out.push(describe(el) + (absolute ? ' [absolute, escapes its scroll container]' : ''));
    }
    // Innermost first is noisy; keep the outermost few.
    return out.slice(0, 8);
  });
}

/** WCAG 2.0 / 2.1 / 2.2 level A and AA rules. */
export const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22a', 'wcag22aa'];

export interface AxeFinding {
  scan: string;
  /** A WCAG A / AA rule (false: an axe best-practice rule, informational only). */
  wcag: boolean;
  url: string;
  viewport: string;
  id: string;
  impact: string;
  help: string;
  helpUrl: string;
  nodes: { target: string; summary: string; html: string }[];
}

/**
 * Runs axe on the page, saves every violation as JSON under AXE_DIR/<scan>.json (and attaches it to
 * the test), and returns them. Callers assert on serious / critical ones.
 */
export async function axeScan(page: Page, scan: string, testInfo: TestInfo): Promise<AxeFinding[]> {
  // WCAG A / AA rules decide; best-practice rules (heading order, landmarks, …) are only recorded.
  const results = await new AxeBuilder({ page }).withTags([...AXE_TAGS, 'best-practice']).analyze();
  const size = page.viewportSize();
  const viewport = size ? `${size.width}x${size.height}` : 'unknown';
  const findings: AxeFinding[] = results.violations.map((v) => ({
    scan,
    wcag: v.tags.some((t) => AXE_TAGS.includes(t)),
    url: new URL(page.url()).pathname + new URL(page.url()).search,
    viewport,
    id: v.id,
    impact: v.impact ?? 'unknown',
    help: v.help,
    helpUrl: v.helpUrl,
    nodes: v.nodes.slice(0, 10).map((n) => ({
      target: n.target.map(String).join(' '),
      summary: (n.failureSummary ?? '').replace(/\s+/g, ' ').trim(),
      html: n.html.slice(0, 200),
    })),
  }));
  // "Needs review" results (axe could not decide, e.g. contrast over an overlay): recorded, not failed.
  const needsReview = results.incomplete.map((v) => ({
    id: v.id,
    impact: v.impact ?? 'unknown',
    nodes: v.nodes.length,
    first: v.nodes[0]?.target.map(String).join(' ') ?? '',
  }));
  mkdirSync(AXE_DIR, { recursive: true });
  const file = path.join(AXE_DIR, `${scan}.json`);
  writeFileSync(
    file,
    JSON.stringify(
      {
        scan,
        viewport,
        url: page.url(),
        rulesPassed: results.passes.length,
        findings,
        needsReview,
      },
      null,
      2,
    ),
  );
  await testInfo.attach(`axe-${scan}`, { path: file, contentType: 'application/json' });
  for (const f of findings) {
    testInfo.annotations.push({
      type: `axe-${f.wcag ? '' : 'best-practice-'}${f.impact}`,
      description: `${f.id} (${f.nodes.length} node(s)): ${f.nodes[0]?.target ?? ''}`,
    });
  }
  return findings;
}

/** WCAG violations that fail a scan: serious or critical. */
export function blockingFindings(findings: AxeFinding[]): AxeFinding[] {
  return findings.filter((f) => f.wcag && (f.impact === 'serious' || f.impact === 'critical'));
}

/** One line per finding, for assertion messages. */
export function describeFindings(findings: AxeFinding[]): string {
  return findings
    .map((f) => `${f.impact} ${f.id} — ${f.help}: ${f.nodes.map((n) => n.target).join(' | ')}`)
    .join('\n');
}

/** Signs in through the sign-in form (the `returnUrl` decides where it lands). */
export async function signInWithForm(page: Page, email: string): Promise<void> {
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

/** The value text of a dashboard KPI card (`data-testid="kpi-…"`). */
export function kpi(page: Page, testId: string) {
  return page.getByTestId(testId).getByTestId('kpi-value');
}
