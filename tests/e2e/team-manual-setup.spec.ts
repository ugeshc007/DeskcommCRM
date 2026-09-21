import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import pg from 'pg';

// No email gateway: a real local admin creates an invite and copies its private link.
const org = randomUUID();
const password = `${randomUUID()}Aa9!`;
const adminEmail = `manual-admin-${org}@synthetic.test`;
const staffEmail = `manual-staff-${org}@synthetic.test`;
let adminId = '';
let pool: pg.Pool;
let auth: ReturnType<typeof createClient>;

test.beforeAll(async () => {
  const api = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const db = process.env.SUPABASE_DB_URL!;
  for (const value of [api, db]) {
    if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(value).hostname)) {
      throw new Error('Manual setup UI test requires a disposable local backend');
    }
  }
  pool = new pg.Pool({ connectionString: db });
  auth = createClient(api, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const created = await auth.auth.admin.createUser({ email: adminEmail, password, email_confirm: true });
  if (created.error || !created.data.user) throw new Error('Synthetic admin creation failed');
  adminId = created.data.user.id;
  await pool.query(
    `insert into organizations(id,slug,legal_name,display_name,timezone,currency,locale,onboarded_at,onboarding_state)
     values($1,$2,'Synthetic manual setup','Synthetic manual setup','Asia/Dubai','AED','en',now(),'{}')`,
    [org, `manual-setup-${org}`],
  );
  await pool.query(
    "insert into user_organizations(user_id,organization_id,role,accepted_at) values($1,$2,'admin',now())",
    [adminId, org],
  );
  await pool.query('select fn_provision_field_sales_session_projects()');
  await pool.query(
    "insert into field_sales_employees(organization_id,user_id,display_name) values($1,$2,'Synthetic salesperson')",
    [org, adminId],
  );
});

test.afterAll(async () => {
  if (pool) {
    await pool.query('delete from field_sales_devices where organization_id=$1', [org]);
    await pool.query('delete from organizations where id=$1', [org]);
    await pool.end();
  }
  if (adminId) await auth.auth.admin.deleteUser(adminId);
});

test('admin copies a private invite and an Android key without email delivery', async ({ page, context }, testInfo) => {
  test.setTimeout(90_000);
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/login');
  await page.getByRole('textbox', { name: 'Email' }).fill(adminEmail);
  await page.getByRole('textbox', { name: 'Password' }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/\/app(?:\/|$)/);
  await page.goto('/app/team/invite');

  await expect(page.getByText(/No email gateway\?/)).toBeVisible();
  await page.getByRole('textbox', { name: 'Emails' }).fill(staffEmail);
  await page.getByRole('button', { name: 'Send invitations' }).click();
  await expect(page.getByText('Email not sent. Share this link only with the invited person.')).toBeVisible();
  await expect(page.getByText(/recipient must use the email above and set their own password/)).toBeVisible();
  const link = await page.locator('code').innerText();
  expect(link).toContain('/team/accept-invite/');
  await page.getByRole('button', { name: 'Copy setup link' }).click();
  await expect(page.getByText('Setup link copied.')).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(link);

  // Preserve a visual artifact without writing the bearer link into the screenshot.
  await page.locator('code').evaluate(element => { element.textContent = '[private link hidden]'; });
  await page.screenshot({ path: testInfo.outputPath('manual-invitation.png'), fullPage: true });

  await page.goto('/app/field-sales');
  await page.getByRole('tab', { name: 'My Android devices' }).click();
  await page.getByRole('textbox', { name: 'Phone name' }).fill('Synthetic Samsung');
  await page.getByRole('button', { name: 'Create device key' }).click();
  const deviceDialog = page.getByRole('dialog', { name: 'One-time device key' });
  await expect(deviceDialog).toBeVisible();
  const deviceKey = await deviceDialog.getByRole('textbox', { name: 'Device key' }).inputValue();
  expect(deviceKey).toMatch(/^fld_[a-f0-9]{64}$/);
  await deviceDialog.getByRole('button', { name: 'Copy device key' }).click();
  await expect(deviceDialog.getByRole('button', { name: 'Copied' })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(deviceKey);
  await deviceDialog.getByRole('textbox', { name: 'Device key' }).evaluate(element => {
    (element as HTMLInputElement).value = '[private key hidden]';
  });
  await page.screenshot({ path: testInfo.outputPath('manual-android-key.png'), fullPage: true });
});
