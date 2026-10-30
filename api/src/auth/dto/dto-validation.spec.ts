import { ValidationPipe, type Type } from '@nestjs/common';
import { VALIDATION_PIPE_OPTIONS } from '../../app.setup';
import { RequestValidationException } from '../../common/errors/request-validation.exception';
import {
  CreateSellerAccountDto,
  UpdateSellerAccountDto,
} from '../../seller-accounts/dto/seller-account.dto';
import { WorkspaceNameDto } from '../../workspaces/dto/workspace.dto';
import { LoginDto, RegisterDto } from './auth-request.dto';

/** The same pipe configuration the app uses (whitelist, forbidNonWhitelisted, transform). */
const pipe = new ValidationPipe(VALIDATION_PIPE_OPTIONS);

function validate<T>(metatype: Type<T>, body: unknown): Promise<T> {
  return pipe.transform(body, { type: 'body', metatype }) as Promise<T>;
}

async function invalidFields(
  metatype: Type<unknown>,
  body: unknown,
): Promise<string[]> {
  try {
    await validate(metatype, body);
  } catch (err) {
    if (err instanceof RequestValidationException) {
      return err.details.map((d) => d.field).sort();
    }
    throw err;
  }
  throw new Error('expected a validation error');
}

const PASSWORD = 'twelve-chars';

describe('RegisterDto', () => {
  it('trims and lower-cases the email, keeps the password untouched, trims names', async () => {
    const dto = await validate(RegisterDto, {
      email: '  Asha.Seller@Example.COM ',
      password: '  spaced password  ',
      displayName: '  Asha ',
      workspaceName: ' Shop ',
    });
    expect(dto).toEqual({
      email: 'asha.seller@example.com',
      password: '  spaced password  ',
      displayName: 'Asha',
      workspaceName: 'Shop',
    });
  });

  it('accepts a 12-character and a 128-character password', async () => {
    await expect(
      validate(RegisterDto, { email: 'a@b.test', password: PASSWORD }),
    ).resolves.toBeInstanceOf(RegisterDto);
    await expect(
      validate(RegisterDto, { email: 'a@b.test', password: 'x'.repeat(128) }),
    ).resolves.toBeInstanceOf(RegisterDto);
  });

  it.each([
    [
      '11-character password',
      { email: 'a@b.test', password: 'x'.repeat(11) },
      ['password'],
    ],
    [
      '129-character password',
      { email: 'a@b.test', password: 'x'.repeat(129) },
      ['password'],
    ],
    ['bad email', { email: 'not-an-email', password: PASSWORD }, ['email']],
    [
      'email over 254 chars',
      {
        email: `${'a'.repeat(64)}@${'b'.repeat(190)}.test`,
        password: PASSWORD,
      },
      ['email'],
    ],
    ['missing fields', {}, ['email', 'password']],
    [
      'blank displayName',
      { email: 'a@b.test', password: PASSWORD, displayName: '   ' },
      ['displayName'],
    ],
    [
      '121-char workspaceName',
      { email: 'a@b.test', password: PASSWORD, workspaceName: 'w'.repeat(121) },
      ['workspaceName'],
    ],
    [
      'unknown field',
      { email: 'a@b.test', password: PASSWORD, role: 'owner' },
      ['role'],
    ],
    [
      'numeric password',
      { email: 'a@b.test', password: 123456789012 },
      ['password'],
    ],
  ])('rejects %s', async (_label, body, fields) => {
    expect(await invalidFields(RegisterDto, body)).toEqual(fields);
  });

  it('never echoes the rejected password', async () => {
    try {
      await validate(RegisterDto, { email: 'a@b.test', password: 'short-pw' });
    } catch (err) {
      expect(
        JSON.stringify((err as RequestValidationException).details),
      ).not.toContain('short-pw');
    }
  });
});

describe('LoginDto', () => {
  it('normalises the email; any non-empty password up to 128 chars', async () => {
    await expect(
      validate(LoginDto, { email: ' A@B.Test ', password: 'x' }),
    ).resolves.toEqual({ email: 'a@b.test', password: 'x' });
  });

  it.each([
    ['empty password', { email: 'a@b.test', password: '' }, ['password']],
    [
      '129-char password',
      { email: 'a@b.test', password: 'x'.repeat(129) },
      ['password'],
    ],
    ['bad email', { email: 'nope', password: 'x' }, ['email']],
  ])('rejects %s', async (_label, body, fields) => {
    expect(await invalidFields(LoginDto, body)).toEqual(fields);
  });
});

describe('emails are printable ASCII only (login and register)', () => {
  // Each would compare equal to asha@example.com under users.email's utf8mb4_0900_as_ci collation.
  it.each([
    ['soft hyphen U+00AD', 'a­sha@example.com'],
    ['zero-width joiner U+200D', 'as‍ha@example.com'],
    ['zero-width space U+200B', 'asha​@example.com'],
    ['fullwidth letters', 'ａsha@example.com'],
    ['fullwidth capitals (lower-cased stays fullwidth)', 'ＡSHA@example.com'],
    ['accented letter', 'josé@example.com'],
    ['inner space', 'as ha@example.com'],
    ['tab', 'as\tha@example.com'],
  ])('rejects %s with a 400 on email', async (_label, email) => {
    expect(await invalidFields(LoginDto, { email, password: 'x' })).toEqual([
      'email',
    ]);
    expect(
      await invalidFields(RegisterDto, { email, password: PASSWORD }),
    ).toEqual(['email']);
  });

  it('still accepts plain ASCII addresses with plus, dots and hyphens', async () => {
    await expect(
      validate(LoginDto, {
        email: 'A.Sha+shop-1@Example.co.in',
        password: 'x',
      }),
    ).resolves.toEqual({ email: 'a.sha+shop-1@example.co.in', password: 'x' });
  });
});

describe('WorkspaceNameDto', () => {
  it('trims the name', async () => {
    await expect(
      validate(WorkspaceNameDto, { name: '  Main ' }),
    ).resolves.toEqual({
      name: 'Main',
    });
  });

  it.each([
    ['blank', { name: '  ' }],
    ['too long', { name: 'n'.repeat(121) }],
    ['missing', {}],
    ['not a string', { name: 5 }],
  ])('rejects a %s name', async (_label, body) => {
    expect(await invalidFields(WorkspaceNameDto, body)).toEqual(['name']);
  });
});

describe('CreateSellerAccountDto', () => {
  it('accepts a name with an optional supplier id (or null)', async () => {
    await expect(
      validate(CreateSellerAccountDto, {
        displayName: ' Shop A ',
        meeshoSupplierId: 'SUP_01-x',
      }),
    ).resolves.toEqual({ displayName: 'Shop A', meeshoSupplierId: 'SUP_01-x' });
    await expect(
      validate(CreateSellerAccountDto, {
        displayName: 'Shop A',
        meeshoSupplierId: null,
      }),
    ).resolves.toEqual({ displayName: 'Shop A', meeshoSupplierId: null });
  });

  it.each([
    ['blank name', { displayName: ' ' }, ['displayName']],
    [
      'supplier id with a space',
      { displayName: 'A', meeshoSupplierId: 'SUP 1' },
      ['meeshoSupplierId'],
    ],
    [
      'supplier id with a dot',
      { displayName: 'A', meeshoSupplierId: 'SUP.1' },
      ['meeshoSupplierId'],
    ],
    [
      'empty supplier id',
      { displayName: 'A', meeshoSupplierId: '' },
      ['meeshoSupplierId'],
    ],
    [
      '65-char supplier id',
      { displayName: 'A', meeshoSupplierId: 's'.repeat(65) },
      ['meeshoSupplierId'],
    ],
    ['status on create', { displayName: 'A', status: 'disabled' }, ['status']],
    [
      'workspaceId in body',
      { displayName: 'A', workspaceId: '2' },
      ['workspaceId'],
    ],
  ])('rejects %s', async (_label, body, fields) => {
    expect(await invalidFields(CreateSellerAccountDto, body)).toEqual(fields);
  });
});

describe('UpdateSellerAccountDto', () => {
  it('allows an empty body, a status change, or clearing the supplier id', async () => {
    await expect(validate(UpdateSellerAccountDto, {})).resolves.toEqual({});
    await expect(
      validate(UpdateSellerAccountDto, { status: 'disabled' }),
    ).resolves.toEqual({ status: 'disabled' });
    await expect(
      validate(UpdateSellerAccountDto, { meeshoSupplierId: null }),
    ).resolves.toEqual({ meeshoSupplierId: null });
  });

  it.each([
    ['null displayName', { displayName: null }, ['displayName']],
    ['null status', { status: null }, ['status']],
    ['unknown status', { status: 'deleted' }, ['status']],
    ['blank displayName', { displayName: '  ' }, ['displayName']],
  ])('rejects %s', async (_label, body, fields) => {
    expect(await invalidFields(UpdateSellerAccountDto, body)).toEqual(fields);
  });
});
