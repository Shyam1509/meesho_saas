import { ComponentFixture, TestBed } from '@angular/core/testing';

import { accountDashboard, textOf, trendBucket } from '../../../../testing/test-data';
import { TrendBucket } from '../../../core/dashboard/dashboard.models';
import { TrendChart, axisTicks, bucketEnd, bucketLabel, isPartialBucket } from './trend-chart';

describe('TrendChart', () => {
  let fixture: ComponentFixture<TrendChart>;

  const host = () => fixture.nativeElement as HTMLElement;
  const svg = () => host().querySelector('[data-testid="trend-svg"]') as SVGSVGElement;
  const segments = () => Array.from(host().querySelectorAll('[data-testid="trend-segment"]'));
  const points = () => Array.from(host().querySelectorAll('[data-testid="trend-point"]'));
  const bucket = (start: string) => host().querySelector(`g[data-bucket="${start}"]`) as SVGGElement;
  const tableButton = () =>
    Array.from(host().querySelectorAll('button')).find((b) =>
      textOf(b).endsWith('data table'),
    ) as HTMLButtonElement;
  const radio = (id: string) => host().querySelector(`#trend-metric-${id}`) as HTMLInputElement;

  async function render(buckets: TrendBucket[] = accountDashboard().trend): Promise<void> {
    fixture = TestBed.createComponent(TrendChart);
    fixture.componentRef.setInput('buckets', buckets);
    fixture.componentRef.setInput('granularity', 'day');
    fixture.componentRef.setInput('from', '2026-10-01');
    fixture.componentRef.setInput('to', '2026-10-04');
    await fixture.whenStable();
  }

  async function pick(metric: string): Promise<void> {
    radio(metric).click();
    await fixture.whenStable();
  }

  it('draws the settlement amount as an accessible SVG: a bucket without rows is a gap, a true zero is a point on 0', async () => {
    await render();
    // 1 Oct 400.00 · 2 Oct no rows · 3 Oct 780.40 · 4 Oct 0.00
    expect(svg().getAttribute('role')).toBe('img');
    expect(svg().getAttribute('data-metric')).toBe('settlementAmount');
    expect(textOf(svg().querySelector('title'))).toBe('Settlement amount (as reported)');
    expect(textOf(svg().querySelector('desc'))).toContain(
      '1 day without data is shown as a gap, not as zero.',
    );

    // Three points: none for 2 Oct.
    expect(points()).toHaveLength(3);
    expect(bucket('2026-10-02').getAttribute('data-missing')).toBe('true');
    expect(bucket('2026-10-02').querySelector('circle')).toBeNull();
    expect(textOf(bucket('2026-10-02').querySelector('title'))).toBe('2 Oct: no data');
    expect(textOf(bucket('2026-10-01').querySelector('title'))).toBe('1 Oct: ₹400.00');

    // The line breaks at 2 Oct: 1 Oct stands alone (a point), 3–4 Oct are one segment.
    expect(segments()).toHaveLength(1);
    expect(segments()[0].getAttribute('d')?.match(/[ML]/g)).toEqual(['M', 'L']);

    // 4 Oct (₹0.00) is drawn on the zero line, not left out.
    const zeroLine = svg().querySelector('line[data-tick="0"]') as SVGLineElement;
    const zeroPoint = bucket('2026-10-04').querySelector('circle') as SVGCircleElement;
    expect(zeroPoint).not.toBeNull();
    expect(Number(zeroPoint.getAttribute('cy'))).toBeCloseTo(Number(zeroLine.getAttribute('y1')), 1);
    expect(textOf(bucket('2026-10-04').querySelector('title'))).toBe('4 Oct: ₹0.00');
  });

  it('switches metric: expenses with only one bucket of rows has no line, orders (counts) never have gaps', async () => {
    await render();

    await pick('expenses');
    expect(svg().getAttribute('data-metric')).toBe('expenses');
    expect(points()).toHaveLength(1);
    expect(segments()).toHaveLength(0);
    expect(textOf(host().querySelector('[data-testid="trend-caption"]'))).toContain(
      '3 days without data are shown as a gap, not as zero.',
    );

    await pick('orders');
    expect(points()).toHaveLength(4);
    expect(segments()).toHaveLength(1);
    expect(host().querySelector('g[data-missing="true"]')).toBeNull();
    expect(textOf(bucket('2026-10-02').querySelector('title'))).toBe('2 Oct: 0');
  });

  it('the data table toggle is a keyboard-reachable button and lists every bucket, "—" for no rows and ₹0.00 for zero', async () => {
    await render();
    const button = tableButton();
    expect(button.tagName).toBe('BUTTON');
    expect(button.getAttribute('aria-controls')).toBe('trend-table');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(host().querySelector('[data-testid="trend-table"]')).toBeNull();

    button.click();
    await fixture.whenStable();
    expect(tableButton().getAttribute('aria-expanded')).toBe('true');
    expect(textOf(tableButton())).toBe('Hide data table');
    const rows = Array.from(host().querySelectorAll('[data-testid="trend-table"] tbody tr'));
    expect(rows.map((r) => r.getAttribute('data-bucket'))).toEqual([
      '2026-10-01',
      '2026-10-02',
      '2026-10-03',
      '2026-10-04',
    ]);
    const cells = (row: Element) => Array.from(row.querySelectorAll('th, td')).map(textOf);
    expect(cells(rows[1])).toEqual([
      '2 Oct',
      '0',
      '— no data',
      '— no data',
      '— no data',
      '— no data',
    ]);
    expect(cells(rows[3])).toEqual(['4 Oct', '0', '— no data', '₹0.00', '— no data', '— no data']);
    expect(cells(rows[2])).toEqual(['3 Oct', '2', '₹998.00', '₹780.40', '₹400.00', '₹250.00']);

    tableButton().click();
    await fixture.whenStable();
    expect(host().querySelector('[data-testid="trend-table"]')).toBeNull();
  });

  it('marks the first and last buckets partial when they run past the date range', async () => {
    fixture = TestBed.createComponent(TrendChart);
    // 1 Oct 2026 is a Thursday and 31 Oct a Saturday: the first and last ISO weeks are cut.
    fixture.componentRef.setInput('buckets', [
      trendBucket({ bucketStart: '2026-09-28', settlementAmount: '10.00' }),
      trendBucket({ bucketStart: '2026-10-05', settlementAmount: '20.00' }),
      trendBucket({ bucketStart: '2026-10-26', settlementAmount: '30.00' }),
    ]);
    fixture.componentRef.setInput('granularity', 'week');
    fixture.componentRef.setInput('from', '2026-10-01');
    fixture.componentRef.setInput('to', '2026-10-31');
    await fixture.whenStable();

    expect(textOf(bucket('2026-09-28').querySelector('title'))).toBe('28 Sept (partial): ₹10.00');
    expect(textOf(bucket('2026-10-05').querySelector('title'))).toBe('5 Oct: ₹20.00');
    expect(textOf(bucket('2026-10-26').querySelector('title'))).toBe('26 Oct (partial): ₹30.00');
    expect(textOf(host().querySelector('[data-testid="trend-caption"]'))).toContain(
      'A week marked partial runs past the date range: only its days inside the range count.',
    );

    tableButton().click();
    await fixture.whenStable();
    const rows = Array.from(host().querySelectorAll('[data-testid="trend-table"] tbody tr'));
    expect(rows.map((r) => r.querySelector('[data-testid="partial"]') !== null)).toEqual([
      true,
      false,
      true,
    ]);
    expect(textOf(host().querySelector('[data-testid="trend-table-note"]'))).toBe(
      'Product cost is rounded to the paisa in each period, so the periods can add up to a few paise more or less than the Product cost card.',
    );
  });

  it('works out bucket ends and partial buckets for days, weeks and months', () => {
    expect(bucketEnd('2026-10-26', 'week')).toBe('2026-11-01');
    expect(bucketEnd('2026-02-01', 'month')).toBe('2026-02-28');
    expect(bucketEnd('2026-10-05', 'day')).toBe('2026-10-05');
    expect(isPartialBucket('2026-10-01', 'month', '2026-10-15', '2026-12-31')).toBe(true);
    expect(isPartialBucket('2026-11-01', 'month', '2026-10-15', '2026-12-31')).toBe(false);
    expect(isPartialBucket('2026-12-01', 'month', '2026-10-15', '2026-12-20')).toBe(true);
    expect(isPartialBucket('2026-10-05', 'day', '2026-10-01', '2026-10-31')).toBe(false);
  });

  it('labels weeks and months, and says so when there are no buckets', async () => {
    expect(bucketLabel('2026-10-05', 'week')).toBe('5 Oct');
    expect(bucketLabel('2026-10-01', 'month')).toBe('Oct 2026');

    await render([]);
    expect(textOf(host().querySelector('[data-testid="trend-empty"]'))).toBe(
      'No trend data for this range.',
    );
    expect(svg()).toBeNull();
  });

  it('covers negative values and 0 on the axis', () => {
    const { lo, hi, ticks } = axisTicks([-120, 780.4]);
    expect(lo).toBeLessThanOrEqual(-120);
    expect(hi).toBeGreaterThanOrEqual(780.4);
    expect(ticks).toContain(0);
    expect(axisTicks([])).toEqual({ lo: 0, hi: 1, ticks: [0, 0.25, 0.5, 0.75, 1] });
  });

  it('keeps a single bucket with rows visible as a point', async () => {
    await render([trendBucket({ bucketStart: '2026-10-01', settlementAmount: '-120.00' })]);
    expect(points()).toHaveLength(1);
    expect(segments()).toHaveLength(0);
  });
});
