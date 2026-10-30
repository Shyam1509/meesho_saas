import { ApiProperty } from '@nestjs/swagger';

export type HealthStatus = 'ok' | 'degraded';
export type DbStatus = 'up' | 'down';

// Response-shape class for Swagger: never constructed with `new`, instances are typed object literals, hence `!`.
export class HealthResponseDto {
  @ApiProperty({ enum: ['ok', 'degraded'], example: 'ok' })
  status!: HealthStatus;

  @ApiProperty({ enum: ['up', 'down'], example: 'up' })
  db!: DbStatus;

  @ApiProperty({
    example: 42,
    description: 'Whole seconds since the API process started',
  })
  uptimeSeconds!: number;

  @ApiProperty({ format: 'date-time', example: '2026-01-01T00:00:00.000Z' })
  timestamp!: string;
}
