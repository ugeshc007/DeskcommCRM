import { chromium, expect } from '@playwright/test';

// Local component fixture only; never submits credentials or contacts Meta.
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto('http://127.0.0.1:4318/integrations');
  await page.getByRole('textbox', { name: 'Search integrations' }).fill('Facebook Messenger');
  await page.getByRole('button', { name: 'Add connection', exact: true }).click();
  await expect(page.getByLabel('Facebook Page ID')).toBeVisible();
  await expect(page.getByLabel('Page access token')).toHaveAttribute('type', 'password');
  await expect(page.getByLabel('Meta app secret')).toHaveAttribute('type', 'password');
  await page.screenshot({ path: 'tests/visual/builder/page-credentials-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByLabel('Graph API version (for example v26.0)').scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'tests/visual/builder/page-credentials-mobile.png' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await expect(page.getByRole('button', { name: 'Save securely' })).toBeVisible();
  process.stdout.write('Synthetic Page credential UI: desktop/mobile, masked fields and save control passed. No submission performed.\n');
} finally { await browser.close(); }
