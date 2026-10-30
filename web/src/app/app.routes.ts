import { Route, Routes } from '@angular/router';

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
  { path: '', pathMatch: 'full', redirectTo: 'overview' },
  {
    path: 'overview',
    title: 'Overview',
    loadComponent: () => import('./features/overview/overview-page').then((m) => m.OverviewPage),
  },
  placeholderRoute('orders', 'Orders', [5]),
  placeholderRoute('settlements', 'Settlements & reconciliation', [5]),
  placeholderRoute('products', 'Products & costs', [6]),
  placeholderRoute('expenses', 'Expenses', [6]),
  placeholderRoute('imports', 'Imports', [4]),
  placeholderRoute('reports', 'Reports', [7]),
  placeholderRoute('seller-accounts', 'Seller accounts', [2, 3]),
  placeholderRoute('settings', 'Workspace settings', [3]),
  { path: '**', redirectTo: 'overview' },
];
