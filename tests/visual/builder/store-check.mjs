import { chromium, expect } from '@playwright/test';

// Only the local, synthetic Vite fixture. Never points at production or authenticates.
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto('http://127.0.0.1:4318/store');
  await page.getByRole('button', { name: 'E-commerce template' }).click();
  await expect(page.getByLabel('Messaging channel')).toBeVisible();
  await page.screenshot({ path: 'tests/visual/builder/store-desktop.png' });
  await page.getByRole('button', { name: 'Add courier rule' }).click();
  await page.getByLabel('Rule name').fill('Domestic courier');
  await page.getByLabel('Pricing').selectOption('flat');
  await page.getByLabel('Charge in minor units', { exact: true }).fill('1500');
  await page.getByText('Test a delivery quote (no order or payment)', { exact: true }).click();
  await page.getByLabel('Test subtotal in minor units').fill('10000');
  await page.getByRole('button', { name: 'Calculate preview' }).click();
  await expect(page.getByRole('status')).toContainText('Courier charge: 1500 minor units (AED)');
  await page.getByLabel('Test destination country').fill('IN');
  await page.getByRole('button', { name: 'Calculate preview' }).click();
  await expect(page.getByRole('status')).toContainText('Delivery is not available');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByLabel('Charge in minor units', { exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'tests/visual/builder/store-mobile.png' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await page.getByLabel('Messaging channel').selectOption({ label: 'Synthetic store channel' });
  await page.getByLabel('Model ID').fill('synthetic-model');
  await page.getByRole('button', { name: 'Install draft — do not publish' }).click();
  await expect(page.getByRole('link', { name: 'Open enquiry flow' })).toBeVisible();
  await expect(page.getByText(/does not create orders/)).toBeVisible();
  process.stdout.write('Synthetic store UI: account region, quote rules, desktop/mobile, and draft receipt passed.\n');
} finally { await browser.close(); }
