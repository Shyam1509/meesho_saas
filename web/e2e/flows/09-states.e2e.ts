import { expect, test } from '@playwright/test';

import { seedShop } from '../support/seed';
import { waitForSettled } from '../support/ui';

/**
 * Loading / error / no-results states (M8 hardening checklist), on the orders list:
 * - a server error (5xx) shows the message, its support reference and "Try again", which recovers;
 * - an unreachable server (status 0) says "Can't reach the server";
 * - filters that match nothing offer "Clear filters", which brings the orders back.
 * The failures are simulated in the browser (route interception); the data is real.
 */
test('orders list: server error with reference and retry, network failure, no results', async ({
  page,
  context,
}) => {
  await seedShop(context, 'flow9', { workbook: false });
  const ordersList = '**/api/v1/accounts/*/orders?*';

  await test.step('a server error shows the reference and "Try again" recovers', async () => {
    await page.route(ordersList, (route) =>
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        headers: { 'x-request-id': 'req-e2e-500' },
        body: JSON.stringify({
          error: {
            code: 'INTERNAL',
            message: 'Something broke on our side.',
            requestId: 'req-e2e-500',
          },
        }),
      }),
    );
    await page.goto('/orders');
    const alert = page.getByRole('alert').filter({ hasText: 'The orders could not be loaded.' });
    await expect(alert).toBeVisible();
    await expect(alert).toContainText('Something broke on our side.');
    await expect(alert).toContainText('Reference: req-e2e-500');
    await page.unroute(ordersList);
    await alert.getByRole('button', { name: 'Try again' }).click();
    await waitForSettled(page);
    await expect(
      page.getByRole('table', { name: 'Orders of Shop One' }).locator('tbody tr'),
    ).toHaveCount(6);
  });

  await test.step('an unreachable server is named as such', async () => {
    await page.route(ordersList, (route) => route.abort('connectionrefused'));
    await page.getByRole('button', { name: /Sub order no\./ }).click();
    const alert = page.getByRole('alert').filter({ hasText: 'The orders could not be loaded.' });
    await expect(alert).toContainText(/Can.t reach the server/);
    await page.unroute(ordersList);
    await alert.getByRole('button', { name: 'Try again' }).click();
    await waitForSettled(page);
    await expect(page.getByRole('table', { name: 'Orders of Shop One' })).toBeVisible();
  });

  await test.step('no results: "Clear filters" brings the orders back', async () => {
    await page.getByLabel('Search').fill('NO-SUCH-ORDER');
    await page.getByRole('button', { name: 'Apply filters' }).click();
    await waitForSettled(page);
    const empty = page.getByTestId('no-results');
    await expect(empty).toContainText('No orders match these filters.');
    await empty.getByRole('button', { name: 'Clear filters' }).click();
    await waitForSettled(page);
    await expect(
      page.getByRole('table', { name: 'Orders of Shop One' }).locator('tbody tr'),
    ).toHaveCount(6);
    await expect(page.getByLabel('Search')).toHaveValue('');
  });
});

/**
 * Error texts by kind: a client error (4xx) says what to do and has no support reference; a gateway
 * error without the API's error envelope (502 / 503 / 504 from a proxy: the API is not answering)
 * reads as "Can't reach the server", not as a broken response.
 */
test('orders list: a 4xx has no reference; a bare 502/503/504 says the server cannot be reached', async ({
  page,
  context,
}) => {
  await seedShop(context, 'flow9b', { workbook: false });
  const ordersList = '**/api/v1/accounts/*/orders?*';
  const alert = page.getByRole('alert').filter({ hasText: 'The orders could not be loaded.' });

  await test.step('a 4xx error: its message, no "Reference:"', async () => {
    await page.route(ordersList, (route) =>
      route.fulfill({
        status: 409,
        contentType: 'application/json',
        headers: { 'x-request-id': 'req-e2e-409' },
        body: JSON.stringify({
          error: {
            code: 'CONFLICT',
            message: 'An import is running for this account; try again shortly.',
            requestId: 'req-e2e-409',
          },
        }),
      }),
    );
    await page.goto('/orders');
    await expect(alert).toContainText('An import is running for this account');
    await expect(alert).not.toContainText('Reference:');
    await expect(alert).not.toContainText('req-e2e-409');
    await page.unroute(ordersList);
  });

  for (const status of [502, 503, 504]) {
    await test.step(`a ${status} without the API envelope`, async () => {
      await page.route(ordersList, (route) =>
        route.fulfill({
          status,
          contentType: 'text/html',
          body: `<html><body><h1>${status} Gateway error</h1></body></html>`,
        }),
      );
      await page.goto('/orders');
      await expect(alert).toContainText(/Can.t reach the server/);
      await expect(alert).not.toContainText('unexpected response');
      await page.unroute(ordersList);
    });
  }
});
