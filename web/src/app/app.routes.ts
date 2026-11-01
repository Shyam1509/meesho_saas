import { Route, Routes } from '@angular/router';

import { authGuard, guestGuard, registrationEnabledGuard } from './core/auth/auth.guards';
import { Shell } from './layout/shell/shell';

/**
 * A screen that is not built yet. `heading` and `milestones` reach the shared placeholder page as
 * component inputs (`withComponentInputBinding()`). Milestone numbers follow blueprint §15.
 */
function placeholderRoute(path: string, title: string, milestones: readonly number[]): Route {
  return {
    path,
    title,
    loadComponent: () =>
      import('./shared/placeholder-page/placeholder-page').then((m) => m.PlaceholderPage),
    data: { heading: title, milestones },
  };
}

export const routes: Routes = [
  // Outside the shell, for signed-out visitors only.
  {
    path: 'login',
    title: 'Sign in',
    canActivate: [guestGuard],
    loadComponent: () => import('./features/auth/login-page/login-page').then((m) => m.LoginPage),
  },
  {
    path: 'register',
    title: 'Create an account',
    canActivate: [guestGuard, registrationEnabledGuard],
    loadComponent: () =>
      import('./features/auth/register-page/register-page').then((m) => m.RegisterPage),
  },
  // Everything else needs a session; the guard sends anyone else to /login?returnUrl=….
  {
    path: '',
    component: Shell,
    canActivate: [authGuard],
    canActivateChild: [authGuard],
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'overview' },
      {
        path: 'overview',
        title: 'Overview',
        loadComponent: () =>
          import('./features/overview/overview-page').then((m) => m.OverviewPage),
      },
      {
        path: 'orders',
        title: 'Orders',
        loadComponent: () => import('./features/orders/orders-page').then((m) => m.OrdersPage),
      },
      {
        // The account is part of the path: an order id alone does not say which account it is in.
        path: 'accounts/:accountId/orders/:orderId',
        title: 'Order details',
        loadComponent: () =>
          import('./features/orders/order-detail-page').then((m) => m.OrderDetailPage),
      },
      {
        path: 'settlements',
        title: 'Settlements & reconciliation',
        loadComponent: () =>
          import('./features/settlements/settlements-page').then((m) => m.SettlementsPage),
      },
      {
        path: 'products',
        title: 'Products & costs',
        loadComponent: () =>
          import('./features/products/products-page').then((m) => m.ProductsPage),
      },
      {
        // Under /products, so the "Products & costs" navigation item stays current.
        path: 'products/:productId',
        title: 'Product details',
        loadComponent: () =>
          import('./features/products/product-detail-page').then((m) => m.ProductDetailPage),
      },
      {
        path: 'expenses',
        title: 'Expenses',
        loadComponent: () =>
          import('./features/expenses/expenses-page').then((m) => m.ExpensesPage),
      },
      {
        path: 'imports',
        title: 'Imports',
        loadComponent: () => import('./features/imports/imports-page').then((m) => m.ImportsPage),
      },
      {
        path: 'imports/:importId',
        title: 'Import details',
        loadComponent: () =>
          import('./features/imports/import-detail-page').then((m) => m.ImportDetailPage),
      },
      placeholderRoute('reports', 'Reports', [7]),
      {
        path: 'seller-accounts',
        title: 'Seller accounts',
        loadComponent: () =>
          import('./features/seller-accounts/seller-accounts-page').then(
            (m) => m.SellerAccountsPage,
          ),
      },
      {
        path: 'settings',
        title: 'Workspace settings',
        loadComponent: () =>
          import('./features/settings/workspace-settings-page').then(
            (m) => m.WorkspaceSettingsPage,
          ),
      },
    ],
  },
  { path: '**', redirectTo: 'overview' },
];
