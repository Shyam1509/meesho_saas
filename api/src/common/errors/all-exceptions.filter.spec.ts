import {
  ArgumentsHost,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Logger,
  NotFoundException,
  PayloadTooLargeException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import {
  IsEmail,
  IsInt,
  Min,
  ValidateNested,
  validateSync,
} from 'class-validator';
import { Type } from 'class-transformer';
import { AllExceptionsFilter, toErrorEnvelope } from './all-exceptions.filter';
import { ApiException } from './api.exception';
import { GENERIC_SERVER_ERROR_MESSAGE } from './error-codes';
import { FieldConflictException } from './field-conflict.exception';
import { validationExceptionFactory } from './request-validation.exception';

const REQUEST_ID = 'test-req-0001';

class AddressDto {
  @IsInt()
  @Min(100000)
  pincode!: number;
}

class SignupDto {
  @IsEmail()
  email!: string;

  @ValidateNested()
  @Type(() => AddressDto)
  address!: AddressDto;
}

function mockHost(requestId = REQUEST_ID, headersSent = false) {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const setHeader = jest.fn();
  const destroy = jest.fn();
  const response = { headersSent, status, setHeader, destroy };
  const request = {
    id: requestId,
    headers: {},
    method: 'GET',
    path: '/api/v1/x',
  };
  const host = {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as unknown as ArgumentsHost;
  return { host, status, json, setHeader, destroy };
}

describe('toErrorEnvelope', () => {
  it('maps HttpException 404 to NOT_FOUND', () => {
    const { status, body } = toErrorEnvelope(
      new NotFoundException('Order not found'),
      REQUEST_ID,
    );
    expect(status).toBe(404);
    expect(body).toEqual({
      error: {
        code: 'NOT_FOUND',
        message: 'Order not found',
        requestId: REQUEST_ID,
      },
    });
  });

  it.each([
    [new UnauthorizedException(), 401, 'UNAUTHORIZED'],
    [new ForbiddenException(), 403, 'FORBIDDEN'],
    [new ConflictException(), 409, 'CONFLICT'],
    [new PayloadTooLargeException(), 413, 'PAYLOAD_TOO_LARGE'],
    [
      new HttpException('slow down', HttpStatus.TOO_MANY_REQUESTS),
      429,
      'RATE_LIMITED',
    ],
    [
      new HttpException('nope', HttpStatus.METHOD_NOT_ALLOWED),
      405,
      'BAD_REQUEST',
    ],
  ])('maps %p to %i %s', (exception, expectedStatus, expectedCode) => {
    const { status, body } = toErrorEnvelope(exception, REQUEST_ID);
    expect(status).toBe(expectedStatus);
    expect(body.error.code).toBe(expectedCode);
    expect(body.error.requestId).toBe(REQUEST_ID);
  });

  it('maps a validation BadRequest to VALIDATION_ERROR with field details', () => {
    const dto = plainToInstance(SignupDto, {
      email: 'not-an-email',
      address: { pincode: 12 },
    });
    const exception = validationExceptionFactory(validateSync(dto));

    const { status, body } = toErrorEnvelope(exception, REQUEST_ID);

    expect(status).toBe(400);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.message).toBe('Request validation failed');
    expect(body.error.requestId).toBe(REQUEST_ID);
    expect(body.error.details).toEqual([
      { field: 'email', reasons: ['email must be an email'] },
      {
        field: 'address.pincode',
        reasons: ['pincode must not be less than 100000'],
      },
    ]);
    // Rejected values are not echoed back.
    expect(JSON.stringify(body)).not.toContain('not-an-email');
  });

  it('maps a FieldConflictException to 409 CONFLICT with field details', () => {
    const { status, body } = toErrorEnvelope(
      new FieldConflictException('Already in use', [
        { field: 'displayName', reasons: ['already used'] },
      ]),
      REQUEST_ID,
    );

    expect(status).toBe(409);
    expect(body).toEqual({
      error: {
        code: 'CONFLICT',
        message: 'Already in use',
        requestId: REQUEST_ID,
        details: [{ field: 'displayName', reasons: ['already used'] }],
      },
    });
  });

  it('a plain ConflictException carries no details', () => {
    const { body } = toErrorEnvelope(
      new ConflictException('Duplicate'),
      REQUEST_ID,
    );
    expect(body.error).not.toHaveProperty('details');
  });

  it('maps an ApiException PARSE_ERROR to 422 with its code and details', () => {
    const { status, body } = toErrorEnvelope(
      new ApiException('PARSE_ERROR', 'The file cannot be imported.', [
        { field: 'columns', reasons: ['Missing required column "Quantity"'] },
      ]),
      REQUEST_ID,
    );

    expect(status).toBe(422);
    expect(body).toEqual({
      error: {
        code: 'PARSE_ERROR',
        message: 'The file cannot be imported.',
        requestId: REQUEST_ID,
        details: [
          { field: 'columns', reasons: ['Missing required column "Quantity"'] },
        ],
      },
    });
  });

  it('an ApiException keeps its own code even when another code shares the status, and omits empty details', () => {
    const { status, body } = toErrorEnvelope(
      new ApiException('BAD_REQUEST', 'Nope'),
      REQUEST_ID,
    );
    // 400 alone would map to VALIDATION_ERROR.
    expect(status).toBe(400);
    expect(body.error.code).toBe('BAD_REQUEST');
    expect(body.error).not.toHaveProperty('details');
  });

  it('a 5xx ApiException still returns the generic INTERNAL_ERROR body without details', () => {
    const { status, body } = toErrorEnvelope(
      new ApiException('INTERNAL_ERROR', 'db pool exhausted', [
        { field: 'x', reasons: ['internal detail'] },
      ]),
      REQUEST_ID,
    );
    expect(status).toBe(500);
    expect(body).toEqual({
      error: {
        code: 'INTERNAL_ERROR',
        message: GENERIC_SERVER_ERROR_MESSAGE,
        requestId: REQUEST_ID,
      },
    });
  });

  it('a plain 422 HttpException (not an ApiException) maps to BAD_REQUEST', () => {
    const { status, body } = toErrorEnvelope(
      new HttpException('x', HttpStatus.UNPROCESSABLE_ENTITY),
      REQUEST_ID,
    );
    expect(status).toBe(422);
    expect(body.error.code).toBe('BAD_REQUEST');
  });

  it('maps an unknown Error to a generic 500 INTERNAL_ERROR without stack or message', () => {
    const error = new Error('ER_ACCESS_DENIED: secret internals at db.example');

    const { status, body } = toErrorEnvelope(error, REQUEST_ID);

    expect(status).toBe(500);
    expect(body).toEqual({
      error: {
        code: 'INTERNAL_ERROR',
        message: GENERIC_SERVER_ERROR_MESSAGE,
        requestId: REQUEST_ID,
      },
    });
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('ER_ACCESS_DENIED');
    expect(serialized).not.toContain('stack');
    expect(serialized).not.toContain('at ');
  });

  it('hides the message of 5xx HttpExceptions too', () => {
    const { status, body } = toErrorEnvelope(
      new ServiceUnavailableException('pool exhausted on 10.0.0.5'),
      REQUEST_ID,
    );
    expect(status).toBe(503);
    expect(body.error.code).toBe('INTERNAL_ERROR');
    expect(body.error.message).toBe(GENERIC_SERVER_ERROR_MESSAGE);
  });

  it('maps body-parser style client errors (expose=true)', () => {
    const parseError = Object.assign(
      new SyntaxError('Unexpected token } in JSON'),
      {
        status: 400,
        expose: true,
        type: 'entity.parse.failed',
      },
    );
    const { status, body } = toErrorEnvelope(parseError, REQUEST_ID);
    expect(status).toBe(400);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.message).toBe('Malformed request');
  });
});

describe('AllExceptionsFilter', () => {
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    errorSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
  });

  afterEach(() => errorSpy.mockRestore());

  it('writes the envelope with status and x-request-id header', () => {
    const { host, status, json, setHeader } = mockHost();

    new AllExceptionsFilter().catch(
      new NotFoundException('Cannot GET /api/v1/nope'),
      host,
    );

    expect(status).toHaveBeenCalledWith(404);
    expect(json).toHaveBeenCalledWith({
      error: {
        code: 'NOT_FOUND',
        message: 'Cannot GET /api/v1/nope',
        requestId: REQUEST_ID,
      },
    });
    expect(setHeader).toHaveBeenCalledWith('x-request-id', REQUEST_ID);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('logs 5xx errors server-side (with the error) but returns a generic body', () => {
    const { host, status, json } = mockHost();
    const boom = new Error('kaboom');

    new AllExceptionsFilter().catch(boom, host);

    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith({
      error: {
        code: 'INTERNAL_ERROR',
        message: GENERIC_SERVER_ERROR_MESSAGE,
        requestId: REQUEST_ID,
      },
    });
    expect(errorSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        err: {
          type: 'Error',
          message: 'kaboom',
          stack: expect.stringMatching(/^Error: kaboom\n/) as string,
        },
        requestId: REQUEST_ID,
      }),
      'Unhandled error',
    );
  });

  it('logs database errors without SQL, bound values or the raw message', () => {
    const { host } = mockHost();
    const dbError = Object.assign(
      new Error("Duplicate entry 'secret@example.com' for key 'email'"),
      {
        name: 'SequelizeUniqueConstraintError',
        sql: "INSERT INTO users VALUES ('secret@example.com')",
        parameters: ['secret@example.com'],
        original: { code: 'ER_DUP_ENTRY', sqlMessage: 'secret@example.com' },
      },
    );

    new AllExceptionsFilter().catch(dbError, host);

    const [logged] = errorSpy.mock.calls[0] as [{ err: unknown }];
    expect(logged.err).toEqual(
      expect.objectContaining({
        type: 'SequelizeUniqueConstraintError',
        message: 'Database error (SequelizeUniqueConstraintError)',
        code: 'ER_DUP_ENTRY',
      }),
    );
    expect(JSON.stringify(logged)).not.toContain('secret@example.com');
  });

  it('destroys the response instead of writing when headers were already sent', () => {
    const { host, status, json, setHeader, destroy } = mockHost(
      REQUEST_ID,
      true,
    );

    new AllExceptionsFilter().catch(new Error('mid-stream failure'), host);

    expect(destroy).toHaveBeenCalledTimes(1);
    expect(status).not.toHaveBeenCalled();
    expect(json).not.toHaveBeenCalled();
    expect(setHeader).not.toHaveBeenCalled();
  });
});
