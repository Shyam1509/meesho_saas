import type { Server } from 'node:http';
import request, { type Response } from 'supertest';
import { TEST_CLIENT_IP_HEADER } from './e2e-app';

export const SESSION_COOKIE = 'msaas_sid';
export const XSRF_COOKIE = 'msaas_xsrf';
export const API = '/api/v1';

type Method = 'get' | 'post' | 'patch' | 'put' | 'delete';

export interface RequestOptions {
  body?: object;
  /** true (default): send X-XSRF-TOKEN from the cookie jar on unsafe methods; false: omit; string: send this. */
  csrf?: boolean | string;
  headers?: Record<string, string>;
}

export interface ErrorBody {
  error: {
    code: string;
    message: string;
    requestId: string;
    details?: { field: string; reasons: string[] }[];
  };
}

/** A browser-like client: keeps a cookie jar and echoes msaas_xsrf in X-XSRF-TOKEN like Angular does. */
export class TestClient {
  readonly cookies = new Map<string, string>();

  /** `clientIp`: the address the e2e app should see this client as (default: the real 127.0.0.1). */
  constructor(
    private readonly server: Server,
    private readonly clientIp?: string,
  ) {}

  get xsrf(): string | undefined {
    return this.cookies.get(XSRF_COOKIE);
  }

  get session(): string | undefined {
    return this.cookies.get(SESSION_COOKIE);
  }

  async send(
    method: Method,
    path: string,
    options: RequestOptions = {},
  ): Promise<Response> {
    let req = request(this.server)[method](`${API}${path}`);
    const cookieHeader = [...this.cookies]
      .map(([name, value]) => `${name}=${value}`)
      .join('; ');
    if (cookieHeader) req = req.set('Cookie', cookieHeader);
    if (this.clientIp) req = req.set(TEST_CLIENT_IP_HEADER, this.clientIp);
    if (method !== 'get') {
      const csrf = options.csrf ?? true;
      const token = typeof csrf === 'string' ? csrf : csrf ? this.xsrf : null;
      if (token) req = req.set('X-XSRF-TOKEN', token);
    }
    for (const [name, value] of Object.entries(options.headers ?? {})) {
      req = req.set(name, value);
    }
    const res = options.body ? await req.send(options.body) : await req;
    this.absorb(res);
    return res;
  }

  get(path: string, options?: RequestOptions): Promise<Response> {
    return this.send('get', path, options);
  }

  post(path: string, body?: object, options?: RequestOptions) {
    return this.send('post', path, { ...options, body });
  }

  patch(path: string, body?: object, options?: RequestOptions) {
    return this.send('patch', path, { ...options, body });
  }

  delete(path: string, options?: RequestOptions) {
    return this.send('delete', path, options);
  }

  /** GET /auth/csrf so the jar holds an XSRF token. */
  async primeCsrf(): Promise<void> {
    await this.get('/auth/csrf');
  }

  async register(
    email: string,
    password: string,
    extra: Record<string, string> = {},
  ): Promise<Response> {
    if (!this.xsrf) await this.primeCsrf();
    return this.post('/auth/register', { email, password, ...extra });
  }

  async login(email: string, password: string): Promise<Response> {
    if (!this.xsrf) await this.primeCsrf();
    return this.post('/auth/login', { email, password });
  }

  /** Applies Set-Cookie headers: expired/empty cookies leave the jar, others replace their value. */
  private absorb(res: Response): void {
    for (const header of setCookies(res)) {
      const [pair, ...attributes] = header.split(';').map((p) => p.trim());
      const eq = pair.indexOf('=');
      const name = pair.slice(0, eq);
      const value = decodeURIComponent(pair.slice(eq + 1));
      const expired = attributes.some((attr) => {
        const [key, val] = attr.split('=');
        if (key.toLowerCase() === 'max-age') return Number(val) <= 0;
        if (key.toLowerCase() === 'expires') {
          return new Date(val).getTime() <= Date.now();
        }
        return false;
      });
      if (expired || value === '') this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }
}

/** All Set-Cookie header lines of a response. */
export function setCookies(res: Response): string[] {
  const header = res.headers['set-cookie'] as string | string[] | undefined;
  if (!header) return [];
  return Array.isArray(header) ? header : [header];
}

/** The Set-Cookie line for one cookie name, if the response set it. */
export function setCookieFor(res: Response, name: string): string | undefined {
  return setCookies(res).find((c) => c.startsWith(`${name}=`));
}

/** Error body without its requestId, for comparing two error responses. */
export function withoutRequestId(body: unknown): unknown {
  const error: Partial<ErrorBody['error']> = { ...(body as ErrorBody).error };
  delete error.requestId;
  return { error };
}
