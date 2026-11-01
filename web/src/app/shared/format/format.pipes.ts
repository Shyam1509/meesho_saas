import { Pipe, PipeTransform } from '@angular/core';

import {
  formatCount,
  formatDate,
  formatDateRange,
  formatDateTime,
  formatFileSize,
  formatInr,
  formatUnitCost,
} from './format';

/** `{{ amount | inr }}` → "₹12,34,567.50"; missing → "—". */
@Pipe({ name: 'inr' })
export class InrPipe implements PipeTransform {
  transform(value: string | number | null | undefined): string {
    return formatInr(value);
  }
}

/** `{{ unitCost | unitCost }}` → "₹12.3456" (up to 4 decimals); missing → "—". */
@Pipe({ name: 'unitCost' })
export class UnitCostPipe implements PipeTransform {
  transform(value: string | null | undefined): string {
    return formatUnitCost(value);
  }
}

/** `{{ rows | count }}` → "12,34,567"; missing → "—" (0 stays "0"). */
@Pipe({ name: 'count' })
export class CountPipe implements PipeTransform {
  transform(value: number | null | undefined): string {
    return formatCount(value);
  }
}

/** `{{ iso | displayDate }}` → "5 Oct 2026"; missing → "—". */
@Pipe({ name: 'displayDate' })
export class DisplayDatePipe implements PipeTransform {
  transform(value: string | null | undefined, timeZone?: string): string {
    return formatDate(value, timeZone);
  }
}

/** `{{ iso | displayDateTime }}` → "30 Oct 2026, 2:00 pm"; missing → "—". */
@Pipe({ name: 'displayDateTime' })
export class DisplayDateTimePipe implements PipeTransform {
  transform(value: string | null | undefined, timeZone?: string): string {
    return formatDateTime(value, timeZone);
  }
}

/** `{{ start | dateRange: end }}` → "1 Oct 2026 – 31 Oct 2026"; both missing → "—". */
@Pipe({ name: 'dateRange' })
export class DateRangePipe implements PipeTransform {
  transform(start: string | null | undefined, end: string | null | undefined): string {
    return formatDateRange(start, end);
  }
}

/** `{{ bytes | fileSize }}` → "9.8 MB"; missing → "—". */
@Pipe({ name: 'fileSize' })
export class FileSizePipe implements PipeTransform {
  transform(bytes: number | null | undefined): string {
    return formatFileSize(bytes);
  }
}
