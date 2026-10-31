import { ApiProperty } from '@nestjs/swagger';

// Response-shape classes for Swagger: never constructed with `new`, instances are typed object literals.

/** The import a row came from. */
export class ImportRefDto {
  @ApiProperty({ example: '12' })
  id!: string;

  @ApiProperty({ example: 'orders-oct.csv' })
  originalFilename!: string;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}

/** A user shown next to something they did (matched an entry, triggered a run). */
export class UserRefDto {
  @ApiProperty({ example: '1' })
  id!: string;

  @ApiProperty({ type: String, nullable: true, example: 'Asha' })
  displayName!: string | null;

  @ApiProperty({ example: 'seller@example.com' })
  email!: string;
}

/** A DATETIME read back from MySQL (a Date through Sequelize; tolerate a string) as ISO-8601 UTC. */
export function isoTimestamp(value: Date | string): string {
  return value instanceof Date
    ? value.toISOString()
    : new Date(`${value.replace(' ', 'T')}Z`).toISOString();
}

export function isoTimestampOrNull(
  value: Date | string | null | undefined,
): string | null {
  return value === null || value === undefined ? null : isoTimestamp(value);
}

export function toImportRef(
  id: number | string,
  originalFilename: string,
  createdAt: Date | string,
): ImportRefDto {
  return {
    id: String(id),
    originalFilename,
    createdAt: isoTimestamp(createdAt),
  };
}

/** null when the user id is null (e.g. an automatic match, a system run). */
export function toUserRef(
  id: number | string | null | undefined,
  displayName: string | null | undefined,
  email: string | null | undefined,
): UserRefDto | null {
  if (id === null || id === undefined) return null;
  return {
    id: String(id),
    displayName: displayName ?? null,
    email: email ?? '',
  };
}
