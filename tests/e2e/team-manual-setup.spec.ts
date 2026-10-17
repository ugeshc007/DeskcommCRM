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
  await pool.query('select fn_provision_field_sales_flexible_shifts()');
  await pool.query('select fn_provision_field_sales_pairing()');
  await pool.query(
    "insert into field_sales_employees(organization_id,user_id,display_name) values($1,$2,'Synthetic salesperson')",
    [org, adminId],
  );
});

test.afterAll(async () => {
  if (pool) {
    const staff = await pool.query('select id from auth.users where email=$1', [staffEmail]);
    await pool.query('delete from field_sales_devices where organization_id=$1', [org]);
    await pool.query('delete from organizations where id=$1', [org]);
    if (staff.rows[0]) await auth.auth.admin.deleteUser(staff.rows[0].id);
    await pool.end();
  }
  if (adminId) await auth.auth.admin.deleteUser(adminId);
});

test('admin copies a private invite, employee sets a password without email, and device key remains separate', async ({ page, context, browser, baseURL }, testInfo) => {
  test.setTimeout(120_000);
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/login');
  await page.getByRole('textbox', { name: 'Email' }).fill(adminEmail);
  await page.locator('#password').fill(password);
  await page.getByRole('button', { name: /Sign in|Entrar/i }).click();
  await page.waitForURL(/\/app(?:\/|$)/);
  await page.goto('/app/team/invite');

  await expect(page.locator('form > p')).toContainText('No email gateway?');
  await page.getByRole('combobox', { name: 'Role' }).click();
  await page.getByRole('option', { name: 'Field Officer' }).click();
  await page.getByRole('textbox', { name: 'Emails' }).fill(staffEmail);
  await page.getByRole('button', { name: 'Send invitations' }).click();
  await expect(page.getByText('Email not sent. Share this link only with the invited person.')).toBeVisible();
  await expect(page.getByText(/recipient must use the email above and set their own password/)).toBeVisible();
  const link = await page.locator('code').innerText();
  expect(link).toContain('/team/accept-invite/');
  await page.getByRole('button', { name: 'Copy setup link' }).click();
  await expect(page.getByText('Setup link copied.')).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(link);

  const staffContext = await browser.newContext();
  const staffPage = await staffContext.newPage();
  // The test server may use E2E_PORT while NEXT_PUBLIC_APP_URL still points to
  // the default port. Keep the signed path, but use this isolated test server.
  await staffPage.goto(`${baseURL}${new URL(link).pathname}`);
  await expect(staffPage.getByRole('heading', { name: 'You were invited' })).toBeVisible();
  // The existing-account detour must preserve the invitation (the reported bug).
  await staffPage.getByRole('link', { name: 'Login' }).click();
  await staffPage.getByRole('link', { name: /Create account|Criar conta/i }).click();
  await expect(staffPage.getByText(/Create your password to enter the company that invited you|Crie sua senha para entrar na empresa que te convidou/)).toBeVisible();
  await expect(staffPage.getByRole('textbox', { name: /Your name|Seu nome/ })).toBeVisible();
  await staffPage.getByRole('textbox', { name: /Your name|Seu nome/ }).fill('Synthetic Salesperson');
  await expect(staffPage.getByRole('textbox', { name: 'Email' })).toHaveValue(staffEmail);
  await staffPage.getByLabel(/^(Password|Senha)$/).fill(password);
  await staffPage.getByLabel(/Confirm password|Confirmar senha/).fill(password);
  await staffPage.getByRole('button', { name: /Create account|Criar conta/i }).click();
  await staffPage.waitForURL(/\/app(?:\/|$)/);
  const membership = await pool.query(
    "select role from user_organizations where organization_id=$1 and user_id=(select id from auth.users where email=$2)",
    [org, staffEmail],
  );
  expect(membership.rows).toEqual([{ role: 'field_officer' }]);
  const acceptedInvite = await pool.query(
    'select accepted_by, revoked_at from team_invites where organization_id=$1 and email=$2',
    [org, staffEmail],
  );
  expect(acceptedInvite.rows).toHaveLength(1);
  expect(acceptedInvite.rows[0].accepted_by).toBeTruthy();
  expect(acceptedInvite.rows[0].revoked_at).toBeNull();
  await staffContext.close();

  const revokedEmail = `revoked-${org}@synthetic.test`;
  await page.getByRole('textbox', { name: 'Emails' }).fill(revokedEmail);
  await page.getByRole('button', { name: 'Send invitations' }).click();
  const revokedResult = page.locator('li').filter({ hasText: revokedEmail });
  await expect(revokedResult).toBeVisible();
  const revokedLink = await revokedResult.locator('code').innerText();
  const revokedUpdate = await pool.query(
    'update team_invites set revoked_at=now() where organization_id=$1 and email=$2',
    [org, revokedEmail],
  );
  expect(revokedUpdate.rowCount).toBe(1);
  const revokedContext = await browser.newContext();
  const revokedPage = await revokedContext.newPage();
  await revokedPage.goto(`${baseURL}${new URL(revokedLink).pathname}`);
  await revokedPage.getByRole('link', { name: "I don't have an account yet" }).click();
  await revokedPage.getByRole('textbox', { name: /Your name|Seu nome/ }).fill('Rejected Salesperson');
  await revokedPage.getByLabel(/^(Password|Senha)$/).fill(password);
  await revokedPage.getByLabel(/Confirm password|Confirmar senha/).fill(password);
  await revokedPage.getByRole('button', { name: /Create account|Criar conta/i }).click();
  await expect(revokedPage.getByText(/Invalid or expired invitation|Convite inválido ou expirado/)).toBeVisible();
  const revokedUser = await pool.query('select id from auth.users where email=$1', [revokedEmail]);
  expect(revokedUser.rows).toHaveLength(0);
  await revokedContext.close();

  const adminMembership = await pool.query(
    'select role from user_organizations where organization_id=$1 and user_id=$2',
    [org, adminId],
  );
  expect(adminMembership.rows).toEqual([{ role: 'admin' }]);
  const managementContext = await browser.newContext();
  await managementContext.grantPermissions(['clipboard-read', 'clipboard-write']);
  const managementPage = await managementContext.newPage();
  await managementPage.goto(`${baseURL}/login`);
  await managementPage.getByRole('textbox', { name: 'Email' }).fill(adminEmail);
  await managementPage.locator('#password').fill(password);
  await managementPage.getByRole('button', { name: /Sign in|Entrar/i }).click();
  await managementPage.waitForURL(/\/app(?:\/|$)/);
  await managementPage.goto('/app/team');
  await expect(managementPage.getByRole('heading', { name: 'Team' })).toBeVisible({ timeout: 15_000 });
  const revokedInvite = managementPage.getByRole('row').filter({ hasText: revokedEmail });
  await expect(revokedInvite).toHaveCount(1, { timeout: 5_000 });
  await expect(revokedInvite.getByRole('button', { name: /ações|actions/i })).toHaveCount(1, { timeout: 5_000 });
  await revokedInvite.getByRole('button', { name: /ações|actions/i }).click();
  await managementPage.getByRole('menuitem', { name: 'Remove from list' }).click();
  await managementPage.getByRole('dialog', { name: 'Remove revoked invitation?' }).getByRole('button', { name: 'Remove' }).click();
  await expect(managementPage.getByText('Invitation removed from the list.')).toBeVisible({ timeout: 15_000 });
  await expect(revokedInvite).toHaveCount(0);
  await expect.poll(async () => (await pool.query('select revoked_at,archived_at from team_invites where organization_id=$1 and email=$2', [org, revokedEmail])).rows[0]).toMatchObject({ revoked_at: expect.any(Date), archived_at: expect.any(Date) });

  // Team page does not expose the private invitation URL or device bearer.
  await managementPage.screenshot({ path: testInfo.outputPath('manual-invitation.png'), fullPage: true });

  await managementPage.goto('/app/team');
  const staffRow = managementPage.getByRole('row').filter({ hasText: staffEmail });
  await staffRow.getByRole('button', { name: 'Android keys' }).click();
  const deviceDialog = managementPage.getByRole('dialog', { name: /Android access/ });
  await expect(deviceDialog).toBeVisible();
  await deviceDialog.getByRole('textbox', { name: 'Phone name' }).fill('Synthetic Samsung');
  await deviceDialog.getByRole('button', { name: 'Create pairing code' }).click();
  const pairingCode = await deviceDialog.getByRole('textbox', { name: 'Pairing code' }).inputValue();
  expect(pairingCode).toMatch(/^\d{6}$/);
  await deviceDialog.getByRole('button', { name: 'Copy code' }).click();
  expect(await managementPage.evaluate(() => navigator.clipboard.readText())).toBe(pairingCode);
  const pairedResponse = await managementPage.request.post('/api/v1/field-sales/pair', { data: { code: pairingCode } });
  expect(pairedResponse.status()).toBe(200);
  const paired = (await pairedResponse.json()).data;
  expect(paired.token).toMatch(/^fld_[a-f0-9]{64}$/);
  expect((await managementPage.request.post('/api/v1/field-sales/pair', { data: { code: pairingCode } })).status()).toBe(401);
  await deviceDialog.getByRole('textbox', { name: 'Pairing code' }).evaluate(element => {
    (element as HTMLInputElement).value = '[private code hidden]';
  });
  await managementPage.screenshot({ path: testInfo.outputPath('manual-android-key.png'), fullPage: true });
  await managementContext.close();
});
