import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ERROR_CODE_STATUS, type ErrorCode } from './error-codes';

// Response-shape classes for Swagger: never constructed with `new`, instances are typed object literals, hence `!`.
export class ValidationErrorDetailDto {
  @ApiProperty({
    example: 'email',
    description: 'Dot-separated path of the offending field',
  })
  field!: string;

  @ApiProperty({ type: [String], example: ['email must be an email'] })
  reasons!: string[];
}

export class ErrorBodyDto {
  @ApiProperty({ enum: Object.keys(ERROR_CODE_STATUS), example: 'NOT_FOUND' })
  code!: ErrorCode;

  @ApiProperty({ example: 'Resource not found' })
  message!: string;

  @ApiProperty({ example: '6f1c2b8e-1d2f-4a51-9a0c-3c7e4b2f9d10' })
  requestId!: string;

  @ApiPropertyOptional({ type: [ValidationErrorDetailDto] })
  details?: ValidationErrorDetailDto[];
}

/** Shape of every non-2xx response produced by AllExceptionsFilter. */
export class ErrorResponseDto {
  @ApiProperty({ type: ErrorBodyDto })
  error!: ErrorBodyDto;
}
