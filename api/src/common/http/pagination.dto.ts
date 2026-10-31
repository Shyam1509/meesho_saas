import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;
/**
 * Upper bound for `page` on EVERY list endpoint (400 above): deep OFFSET pages make MySQL read and discard
 * every earlier row. 2000 x 100 = 200 000 rows, above the 50 000-row import cap (at the default page size of
 * 20, staged rows past 40 000 need pageSize >= 25).
 */
export const MAX_PAGE = 2000;

/**
 * `?page=&pageSize=` query of list endpoints. Unknown query parameters are rejected by the global
 * ValidationPipe (whitelist + forbidNonWhitelisted), so every list endpoint has an explicit allowlist.
 */
export class PaginationQueryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: MAX_PAGE, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE)
  page: number = 1;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: MAX_PAGE_SIZE,
    default: DEFAULT_PAGE_SIZE,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  pageSize: number = DEFAULT_PAGE_SIZE;
}

/** SQL LIMIT/OFFSET of a validated page. */
export function pageWindow(query: PaginationQueryDto): {
  limit: number;
  offset: number;
} {
  return { limit: query.pageSize, offset: (query.page - 1) * query.pageSize };
}
