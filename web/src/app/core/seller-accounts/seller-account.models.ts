export type SellerAccountStatus = 'active' | 'disabled';

/** A Meesho supplier account inside a workspace. */
export interface SellerAccount {
  id: string;
  workspaceId: string;
  displayName: string;
  /** Meesho's supplier id; `null` when not entered yet. */
  meeshoSupplierId: string | null;
  status: SellerAccountStatus;
  /** ISO-8601 UTC. */
  createdAt: string;
  /** ISO-8601 UTC. */
  updatedAt: string;
}

/** Body of `POST /workspaces/:workspaceId/accounts`. */
export interface CreateSellerAccountRequest {
  displayName: string;
  meeshoSupplierId?: string;
}

/** Body of `PATCH /accounts/:accountId`: only the fields that change. `null` clears the supplier id. */
export interface UpdateSellerAccountRequest {
  displayName?: string;
  meeshoSupplierId?: string | null;
  status?: SellerAccountStatus;
}

/** Field rules shared with the API. */
export const SELLER_ACCOUNT_NAME_MAX_LENGTH = 120;
export const MEESHO_SUPPLIER_ID_MAX_LENGTH = 64;
export const MEESHO_SUPPLIER_ID_PATTERN = /^[A-Za-z0-9_-]+$/;
