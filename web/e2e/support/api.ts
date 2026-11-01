import type { APIResponse, BrowserContext } from '@playwright/test';

import { API_PATH, BASE_URL, PASSWORD, newEmail } from './env';

/**
 * The API, called through the web dev server's proxy with the browser context's own cookie jar
 * (`context.request`): signing in here signs the browser in too. Used to arrange data a test is not
 * about; the flows themselves go through the UI. Unsafe methods echo the `msaas_xsrf` cookie in
 * `X-XSRF-TOKEN`, like Angular.
 */
export class Api {
  constructor(private readonly context: BrowserContext) {}

  private async xsrf(): Promise<string> {
    let cookie = (await this.context.cookies(BASE_URL)).find((c) => c.name === 'msaas_xsrf');
    if (!cookie) {
      await this.context.request.get(`${API_PATH}/auth/csrf`);
      cookie = (await this.context.cookies(BASE_URL)).find((c) => c.name === 'msaas_xsrf');
    }
    if (!cookie) {
      throw new Error('The API did not set the XSRF cookie.');
    }
    return cookie.value;
  }

  private async ok<T>(response: APIResponse, what: string): Promise<T> {
    if (!response.ok()) {
      throw new Error(`${what} failed: HTTP ${response.status()} ${await response.text()}`);
    }
    return (response.status() === 204 ? undefined : await response.json()) as T;
  }

  async get<T>(path: string): Promise<T> {
    return this.ok<T>(await this.context.request.get(`${API_PATH}${path}`), `GET ${path}`);
  }

  async post<T>(path: string, data: object = {}): Promise<T> {
    // A 429 (rate limit / "imports are busy") is waited out, so parallel workers do not flake.
    for (let attempt = 1; ; attempt += 1) {
      const response = await this.context.request.post(`${API_PATH}${path}`, {
        data,
        headers: { 'X-XSRF-TOKEN': await this.xsrf() },
      });
      if (response.status() !== 429 || attempt === 5) {
        return this.ok<T>(response, `POST ${path}`);
      }
      await sleep(Number(response.headers()['retry-after'] ?? '3') * 1000);
    }
  }

  /** Registers a fresh `e2e-…` owner (the browser context is then signed in as them). */
  async register(label: string, workspaceName = 'E2E workspace'): Promise<Registered> {
    const email = newEmail(label);
    const me = await this.post<MeResponse>('/auth/register', {
      email,
      password: PASSWORD,
      displayName: `E2E ${label}`,
      workspaceName,
    });
    return { email, userId: me.user.id, workspaceId: me.workspaces[0]!.id };
  }

  async login(email: string): Promise<void> {
    await this.post('/auth/login', { email, password: PASSWORD });
  }

  async createAccount(workspaceId: string, displayName: string): Promise<string> {
    return (await this.post<{ id: string }>(`/workspaces/${workspaceId}/accounts`, { displayName }))
      .id;
  }

  /** Uploads a file and returns the previewed import (429s are waited out). */
  async upload(
    accountId: string,
    file: { name: string; buffer: Buffer; mimeType: string },
    dataAsOf?: string,
  ): Promise<ImportDetail> {
    for (let attempt = 1; ; attempt += 1) {
      const response = await this.context.request.post(
        `${API_PATH}/accounts/${accountId}/imports`,
        {
          multipart: { file, ...(dataAsOf ? { dataAsOf } : {}) },
          headers: { 'X-XSRF-TOKEN': await this.xsrf() },
        },
      );
      if (response.status() !== 429 || attempt === 5) {
        return this.ok<ImportDetail>(response, `upload ${file.name}`);
      }
      await sleep(Number(response.headers()['retry-after'] ?? '3') * 1000);
    }
  }

  /** Upload + confirm (skipping error rows). */
  async importFile(
    accountId: string,
    file: { name: string; buffer: Buffer; mimeType: string },
    dataAsOf?: string,
  ): Promise<ImportDetail> {
    const job = await this.upload(accountId, file, dataAsOf);
    const done = await this.post<ImportDetail>(`/imports/${job.id}/confirm`, {
      skipErrorRows: true,
    });
    if (done.status !== 'completed') {
      throw new Error(`import ${file.name} ended ${done.status}`);
    }
    return done;
  }

  async productId(accountId: string, sku: string): Promise<string> {
    const page = await this.get<{ items: { id: string; sku: string }[] }>(
      `/accounts/${accountId}/products?q=${encodeURIComponent(sku)}&status=all`,
    );
    const product = page.items.find((p) => p.sku === sku);
    if (!product) throw new Error(`no product ${sku}`);
    return product.id;
  }

  async orderId(accountId: string, subOrderNo: string): Promise<string> {
    const page = await this.get<{ items: { id: string; subOrderNo: string }[] }>(
      `/accounts/${accountId}/orders?q=${encodeURIComponent(subOrderNo)}`,
    );
    const order = page.items.find((o) => o.subOrderNo === subOrderNo);
    if (!order) throw new Error(`no order ${subOrderNo}`);
    return order.id;
  }

  async addCost(productId: string, effectiveFrom: string, unitCost: string): Promise<void> {
    await this.post(`/products/${productId}/cost-history`, { effectiveFrom, unitCost });
  }

  async addAccountExpense(
    accountId: string,
    expense: { expenseDate: string; category: string; amount: string; description?: string },
  ): Promise<void> {
    await this.post(`/accounts/${accountId}/expenses`, expense);
  }

  async addWorkspaceExpense(
    workspaceId: string,
    expense: { expenseDate: string; category: string; amount: string; description?: string },
  ): Promise<void> {
    await this.post(`/workspaces/${workspaceId}/expenses`, expense);
  }
}

export interface Registered {
  email: string;
  userId: string;
  workspaceId: string;
}

interface MeResponse {
  user: { id: string };
  workspaces: { id: string; name: string; role: string }[];
}

export interface ImportDetail {
  id: string;
  status: string;
  totalRows: number | null;
  validRows: number | null;
  errorRows: number | null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** File payloads for {@link Api.upload}. */
export const CSV_MIME = 'text/csv';
export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export { PASSWORD };
