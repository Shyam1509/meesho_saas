// Shared data and helpers for specs only (excluded from the app build in tsconfig.app.json).

import { ApiFieldError } from '../app/core/api/api-error';
import { MeResponse, XSRF_COOKIE_NAME } from '../app/core/auth/auth.models';
import { SellerAccount } from '../app/core/seller-accounts/seller-account.models';

/** Owner of "Asha Textiles" (id 10) and member of "Bharat Traders" (id 20). */
export const ME_TWO_WORKSPACES: MeResponse = {
  user: { id: '1', email: 'asha@example.com', displayName: 'Asha Rao' },
  workspaces: [
    { id: '10', name: 'Asha Textiles', role: 'owner' },
    { id: '20', name: 'Bharat Traders', role: 'member' },
  ],
};

/** Owner of one workspace, no display name. */
export const ME_OWNER: MeResponse = {
  user: { id: '1', email: 'asha@example.com', displayName: null },
  workspaces: [{ id: '10', name: 'Asha Textiles', role: 'owner' }],
};

/** Member (not owner) of one workspace. */
export const ME_MEMBER: MeResponse = {
  user: { id: '2', email: 'ravi@example.com', displayName: 'Ravi Shah' },
  workspaces: [{ id: '20', name: 'Bharat Traders', role: 'member' }],
};

export function sellerAccount(overrides: Partial<SellerAccount> = {}): SellerAccount {
  return {
    id: '100',
    workspaceId: '10',
    displayName: 'Main store',
    meeshoSupplierId: 'SUP_001',
    status: 'active',
    createdAt: '2026-10-30T08:00:00.000Z',
    updatedAt: '2026-10-30T08:00:00.000Z',
    ...overrides,
  };
}

/** The API's error envelope. */
export function errorBody(code: string, message: string, details?: ApiFieldError[]) {
  return { error: { code, message, requestId: 'req-1', ...(details ? { details } : {}) } };
}

export function setXsrfCookie(value = 'xsrf-test-token'): void {
  document.cookie = `${XSRF_COOKIE_NAME}=${value}; path=/`;
}

export function clearXsrfCookie(): void {
  document.cookie = `${XSRF_COOKIE_NAME}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
}

/** Text content with whitespace collapsed. */
export function textOf(el: Element | null | undefined): string {
  return (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

/** Sets an input's value the way typing does (fires `input`). */
export function typeInto(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event('input'));
  input.dispatchEvent(new Event('blur'));
}
