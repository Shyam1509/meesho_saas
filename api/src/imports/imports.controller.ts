import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiConflictResponse,
  ApiConsumes,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiPayloadTooLargeResponse,
  ApiSecurity,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import type { Actor, AuthenticatedUser } from '../auth/auth.types';
import { AUTH_THROTTLER } from '../auth/auth-throttler';
import { CurrentActor, CurrentUser } from '../auth/current-user.decorator';
import { ErrorResponseDto } from '../common/errors/error-response.dto';
import { PaginationQueryDto } from '../common/http/pagination.dto';
import { ParseIdPipe } from '../common/http/parse-id.pipe';
import {
  ConfirmImportDto,
  ImportConfigDto,
  ImportDetailDto,
  ImportListDto,
  ImportRowListDto,
  ListImportRowsQueryDto,
  UploadImportDto,
} from './dto/import.dto';
import { ImportCommitService } from './import-commit.service';
import {
  ImportUploadInterceptor,
  UPLOAD_FILE_FIELD,
} from './import-upload.interceptor';
import { ImportsService } from './imports.service';

const ACCOUNT_ID_PARAM = {
  name: 'accountId',
  description: 'Seller account id (positive integer, as a string)',
  example: '1',
};
const IMPORT_ID_PARAM = {
  name: 'importId',
  description: 'Import id (positive integer, as a string)',
  example: '1',
};
const NOT_FOUND_DOC = {
  type: ErrorResponseDto,
  description:
    'No such account/import, or the caller is not a member of its workspace',
};
const CSRF_DOC = { type: ErrorResponseDto, description: 'CSRF check failed' };
/** Uploads per client IP per minute (ThrottlerGuard on the upload route only). */
export const IMPORT_UPLOADS_PER_MINUTE = 20;

@ApiTags('imports')
@ApiCookieAuth('session')
@ApiUnauthorizedResponse({
  type: ErrorResponseDto,
  description: 'No valid session',
})
@Controller()
export class ImportsController {
  constructor(
    private readonly imports: ImportsService,
    private readonly commit: ImportCommitService,
  ) {}

  // Declared before imports/:importId so "config" is never read as an id.
  @Get('imports/config')
  @ApiOperation({ summary: 'Upload limits for the client (signed in)' })
  @ApiOkResponse({ type: ImportConfigDto })
  config(): ImportConfigDto {
    return this.imports.getConfig();
  }

  @Post('accounts/:accountId/imports')
  // Guards run before the interceptor: throttled requests are refused before the body is read.
  @UseGuards(ThrottlerGuard)
  @Throttle({
    [AUTH_THROTTLER]: { limit: IMPORT_UPLOADS_PER_MINUTE, ttl: 60_000 },
  })
  @UseInterceptors(ImportUploadInterceptor)
  @ApiSecurity('xsrf')
  @ApiParam(ACCOUNT_ID_PARAM)
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: [UPLOAD_FILE_FIELD],
      properties: {
        [UPLOAD_FILE_FIELD]: {
          type: 'string',
          format: 'binary',
          description:
            'Orders report (.csv, UTF-8) or settlement workbook (.xlsx)',
        },
        dataAsOf: {
          type: 'string',
          format: 'date',
          description:
            'REQUIRED for orders CSV (refused for workbooks): the day the report was downloaded from Meesho, YYYY-MM-DD, taken as the end of that day in India; not after today (India time).',
        },
      },
    },
  })
  @ApiOperation({
    summary:
      'Upload a report and get its preview (members); nothing is imported until confirm',
  })
  @ApiCreatedResponse({
    type: ImportDetailDto,
    description: "Job with status 'previewed'",
  })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description:
      'No file, dataAsOf missing (orders CSV) / given (workbook) / invalid, or malformed upload',
  })
  @ApiTooManyRequestsResponse({
    type: ErrorResponseDto,
    description: `RATE_LIMITED: more than ${IMPORT_UPLOADS_PER_MINUTE} uploads per minute from this IP, or "Imports are busy, try again in a moment" (2 uploads already being parsed)`,
  })
  @ApiForbiddenResponse(CSRF_DOC)
  @ApiNotFoundResponse(NOT_FOUND_DOC)
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description:
      'The same file is already imported/importing for this account (details name the import), or the account is disabled',
  })
  @ApiPayloadTooLargeResponse({
    type: ErrorResponseDto,
    description: 'File larger than IMPORT_MAX_FILE_MB',
  })
  @ApiUnprocessableEntityResponse({
    type: ErrorResponseDto,
    description:
      'PARSE_ERROR: wrong type, not UTF-8, empty, missing/duplicate headers, no recognised sheet, too many rows, unsafe workbook. No job is created.',
  })
  upload(
    @CurrentActor() actor: Actor,
    @Param('accountId', ParseIdPipe) accountId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() body: UploadImportDto,
  ): Promise<ImportDetailDto> {
    return this.imports.upload(actor, accountId, file, body);
  }

  @Get('accounts/:accountId/imports')
  @ApiParam(ACCOUNT_ID_PARAM)
  @ApiOperation({ summary: "An account's imports, newest first (members)" })
  @ApiOkResponse({ type: ImportListDto })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description: 'Invalid id or query',
  })
  @ApiNotFoundResponse(NOT_FOUND_DOC)
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Param('accountId', ParseIdPipe) accountId: string,
    @Query() query: PaginationQueryDto,
  ): Promise<ImportListDto> {
    return this.imports.list(user.id, accountId, query);
  }

  @Get('imports/:importId')
  @ApiParam(IMPORT_ID_PARAM)
  @ApiOperation({ summary: 'One import with its preview (members)' })
  @ApiOkResponse({ type: ImportDetailDto })
  @ApiBadRequestResponse({ type: ErrorResponseDto, description: 'Invalid id' })
  @ApiNotFoundResponse(NOT_FOUND_DOC)
  get(
    @CurrentUser() user: AuthenticatedUser,
    @Param('importId', ParseIdPipe) importId: string,
  ): Promise<ImportDetailDto> {
    return this.imports.get(user.id, importId);
  }

  @Get('imports/:importId/rows')
  @ApiParam(IMPORT_ID_PARAM)
  @ApiOperation({
    summary:
      "An import's staged rows in file order, optionally by status (members)",
  })
  @ApiOkResponse({ type: ImportRowListDto })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description: 'Invalid id or query',
  })
  @ApiNotFoundResponse(NOT_FOUND_DOC)
  rows(
    @CurrentUser() user: AuthenticatedUser,
    @Param('importId', ParseIdPipe) importId: string,
    @Query() query: ListImportRowsQueryDto,
  ): Promise<ImportRowListDto> {
    return this.imports.rows(user.id, importId, query);
  }

  @Get('imports/:importId/errors')
  @ApiParam(IMPORT_ID_PARAM)
  @ApiOperation({
    summary:
      "An import's rows with errors ('error', or 'skipped' after a confirm that skipped them)",
  })
  @ApiOkResponse({ type: ImportRowListDto })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description: 'Invalid id or query',
  })
  @ApiNotFoundResponse(NOT_FOUND_DOC)
  errors(
    @CurrentUser() user: AuthenticatedUser,
    @Param('importId', ParseIdPipe) importId: string,
    @Query() query: PaginationQueryDto,
  ): Promise<ImportRowListDto> {
    return this.imports.errors(user.id, importId, query);
  }

  @Post('imports/:importId/confirm')
  @HttpCode(HttpStatus.OK)
  @ApiSecurity('xsrf')
  @ApiParam(IMPORT_ID_PARAM)
  @ApiOperation({
    summary:
      'Import the valid rows in one transaction (members). A system failure → 500 and the job is failed (retryable).',
  })
  @ApiOkResponse({
    type: ImportDetailDto,
    description: "Job with status 'completed'",
  })
  @ApiBadRequestResponse({ type: ErrorResponseDto })
  @ApiForbiddenResponse(CSRF_DOC)
  @ApiNotFoundResponse(NOT_FOUND_DOC)
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description:
      'Not previewed, rows with errors without skipErrorRows, file already imported, or account disabled',
  })
  @ApiUnprocessableEntityResponse({
    type: ErrorResponseDto,
    description: 'No valid rows',
  })
  confirm(
    @CurrentActor() actor: Actor,
    @Param('importId', ParseIdPipe) importId: string,
    @Body() body: ConfirmImportDto,
  ): Promise<ImportDetailDto> {
    return this.commit.confirm(actor, importId, body);
  }

  @Post('imports/:importId/retry')
  @HttpCode(HttpStatus.OK)
  @ApiSecurity('xsrf')
  @ApiParam(IMPORT_ID_PARAM)
  @ApiOperation({
    summary: 'Run a failed import again from its staged rows (members)',
  })
  @ApiOkResponse({ type: ImportDetailDto })
  @ApiForbiddenResponse(CSRF_DOC)
  @ApiNotFoundResponse(NOT_FOUND_DOC)
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description: 'Not failed, file already imported, or account disabled',
  })
  retry(
    @CurrentActor() actor: Actor,
    @Param('importId', ParseIdPipe) importId: string,
  ): Promise<ImportDetailDto> {
    return this.commit.retry(actor, importId);
  }

  @Post('imports/:importId/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiSecurity('xsrf')
  @ApiParam(IMPORT_ID_PARAM)
  @ApiOperation({ summary: 'Discard a previewed or failed import (members)' })
  @ApiOkResponse({
    type: ImportDetailDto,
    description: "Job with status 'cancelled'",
  })
  @ApiForbiddenResponse(CSRF_DOC)
  @ApiNotFoundResponse(NOT_FOUND_DOC)
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description: 'Not previewed or failed',
  })
  cancel(
    @CurrentActor() actor: Actor,
    @Param('importId', ParseIdPipe) importId: string,
  ): Promise<ImportDetailDto> {
    return this.imports.cancel(actor, importId);
  }
}
