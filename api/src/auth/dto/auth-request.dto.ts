import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import {
  NAME_MAX_LENGTH,
  normalizeEmail,
  trimString,
} from '../../common/http/transforms';

export const EMAIL_MAX_LENGTH = 254;
/**
 * Emails must be printable ASCII without spaces (U+0021-U+007E) after trim + lower-case. users.email is
 * compared with utf8mb4_0900_as_ci, which ignores invisible characters (soft hyphen, ZWJ) and character
 * width (fullwidth letters): a lookalike would match an existing row while the failed-login limiter saw a
 * new key. Internationalised addresses are therefore not accepted (a deliberate limitation).
 */
export const ASCII_EMAIL_PATTERN = /^[\x21-\x7E]+$/;
const ASCII_EMAIL_MESSAGE =
  'email must contain only printable ASCII characters without spaces';
/** NIST 800-63B: length only, no composition rules; the cap stops huge-input hashing DoS. */
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

export class RegisterDto {
  @ApiProperty({
    example: 'seller@example.com',
    maxLength: EMAIL_MAX_LENGTH,
    pattern: ASCII_EMAIL_PATTERN.source,
    description:
      'Trimmed and lower-cased before it is stored; printable ASCII only',
  })
  @Transform(normalizeEmail)
  @IsEmail()
  @Matches(ASCII_EMAIL_PATTERN, { message: ASCII_EMAIL_MESSAGE })
  @MaxLength(EMAIL_MAX_LENGTH)
  email!: string;

  @ApiProperty({
    minLength: PASSWORD_MIN_LENGTH,
    maxLength: PASSWORD_MAX_LENGTH,
    format: 'password',
    description: 'Any characters; not trimmed',
  })
  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH)
  @MaxLength(PASSWORD_MAX_LENGTH)
  password!: string;

  @ApiPropertyOptional({ minLength: 1, maxLength: NAME_MAX_LENGTH })
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @Length(1, NAME_MAX_LENGTH)
  displayName?: string;

  @ApiPropertyOptional({
    minLength: 1,
    maxLength: NAME_MAX_LENGTH,
    description:
      'Name of the workspace created for the new user (default "My workspace")',
  })
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @Length(1, NAME_MAX_LENGTH)
  workspaceName?: string;
}

export class LoginDto {
  @ApiProperty({
    example: 'seller@example.com',
    maxLength: EMAIL_MAX_LENGTH,
    pattern: ASCII_EMAIL_PATTERN.source,
    description: 'Trimmed and lower-cased; printable ASCII only',
  })
  @Transform(normalizeEmail)
  @IsEmail()
  @Matches(ASCII_EMAIL_PATTERN, { message: ASCII_EMAIL_MESSAGE })
  @MaxLength(EMAIL_MAX_LENGTH)
  email!: string;

  @ApiProperty({ maxLength: PASSWORD_MAX_LENGTH, format: 'password' })
  @IsString()
  @MinLength(1)
  @MaxLength(PASSWORD_MAX_LENGTH)
  password!: string;
}
