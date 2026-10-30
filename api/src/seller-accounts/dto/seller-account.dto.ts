import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsIn,
  IsOptional,
  IsString,
  Length,
  Matches,
  ValidateIf,
} from 'class-validator';
import { NAME_MAX_LENGTH, trimString } from '../../common/http/transforms';
import {
  SELLER_ACCOUNT_STATUSES,
  type SellerAccountStatus,
} from '../../database/models';

export const SUPPLIER_ID_MAX_LENGTH = 64;
/** Meesho supplier ids as they appear in reports: letters, digits, '_' and '-'. */
export const SUPPLIER_ID_PATTERN = /^[A-Za-z0-9_-]+$/;
const SUPPLIER_ID_MESSAGE =
  'meeshoSupplierId may contain only letters, digits, "_" and "-"';

export class CreateSellerAccountDto {
  @ApiProperty({
    minLength: 1,
    maxLength: NAME_MAX_LENGTH,
    example: 'Asha Fashions - Main',
    description:
      'Trimmed; unique in the workspace (case- and accent-insensitive)',
  })
  @Transform(trimString)
  @IsString()
  @Length(1, NAME_MAX_LENGTH)
  displayName!: string;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    minLength: 1,
    maxLength: SUPPLIER_ID_MAX_LENGTH,
    pattern: SUPPLIER_ID_PATTERN.source,
    example: 'SUP-12345',
    description:
      'Supplier id shown in Meesho reports (an identifier, never a credential); unique in the workspace',
  })
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @Length(1, SUPPLIER_ID_MAX_LENGTH)
  @Matches(SUPPLIER_ID_PATTERN, { message: SUPPLIER_ID_MESSAGE })
  meeshoSupplierId?: string | null;
}

/** Every field optional; omitted = unchanged. `meeshoSupplierId: null` clears it. */
export class UpdateSellerAccountDto {
  @ApiPropertyOptional({ minLength: 1, maxLength: NAME_MAX_LENGTH })
  @ValidateIf((dto: UpdateSellerAccountDto) => dto.displayName !== undefined)
  @Transform(trimString)
  @IsString()
  @Length(1, NAME_MAX_LENGTH)
  displayName?: string;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    minLength: 1,
    maxLength: SUPPLIER_ID_MAX_LENGTH,
    pattern: SUPPLIER_ID_PATTERN.source,
    description: 'null removes the supplier id',
  })
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @Length(1, SUPPLIER_ID_MAX_LENGTH)
  @Matches(SUPPLIER_ID_PATTERN, { message: SUPPLIER_ID_MESSAGE })
  meeshoSupplierId?: string | null;

  @ApiPropertyOptional({ enum: SELLER_ACCOUNT_STATUSES })
  @ValidateIf((dto: UpdateSellerAccountDto) => dto.status !== undefined)
  @IsIn(SELLER_ACCOUNT_STATUSES)
  status?: SellerAccountStatus;
}

// Response-shape classes for Swagger: never constructed with `new`, instances are typed object literals, hence `!`.
export class SellerAccountDto {
  @ApiProperty({ example: '1', description: 'BIGINT id as a string' })
  id!: string;

  @ApiProperty({ example: '1' })
  workspaceId!: string;

  @ApiProperty({ example: 'Asha Fashions - Main' })
  displayName!: string;

  @ApiProperty({ type: String, nullable: true, example: 'SUP-12345' })
  meeshoSupplierId!: string | null;

  @ApiProperty({ enum: SELLER_ACCOUNT_STATUSES, example: 'active' })
  status!: SellerAccountStatus;

  @ApiProperty({ format: 'date-time', example: '2026-10-30T10:00:00.000Z' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time', example: '2026-10-30T10:00:00.000Z' })
  updatedAt!: string;
}

export class SellerAccountListDto {
  @ApiProperty({
    type: [SellerAccountDto],
    description: 'All statuses, sorted by displayName, then id',
  })
  items!: SellerAccountDto[];
}
