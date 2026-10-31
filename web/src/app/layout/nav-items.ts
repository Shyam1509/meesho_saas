export interface NavItem {
  /** Absolute router link. */
  link: string;
  /** Visible text, also the link's accessible name. */
  label: string;
  /**
   * Other URL paths (no query) under which this item is the current page, for screens that live
   * outside `link`'s path, e.g. an order's page `/accounts/:accountId/orders/:orderId`.
   */
  alsoCurrentFor?: RegExp;
}

/** Primary navigation, in the order of the blueprint's screen list (§3). */
export const NAV_ITEMS: readonly NavItem[] = [
  { link: '/overview', label: 'Overview' },
  { link: '/orders', label: 'Orders', alsoCurrentFor: /^\/accounts\/[^/]+\/orders(\/|$)/ },
  { link: '/settlements', label: 'Settlements & reconciliation' },
  { link: '/products', label: 'Products & costs' },
  { link: '/expenses', label: 'Expenses' },
  { link: '/imports', label: 'Imports' },
  { link: '/reports', label: 'Reports' },
  { link: '/seller-accounts', label: 'Seller accounts' },
  { link: '/settings', label: 'Workspace settings' },
];
