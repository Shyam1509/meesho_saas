/**
 * Log-safe view of a thrown value. Only type, message, stack and code survive; everything else
 * (sql, parameters, original, parent, fields, errors, value, cause, ...) is dropped because it can
 * carry SQL, bound values or customer data.
 */
export interface SanitizedError {
  type: string;
  message: string;
  stack?: string;
  code?: string | number;
}

type ErrorRecord = Record<string, unknown>;

function isRecord(value: unknown): value is ErrorRecord {
  return typeof value === 'object' && value !== null;
}

/** pino's std err serializer wraps the original error and keeps it on a `raw` getter. */
function unwrap(value: unknown): unknown {
  if (isRecord(value) && 'raw' in value && isRecord(value.raw)) {
    return value.raw;
  }
  return value;
}

function typeOf(err: ErrorRecord): string {
  if (typeof err.name === 'string' && err.name.length > 0) return err.name;
  if (typeof err.type === 'string' && err.type.length > 0) return err.type;
  const ctorName = (err.constructor as { name?: unknown } | undefined)?.name;
  return typeof ctorName === 'string' && ctorName.length > 0
    ? ctorName
    : 'Error';
}

function codeOf(value: unknown): string | number | undefined {
  return typeof value === 'string' || typeof value === 'number'
    ? value
    : undefined;
}

/** Sequelize errors (name prefix) and mysql2 driver errors (sqlMessage / errno). */
export function isDatabaseError(err: ErrorRecord, type: string): boolean {
  return type.startsWith('Sequelize') || 'sqlMessage' in err || 'errno' in err;
}

/** Stack frames ("    at ...") hold no data, but the header line repeats the message: rewrite it. */
function stackWithHeader(stack: unknown, header: string): string | undefined {
  if (typeof stack !== 'string') return undefined;
  const lines = stack.split('\n');
  const firstFrame = lines.findIndex((line) => /^\s+at\s/.test(line));
  const frames = firstFrame === -1 ? [] : lines.slice(firstFrame);
  return [header, ...frames].join('\n');
}

export function sanitizeError(value: unknown): SanitizedError {
  const source = unwrap(value);
  if (!isRecord(source)) {
    // A thrown primitive may itself be data; log only its kind.
    return { type: typeof source, message: 'Non-error value thrown' };
  }

  const type = typeOf(source);
  const parent = isRecord(source.original)
    ? source.original
    : isRecord(source.parent)
      ? source.parent
      : undefined;
  const code = codeOf(source.code) ?? codeOf(parent?.code);

  // DB messages can embed row values (e.g. "Duplicate entry '<value>' for key ...").
  const message = isDatabaseError(source, type)
    ? `Database error (${type})`
    : typeof source.message === 'string'
      ? source.message
      : '';

  const sanitized: SanitizedError = { type, message };
  const stack = stackWithHeader(source.stack, `${type}: ${message}`);
  if (stack !== undefined) sanitized.stack = stack;
  if (code !== undefined) sanitized.code = code;
  return sanitized;
}
