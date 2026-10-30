export interface NavItem {
  /** Absolute router link. */
  link: string;
  /** Visible text, also the link's accessible name. */
  label: string;
}

/** Primary navigation, in the order of the blueprint's screen list (§3). */
export const NAV_ITEMS: readonly NavItem[] = [
  { link: '/overview', label: 'Overview' },
  { link: '/orders', label: 'Orders' },
  { link: '/settlements', label: 'Settlements & reconciliation' },
  { link: '/products', label: 'Products & costs' },
  { link: '/expenses', label: 'Expenses' },
  { link: '/imports', label: 'Imports' },
  { link: '/reports', label: 'Reports' },
  { link: '/seller-accounts', label: 'Seller accounts' },
  { link: '/settings', label: 'Workspace settings' },
];
