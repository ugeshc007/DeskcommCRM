import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { strFromU8, unzipSync } from 'fflate';
import pg from 'pg';
import sharp from 'sharp';
import { authenticateFieldDevice, deviceTokenHash } from '@/lib/field-sales/devices';
import { localParts } from '@/lib/field-sales/schedule';

// A real software WebGL renderer is needed for the map in headless CI.
test.use({ launchOptions: { args: ['--enable-unsafe-swiftshader'] } });

// A dedicated synthetic organization, never shared credentials or production data.
const org = randomUUID(), employee = randomUUID(), project = randomUUID(), secondProject = randomUUID();
const password = randomUUID() + 'Aa9!', email = `field-${org}@synthetic.test`;
let actor = '';
let pool: pg.Pool;
let admin: ReturnType<typeof createClient>;
test.beforeAll(async () => {
  const api = process.env.NEXT_PUBLIC_SUPABASE_URL!, db = process.env.SUPABASE_DB_URL!;
  for (const value of [api, db]) if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(value).hostname)) throw new Error('Field UI tests require a disposable local backend');
  pool = new pg.Pool({ connectionString: db });
  admin = createClient(api, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
  await pool.query('select fn_provision_field_sales_flexible_shifts()');
  // A suite can run against a local stack created before the optional shop module was added.
  await pool.query(readFileSync('supabase/migrations/20260922113000_0384_field_sales_project_customers.sql', 'utf8'));
  await pool.query(readFileSync('supabase/migrations/20260922160000_0385_field_sales_activity_notes.sql', 'utf8'));
  await pool.query(readFileSync('supabase/migrations/20260924180000_0388_field_sales_location_quality.sql', 'utf8'));
  await pool.query(readFileSync('supabase/migrations/20260925120000_0389_field_sales_attendance_leave.sql', 'utf8'));
  await pool.query(readFileSync('supabase/migrations/20261018035000_0694_field_sales_route_styles.sql', 'utf8'));
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: 'Synthetic field administrator' } });
  if (created.error || !created.data.user) throw new Error('Synthetic field account creation failed');
  actor = created.data.user.id;
  if (!(await pool.query('select 1 from auth.users where id=$1', [actor])).rowCount) throw new Error('The test Auth API and PostgreSQL URL point to different local stacks');
  await pool.query(`insert into organizations(id,slug,legal_name,display_name,timezone,currency,locale,onboarded_at,onboarding_state)
    values($1,$2,'Synthetic field company','Synthetic field company','Asia/Dubai','AED','en',now(),'{"welcome":{"country_code":"AE"}}')`, [org, `field-ui-${org}`]);
  await pool.query("insert into user_organizations(user_id,organization_id,role,accepted_at) values($1,$2,'admin',now())", [actor, org]);
  await pool.query("insert into auth.users(id,email) values($1,$2)", [employee, `employee-${org}@synthetic.test`]);
  await pool.query("insert into user_organizations(user_id,organization_id,role,accepted_at) values($1,$2,'agent',now())", [employee, org]);
  await pool.query("insert into field_sales_employees(organization_id,user_id,display_name) values($1,$2,'Synthetic salesperson')", [org, employee]);
  await pool.query("insert into field_sales_projects(organization_id,id,name,site_name) values($1,$2,'Synthetic showroom','Dubai test site')", [org, project]);
  await pool.query("insert into field_sales_projects(organization_id,id,name,site_name) values($1,$2,'Secondary project','Second Dubai site')", [org, secondProject]);
});

test('manager reviews an overdue shift, ends it, and corrects reported hours', async ({ page }, testInfo) => {
  const teammate = randomUUID(), session = randomUUID();
  const started = new Date(Date.now() - 15 * 3600000);
  const date = localParts(started.getTime(), 'Asia/Dubai').slice(0, 10);
  await pool.query('insert into auth.users(id,email) values($1,$2)', [teammate, `${teammate}@synthetic.test`]);
  await pool.query("insert into user_organizations(user_id,organization_id,role,accepted_at) values($1,$2,'field_officer',now())", [teammate, org]);
  await pool.query("insert into field_sales_employees(organization_id,user_id,display_name) values($1,$2,'Shift review officer')", [org, teammate]);
  await pool.query(`insert into field_sales_sessions(organization_id,id,employee_id,local_date,status,punched_in_at,last_event_at)
    values($1,$2,$3,$4,'working',$5,$5)`, [org, session, teammate, date, started]);
  await page.goto('/login');
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(password);
  await page.getByRole('button', { name: /entrar|sign in/i }).click();
  await page.waitForURL(/\/app(?:\/|$)/);
  await page.goto('/app/field-sales');
  await page.getByRole('tab', { name: 'Attendance' }).click();
  const attendance = page.getByRole('region', { name: 'Daily field officer attendance' });
  await expect(attendance.getByRole('region', { name: 'Overdue field shifts' }).getByText('Shift review officer')).toBeVisible();
  await attendance.getByLabel('Date', { exact: true }).fill(date);
  const row = attendance.getByRole('article').filter({ has: page.getByRole('heading', { name: 'Shift review officer' }) });
  await expect(row.getByText('Over 14 hours.', { exact: false })).toBeVisible();
  await row.getByRole('button', { name: 'End shift' }).click();
  await attendance.getByRole('textbox', { name: 'Reason', exact: true }).fill('Officer confirmed shift ended by phone');
  await attendance.getByRole('button', { name: 'Confirm' }).click();
  await expect(row.getByRole('button', { name: 'Correct hours' })).toBeVisible();
  const closed = (await pool.query('select punched_out_at from field_sales_sessions where organization_id=$1 and id=$2',
    [org, session])).rows[0].punched_out_at as Date;
  const revised = new Date(Math.floor((closed.getTime() - 5 * 60000) / 60000) * 60000);
  await row.getByRole('button', { name: 'Correct hours' }).click();
  await attendance.getByLabel('Corrected punch-out').fill(localParts(revised.getTime(), 'Asia/Dubai'));
  await attendance.getByRole('textbox', { name: 'Reason', exact: true }).fill('Verified actual finish time with officer');
  await attendance.getByRole('button', { name: 'Confirm' }).click();
  await expect.poll(async () => (await pool.query(`select proposed_out from field_sales_corrections
    where organization_id=$1 and session_id=$2 and status='approved'`, [org, session])).rows[0]?.proposed_out?.toISOString())
    .toBe(revised.toISOString());
  await page.screenshot({ path: testInfo.outputPath('manager-shift-review.png'), fullPage: true });
  await pool.query('delete from field_sales_corrections where organization_id=$1 and session_id=$2', [org, session]);
  await pool.query('delete from field_sales_sessions where organization_id=$1 and id=$2', [org, session]);
  await pool.query('delete from field_sales_employees where organization_id=$1 and user_id=$2', [org, teammate]);
  await pool.query('delete from user_organizations where organization_id=$1 and user_id=$2', [org, teammate]);
  await pool.query('delete from auth.users where id=$1', [teammate]);
});
test.afterAll(async () => {
  if (pool) {
    await pool.query('delete from field_sales_devices where organization_id=$1', [org]);
    await pool.query('delete from organizations where id=$1 and slug=$2', [org, `field-ui-${org}`]);
    await pool.query('delete from auth.users where id=$1 and email=$2', [employee, `employee-${org}@synthetic.test`]);
    if (actor) await admin.auth.admin.deleteUser(actor);
    await pool.end();
  }
});

test('admin edits and removes a Field Sales officer from the compact Team list without deleting history', async ({ page }, testInfo) => {
  const teammate = randomUUID(), session = randomUUID();
  await pool.query('insert into auth.users(id,email) values($1,$2)', [teammate, `${teammate}@synthetic.test`]);
  await pool.query("insert into user_organizations(user_id,organization_id,role,accepted_at) values($1,$2,'field_officer',now())", [teammate, org]);
  await pool.query("insert into field_sales_employees(organization_id,user_id,display_name) values($1,$2,'Roster test officer')", [org, teammate]);
  await pool.query(`insert into field_sales_sessions(organization_id,id,employee_id,local_date,status,punched_in_at,punched_out_at,last_event_at)
    values($1,$2,$3,current_date,'off_duty',now()-interval '2 hours',now()-interval '1 hour',now()-interval '1 hour')`, [org, session, teammate]);
  await page.goto('/login');
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(password);
  await page.getByRole('button', { name: /entrar|sign in/i }).click();
  await page.waitForURL(/\/app(?:\/|$)/);
  await page.goto('/app/field-sales');
  await page.getByRole('tab', { name: 'Team', exact: true }).click();
  const list = page.locator('[data-layout="list"]');
  const row = list.getByRole('article').filter({ hasText: 'Roster test officer' });
  await row.getByRole('button', { name: 'Android keys' }).click();
  const devices = page.getByRole('dialog', { name: 'Android access — Roster test officer' });
  await devices.getByRole('textbox', { name: 'Phone name' }).fill('Roster test phone');
  await devices.getByRole('button', { name: 'Create pairing code' }).click();
  await expect(devices.getByLabel('Pairing code')).toHaveValue(/^\d{6}$/);
  expect((await pool.query(`select count(*)::int n from field_sales_devices
    where organization_id=$1 and employee_id=$2 and label=$3 and pairing_code_hash is not null and token_hash is null`,
  [org, teammate, 'Roster test phone'])).rows[0].n).toBe(1);
  await page.keyboard.press('Escape');
  await expect(devices).not.toBeVisible();
  await row.getByRole('button', { name: 'Edit name' }).click();
  await page.getByRole('dialog', { name: 'Edit field officer name' }).getByLabel('Field Sales display name').fill('Updated roster officer');
  await page.getByRole('dialog', { name: 'Edit field officer name' }).getByRole('button', { name: 'Save name' }).click();
  await expect(list.getByRole('article').filter({ hasText: 'Updated roster officer' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('field-team-edited-name.png'), fullPage: true });
  await list.getByRole('article').filter({ hasText: 'Updated roster officer' }).getByRole('button', { name: 'Remove' }).click();
  const confirmation = page.getByRole('alertdialog', { name: 'Remove this field officer?' });
  await expect(confirmation.getByText(/attendance, routes and visits remain saved/)).toBeVisible();
  await confirmation.getByRole('button', { name: 'Remove from Field Sales' }).click();
  // The alert dialog hides the page behind it from role queries. Wait for the
  // server mutation to finish before asserting that the Team row is gone.
  await expect(confirmation).not.toBeVisible();
  await expect(page.getByText('Updated roster officer removed from Field Sales. Their history is preserved.')).toBeVisible();
  await expect(list.getByRole('article').filter({ hasText: 'Updated roster officer' })).toHaveCount(0);
  expect((await pool.query('select active from field_sales_employees where organization_id=$1 and user_id=$2', [org, teammate])).rows[0].active).toBe(false);
  expect((await pool.query('select count(*)::int n from field_sales_sessions where organization_id=$1 and id=$2', [org, session])).rows[0].n).toBe(1);
  await page.screenshot({ path: testInfo.outputPath('field-team-removed-officer.png'), fullPage: true });
  await pool.query('delete from field_sales_devices where organization_id=$1 and employee_id=$2', [org, teammate]);
  await pool.query('delete from field_sales_sessions where organization_id=$1 and id=$2', [org, session]);
  await pool.query('delete from field_sales_employees where organization_id=$1 and user_id=$2', [org, teammate]);
  await pool.query('delete from user_organizations where organization_id=$1 and user_id=$2', [org, teammate]);
  await pool.query('delete from auth.users where id=$1', [teammate]);
});

test('manager can edit a Field Sales name but cannot remove or enroll an officer', async ({ page }, testInfo) => {
  await pool.query("update user_organizations set role='manager' where organization_id=$1 and user_id=$2", [org, actor]);
  try {
    await page.goto('/login');
    await page.locator('#email').fill(email);
    await page.locator('#password').fill(password);
    await page.getByRole('button', { name: /entrar|sign in/i }).click();
    await page.waitForURL(/\/app(?:\/|$)/);
    await page.goto('/app/field-sales');
    await page.getByRole('tab', { name: 'Team', exact: true }).click();
    const row = page.locator('[data-layout="list"]').getByRole('article').filter({ hasText: 'Synthetic salesperson' });
    await expect(row.getByRole('button', { name: 'Edit name' })).toBeVisible();
    await expect(row.getByRole('button', { name: 'Android keys' })).toHaveCount(0);
    await expect(row.getByRole('button', { name: 'Remove' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Enroll salesperson' })).toHaveCount(0);
    await row.getByRole('button', { name: 'Edit name' }).click();
    await page.getByRole('dialog', { name: 'Edit field officer name' }).getByLabel('Field Sales display name').fill('Manager-renamed salesperson');
    await page.getByRole('dialog', { name: 'Edit field officer name' }).getByRole('button', { name: 'Save name' }).click();
    await expect(page.locator('[data-layout="list"]').getByRole('article').filter({ hasText: 'Manager-renamed salesperson' })).toBeVisible();
    expect((await pool.query('select display_name,active from field_sales_employees where organization_id=$1 and user_id=$2', [org, employee])).rows[0])
      .toMatchObject({ display_name: 'Manager-renamed salesperson', active: true });
    await page.screenshot({ path: testInfo.outputPath('field-team-manager-edit-name.png'), fullPage: true });
  } finally {
    await pool.query("update user_organizations set role='admin' where organization_id=$1 and user_id=$2", [org, actor]);
    await pool.query("update field_sales_employees set display_name='Synthetic salesperson' where organization_id=$1 and user_id=$2", [org, employee]);
  }
});

test('organization region and shop template are usable in the manager UI', async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  await page.goto('/login');
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(password);
  await page.getByRole('button', { name: /entrar|sign in/i }).click();
  await page.waitForURL(/\/app(?:\/|$)/);
  await page.goto('/app/settings/tenant');
  await expect(page.getByLabel('Country or region')).toHaveValue('AE');
  await expect(page.getByLabel('Time zone')).toHaveValue('Asia/Dubai');
  await page.screenshot({ path: testInfo.outputPath('organization-region.png'), fullPage: true });
  await page.goto('/app/settings/tenant/agenda');
  await expect(page.getByRole('heading', { name: 'Schedule types' })).toBeVisible();

  await page.goto('/app/field-sales');
  await page.getByRole('tab', { name: 'Projects', exact: true }).click();
  const projectCard = page.locator('article').filter({ hasText: 'Synthetic showroom' });
  await projectCard.getByRole('button', { name: 'Manage shops and due' }).click();
  const shops = page.getByRole('dialog', { name: 'Shops · Synthetic showroom' });
  const downloadPromise = page.waitForEvent('download');
  await shops.getByRole('link', { name: 'Download CSV template' }).click();
  const template = await downloadPromise;
  expect(template.suggestedFilename()).toBe('field-sales-shops-template.csv');
  expect(readFileSync(await template.path(), 'utf8').trim()).toBe('customer_code,shop_name,address,due_amount');
  await shops.getByLabel('Shop name').fill('Synthetic corner shop');
  await shops.getByLabel('Shop code (optional)').fill('SHOP-1');
  await shops.getByLabel('Current due amount (optional)').fill('125.50');
  await shops.getByRole('button', { name: 'Save shop' }).click();
  await expect(shops.getByText('Project customers (1)')).toBeVisible();
  await expect(shops.getByText('Synthetic corner shop')).toBeVisible();
  await shops.locator('input[name="file"]').setInputFiles({ name: 'shops.csv', mimeType: 'text/csv',
    buffer: Buffer.from('customer_code,shop_name,address,due_amount\nSHOP-2,Synthetic second shop,,75.00\n'),
  });
  await shops.getByRole('button', { name: 'Upload shops' }).click();
  await expect(shops.getByText('Project customers (2)')).toBeVisible();
  await expect(shops.getByText('Synthetic second shop')).toBeVisible();
  await shops.getByLabel('Shop code (optional)').fill('');
  await shops.getByLabel('Shop name').fill('Synthetic no-code shop');
  await shops.getByRole('button', { name: 'Save shop' }).click();
  await expect(shops.getByText('Project customers (3)')).toBeVisible();
  await expect(shops.getByText('Synthetic no-code shop')).toBeVisible();
  await expect(shops.getByText(/manual-[0-9a-f]{8}/)).toHaveCount(0);
  page.once('dialog', dialog => void dialog.accept());
  await shops.getByRole('button', { name: 'Remove Synthetic no-code shop' }).click();
  await expect(shops.getByText('Project customers (2)')).toBeVisible();
  await expect(shops.getByText('Synthetic no-code shop')).toHaveCount(0);
  await shops.evaluate((element) => { element.scrollTop = 0; });
  await page.screenshot({ path: testInfo.outputPath('shops-and-due.png'), fullPage: true });
  await shops.getByRole('button', { name: 'Close' }).click();
  await page.getByRole('tab', { name: 'Live view', exact: true }).click();
  await expect(page.getByText('Configure country and time zone in the CRM organization settings first.')).toHaveCount(0);
  await expect(page.getByText('Live team view', { exact: false })).toBeVisible();
});

test('weekly project assignment, scoped activity and narrow-screen layout', async ({ page }, testInfo) => {
  test.setTimeout(120000);
  await page.goto('/login');
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(password);
  await page.getByRole('button', { name: /entrar|sign in/i }).click();
  await page.waitForURL(/\/app(?:\/|$)/);
  await page.goto('/app/field-sales');
  await expect(page.getByRole('heading', { name: 'Field Sales', exact: true })).toBeVisible();
  await expect(page.getByText('AE · Asia/Dubai', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Tracking policy', exact: true }).click();
  await page.getByLabel('Employee notice', { exact: true }).fill('Synthetic test policy: GPS is limited to declared working time and breaks.');
  await page.getByLabel('Raw location retention (days)', { exact: true }).fill('7');
  const policySaved = page.waitForResponse(response => response.url().endsWith('/api/v1/field-sales') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Save policy', exact: true }).click();
  expect((await policySaved).status()).toBe(200);
  await page.getByRole('tab', { name: 'Calendar', exact: true }).click();
  await page.getByLabel('Week of', { exact: true }).fill('2027-01-04');
  await page.getByRole('button', { name: 'Assign project', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Project', { exact: true }).selectOption(project);
  await dialog.getByLabel('Salesperson', { exact: true }).selectOption(employee);
  await dialog.getByLabel('Start date (optional)', { exact: true }).fill('2027-01-04');
  await dialog.getByLabel('Start time (optional)', { exact: true }).fill('09:00');
  await dialog.getByLabel('End time (optional)', { exact: true }).fill('11:00');
  await dialog.getByLabel('Mon', { exact: true }).check();
  await dialog.getByRole('button', { name: 'Save assignment', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText('Synthetic showroom', { exact: true })).toBeVisible();
  const visitCard = page.locator('article').filter({ hasText: 'Synthetic showroom' });
  expect((await visitCard.boundingBox())!.width).toBeGreaterThan(140);
  await expect.poll(async () => Number((await pool.query('select count(*) from field_sales_schedules where organization_id=$1', [org])).rows[0].count)).toBe(1);
  const schedule = (await pool.query('select id from field_sales_schedules where organization_id=$1', [org])).rows[0].id;
  const visitId = randomUUID();
  await pool.query(`insert into field_sales_visits(organization_id,id,employee_id,project_id,schedule_id,local_date,status,completed_at,next_action,next_action_at)
    values($1,$2,$3,$4,$5,'2027-01-04','completed',now(),'Synthetic follow-up call','2020-01-01T00:00:00Z')`, [org, visitId, employee, project, schedule]);
  await page.screenshot({ path: testInfo.outputPath('calendar-desktop.png'), fullPage: true });
  await page.getByRole('tab', { name: 'Live view', exact: true }).click();
  await expect(page.getByText('Tile path', { exact: true })).toBeHidden();
  await expect(page.getByText('Basemap not configured.', { exact: false })).toBeVisible();
  await page.getByLabel('Activity date', { exact: true }).fill('2027-01-04');
  await page.getByText('Off-duty officers · 1', { exact: true }).click();
  await expect(page.getByText('No on-duty position available', { exact: true })).toBeVisible();
  await expect(page.getByText('Due — follow up now', { exact: true })).toBeVisible();
  const image = await sharp({ create: { width: 24, height: 24, channels: 3, background: '#26a269' } }).jpeg().toBuffer();
  const photoId = randomUUID();
  await pool.query(`insert into field_sales_photos(organization_id,id,visit_id,employee_id,captured_at,fingerprint,image)
    values($1,$2,$3,$4,now(),$5,$6)`, [org, photoId, visitId, employee, 'a'.repeat(64), image]);
  await page.getByRole('button', { name: 'View visit photos', exact: true }).click();
  await page.getByRole('button', { name: 'Photo 1', exact: true }).click();
  await expect(page.getByRole('img', { name: 'Selected visit attachment' })).toBeVisible();
  await page.getByRole('button', { name: 'Remove selected photo' }).click();
  await page.getByRole('button', { name: 'Confirm photo deletion' }).click();
  await expect(page.getByRole('button', { name: 'Photo 1', exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');
  expect((await pool.query('select count(*)::int n from field_sales_photos where organization_id=$1 and id=$2', [org, photoId])).rows[0].n).toBe(0);
  if (process.env.FIELD_MAP_PILOT === 'true') {
    await page.getByText('Self-hosted basemap settings', { exact: true }).click();
    const loaded = page.waitForResponse(response => response.url().includes('/field-map-tiles/uae.pmtiles/') && response.status() === 200, { timeout: 20000 });
    await page.getByLabel('Tile path', { exact: true }).fill('/field-map-tiles/uae.pmtiles');
    await page.getByLabel('Tile-source attribution').fill('Protomaps');
    await page.getByRole('button', { name: 'Save map configuration' }).click();
    await page.locator('[data-map-ready]').scrollIntoViewIfNeeded();
    expect((await loaded).status()).toBe(200);
    await expect(page.locator('[data-map-ready="true"]')).toBeVisible({ timeout: 20000 });
    await expect(page.getByText('Map tiles or rendering are unavailable.', { exact: false })).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath('self-hosted-uae-map.png'), fullPage: true });
  }
  await page.getByRole('button', { name: 'Mark next action complete', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm completion', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.getByText('Due — follow up now', { exact: true })).toHaveCount(0);
  await expect.poll(async () => (await pool.query('select next_action_completed_at is not null done from field_sales_visits where organization_id=$1 and id=$2', [org, visitId])).rows[0].done).toBe(true);
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export daily CSV', exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('field-sales-2027-01-04.csv');
  await expect.poll(async () => Number((await pool.query("select count(*) from api_audit_log where organization_id=$1 and action='field_sales.daily_report_exported'", [org])).rows[0].count)).toBe(1);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('heading', { name: 'Attendance and route history' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('activity-mobile.png'), fullPage: true });
  await page.getByRole('tab', { name: 'Calendar', exact: true }).click();
  await page.getByRole('button', { name: 'Assign project', exact: true }).click();
  const untimed = page.getByRole('dialog');
  await untimed.getByLabel('Project', { exact: true }).selectOption(project);
  await untimed.getByLabel('Salesperson', { exact: true }).selectOption(employee);
  await expect(untimed.getByLabel('Start date (optional)', { exact: true })).toHaveValue('');
  await expect(untimed.getByLabel('Start time (optional)', { exact: true })).toHaveValue('');
  await untimed.getByLabel('Mon', { exact: true }).check();
  await untimed.getByLabel('Sat', { exact: true }).check();
  await page.screenshot({ path: testInfo.outputPath('untimed-weekly-assignment-mobile.png'), fullPage: true });
  await untimed.getByRole('button', { name: 'Save assignment', exact: true }).click();
  await expect(untimed).toBeHidden();
  const stored = (await pool.query('select rule from field_sales_schedules where organization_id=$1 order by created_at desc limit 1', [org])).rows[0].rule;
  const parts = new Intl.DateTimeFormat('en', { timeZone: 'Asia/Dubai', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const part = (type: string) => parts.find(value => value.type === type)?.value;
  expect(stored).toMatchObject({ start_date: `${part('year')}-${part('month')}-${part('day')}`,
    start_time: null, end_time: null, repeat: 'weekly', weekdays: [1, 6] });

  await page.getByRole('tab', { name: 'Team', exact: true }).click();
  await page.getByRole('button', { name: 'Manage projects' }).click();
  const projectManager = page.getByRole('dialog');
  await expect(projectManager.getByText('Synthetic showroom')).toBeVisible();
  const secondary = projectManager.locator('section').filter({ hasText: 'Secondary project' });
  await secondary.getByRole('button', { name: 'Assign weekdays' }).click();
  await projectManager.getByLabel('Start date', { exact: true }).fill('2027-01-04');
  await projectManager.getByLabel('Thu', { exact: true }).check();
  await projectManager.getByLabel('Sun', { exact: true }).check();
  await projectManager.getByRole('button', { name: 'Save weekdays' }).click();
  await expect(secondary.getByText('Thu, Sun')).toBeVisible();
  const beforeEdit = Number((await pool.query('select count(*) from field_sales_schedules where organization_id=$1 and project_id=$2', [org, secondProject])).rows[0].count);
  await secondary.getByRole('button', { name: 'Change future' }).click();
  await projectManager.getByLabel('Change from date').fill('2027-01-05');
  await expect(projectManager.getByLabel('Repeat until (optional)')).toHaveValue('');
  await projectManager.getByLabel('Thu', { exact: true }).uncheck();
  await projectManager.getByLabel('Tue', { exact: true }).check();
  await projectManager.getByRole('button', { name: 'Save weekdays' }).click();
  await expect(secondary.getByText('Tue, Sun')).toBeVisible();
  expect(Number((await pool.query('select count(*) from field_sales_schedules where organization_id=$1 and project_id=$2', [org, secondProject])).rows[0].count)).toBe(beforeEdit);
  await page.screenshot({ path: testInfo.outputPath('officer-project-weekdays.png'), fullPage: true });
  await page.keyboard.press('Escape');
  await page.getByRole('tab', { name: 'Calendar', exact: true }).click();
  await page.getByLabel('Week of', { exact: true }).fill('2027-01-04');
  const officerWeek = page.getByRole('row', { name: /Synthetic salesperson/ });
  await expect(officerWeek.locator('td').nth(1).getByText('Secondary project')).toBeVisible();
  await expect(officerWeek.locator('td').nth(6).getByText('Secondary project')).toBeVisible();
  await page.getByRole('tab', { name: 'Team', exact: true }).click();
  await page.getByRole('button', { name: 'Manage projects' }).click();
  const ending = page.getByRole('dialog').locator('section').filter({ hasText: 'Secondary project' });
  await ending.getByRole('button', { name: 'End assignment now' }).click();
  const endConfirmation = page.getByRole('alertdialog', { name: 'End this project assignment?' });
  await expect(endConfirmation).toBeVisible();
  await endConfirmation.getByRole('button', { name: 'End assignment', exact: true }).click();
  await expect(endConfirmation).toBeHidden();
  await expect(page.getByText('Secondary project assignment ended.')).toBeVisible();
  await expect(ending.getByText('Not assigned')).toBeVisible();
  await page.keyboard.press('Escape');

  // The administrator's dedicated map uses real scoped GPS rows and an independent date selector.
  const liveSession = randomUUID(), start = new Date(Date.now() - 120000);
  const day = `${part('year')}-${part('month')}-${part('day')}`;
  await pool.query(`insert into field_sales_sessions(organization_id,id,employee_id,project_id,local_date,status,punched_in_at,last_event_at)
    values($1,$2,$3,$4,$5::date,'working',$6,$6)`, [org, liveSession, employee, project, day, start]);
  await page.goto('/app/field-sales');
  await page.getByLabel('Week of').fill('2027-01-04');
  await page.getByRole('tab', { name: 'Live view', exact: true }).click();
  await expect(page.getByLabel('Activity date')).toHaveValue(day);
  await expect(page.getByRole('heading', { name: 'On-duty officers · 1' })).toBeVisible();
  const map = page.getByLabel('Recorded employee positions and selected work route');
  const dutyCards = page.getByRole('region', { name: 'Officer duty status' });
  await expect(map).toBeVisible();
  expect(await map.evaluate(element => element.compareDocumentPosition(document.querySelector('[aria-label="Officer duty status"]')!) & Node.DOCUMENT_POSITION_FOLLOWING)).toBeTruthy();
  await expect(dutyCards.getByRole('button', { name: 'List' })).toHaveAttribute('aria-pressed', 'true');
  await expect(dutyCards.locator('[data-layout="list"]')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('field-live-map-first-list.png'), fullPage: true });
  await dutyCards.getByRole('button', { name: 'Grid' }).click();
  await expect(dutyCards.locator('[data-layout="grid"]')).toBeVisible();
  await dutyCards.getByRole('button', { name: 'List' }).click();
  await expect(page.getByText(/waiting for the phone to send a GPS position/)).toBeVisible();
  await page.getByRole('button', { name: 'View route and visits', exact: true }).click();
  const emptyRoute = page.getByRole('dialog', { name: 'Route and visits', exact: true });
  await expect(emptyRoute.getByText('No recorded route for this date within the retention period.')).toBeVisible();
  await emptyRoute.getByRole('button', { name: 'Close', exact: true }).click();
  await pool.query(`insert into field_sales_activity_notes
    (organization_id,id,employee_id,session_id,project_id,note,source,captured_at,fingerprint)
    values($1,$2,$3,$4,$5,$6,'voice',$7,$8)`, [org, randomUUID(), employee, liveSession, project,
    'Going to Synthetic showroom', new Date(start.getTime() + 15000), 'b'.repeat(64)]);
  for (const [sequence, latitude, longitude] of [[0, 25.2048, 55.2708], [1, 25.2100, 55.2800]] as const) {
    await pool.query(`insert into field_sales_locations(organization_id,id,session_id,sequence,captured_at,latitude,longitude,accuracy_m,mock_location,fingerprint)
      values($1,$2,$3,$4,$5,$6,$7,12,false,$8)`, [org, randomUUID(), liveSession, sequence, new Date(start.getTime() + 30000 + sequence * 30000), latitude, longitude, 'a'.repeat(64)]);
  }
  // A newer indoor/network fix must not erase the earlier credible map pin.
  await pool.query(`insert into field_sales_locations(organization_id,id,session_id,sequence,captured_at,latitude,longitude,accuracy_m,mock_location,fingerprint)
    values($1,$2,$3,2,$4,25.2300,55.3000,230,false,$5)`, [org, randomUUID(), liveSession, new Date(start.getTime() + 90000), 'a'.repeat(64)]);
  const visitedShop = randomUUID();
  await pool.query(`insert into field_sales_project_customers(organization_id,id,project_id,shop_name,currency)
    values($1,$2,$3,'Synthetic visited shop','AED')`, [org, visitedShop, project]);
  await pool.query(`insert into field_sales_customer_collections
    (organization_id,id,project_customer_id,project_id,employee_id,session_id,captured_at,currency,fingerprint)
    values($1,$2,$3,$4,$5,$6,$7,'AED',$8)`, [org, randomUUID(), visitedShop, project, employee, liveSession,
    new Date(start.getTime() + 30000), 'c'.repeat(64)]);
  const deviceToken = 'fld_' + randomBytes(32).toString('hex');
  await pool.query(`insert into field_sales_devices(organization_id,id,employee_id,label,token_hash,expires_at)
    values($1,$2,$3,'Synthetic Android',$4,null)`, [org, randomUUID(), employee, deviceTokenHash(deviceToken)]);
  await authenticateFieldDevice(pool, 'Bearer ' + deviceToken);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/app/field-sales');
  await page.getByRole('tab', { name: 'Team', exact: true }).click();
  const team = page.getByRole('region', { name: 'Field officer attendance' });
  await expect(team.locator('[data-layout="list"]')).toBeVisible();
  await expect(team.getByRole('button', { name: 'Grid' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Manager visibility' })).toHaveCount(0);
  const officerCard = team.getByRole('article').filter({ has: page.getByRole('heading', { name: 'Synthetic salesperson', exact: true }) });
  await expect(officerCard.getByText('Online', { exact: true })).toBeVisible();
  await expect(officerCard.getByText('On duty', { exact: true })).toBeVisible();
  await expect(officerCard.getByText('In:', { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('field-team-presence-desktop.png'), fullPage: true });
  await page.getByRole('tab', { name: 'Projects', exact: true }).click();
  const staffedProject = page.getByRole('article').filter({ has: page.getByRole('heading', { name: 'Synthetic showroom', exact: true }) });
  await expect(staffedProject.getByText('Working now · 1')).toBeVisible();
  await expect(staffedProject.getByText('Working now · 1').locator('..').getByText('Synthetic salesperson')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('project-working-officer.png'), fullPage: true });
  await page.getByRole('tab', { name: 'Team', exact: true }).click();
  await officerCard.getByRole('button', { name: 'Attendance', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Attendance' })).toHaveAttribute('data-state', 'active');
  const attendance = page.getByRole('region', { name: 'Daily field officer attendance' });
  await expect(attendance.locator('[data-layout="list"]')).toBeVisible();
  await expect(attendance.getByRole('button', { name: 'Grid' })).toHaveCount(0);
  await expect(attendance.getByRole('heading', { name: 'Synthetic salesperson' })).toBeVisible();
  await expect(attendance.locator('[data-layout="list"]').getByText('Working time', { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('field-attendance-desktop.png'), fullPage: true });
  const monthly = page.getByRole('region', { name: 'Monthly field officer attendance' });
  await expect(monthly).toBeVisible();
  await expect(monthly.locator('tbody tr')).toHaveCount(new Date(Number(day.slice(0, 4)), Number(day.slice(5, 7)), 0).getDate());
  await expect(monthly.locator('tbody').getByText(day, { exact: true })).toBeVisible();
  await expect(monthly.locator('tbody tr').filter({ hasText: day }).getByText('Synthetic showroom')).toBeVisible();
  const [attendanceDownload] = await Promise.all([
    page.waitForEvent('download'), monthly.getByRole('button', { name: 'Export employee Excel' }).click(),
  ]);
  expect(attendanceDownload.suggestedFilename()).toBe(`field-attendance-${day.slice(0, 7)}.xlsx`);
  const attendanceSheet = strFromU8(unzipSync(readFileSync(await attendanceDownload.path()))['xl/worksheets/sheet1.xml']!);
  expect(attendanceSheet).toContain('<t>Field officer</t>');
  expect(attendanceSheet).toContain('<t>Project</t>');
  expect(attendanceSheet).toContain('<t>Synthetic salesperson</t>');
  expect(attendanceSheet).toContain('<t>Synthetic showroom</t>');
  await page.screenshot({ path: testInfo.outputPath('field-attendance-monthly-desktop.png'), fullPage: true });
  const secondEmployee = randomUUID(), secondSession = randomUUID();
  await pool.query('insert into auth.users(id,email) values($1,$2)', [secondEmployee, `${secondEmployee}@synthetic.test`]);
  await pool.query("insert into user_organizations(user_id,organization_id,role,accepted_at) values($1,$2,'agent',now())", [secondEmployee, org]);
  await pool.query("insert into field_sales_employees(organization_id,user_id,display_name) values($1,$2,'Aardvark salesperson')", [org, secondEmployee]);
  const secondStart = new Date(start.getTime() - 180000), secondEnd = new Date(start.getTime() - 60000);
  await pool.query(`insert into field_sales_sessions(organization_id,id,employee_id,project_id,local_date,status,punched_in_at,punched_out_at,last_event_at)
    values($1,$2,$3,$4,$5::date,'off_duty',$6,$7,$7)`, [org, secondSession, secondEmployee, project, day, secondStart, secondEnd]);
  for (const [sequence, latitude, longitude] of [[0, 25.1900, 55.2500], [1, 25.1950, 55.2550], [2, 25.1951, 55.2551]] as const) {
    await pool.query(`insert into field_sales_locations(organization_id,id,session_id,sequence,captured_at,latitude,longitude,accuracy_m,mock_location,fingerprint)
      values($1,$2,$3,$4,$5,$6,$7,12,false,$8)`, [org, randomUUID(), secondSession, sequence,
      new Date(secondStart.getTime() + 30000 + sequence * 30000), latitude, longitude, 'a'.repeat(64)]);
  }
  await page.getByRole('tab', { name: 'Live view', exact: true }).click();
  await page.getByRole('checkbox', { name: "Route history · show all employees' travel paths" }).check();
  await expect(page.getByLabel('Route color for Synthetic salesperson')).toBeVisible();
  await expect(page.getByLabel('Route color for Aardvark salesperson')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('all-employee-route-history.png'), fullPage: true });
  await authenticateFieldDevice(pool, 'Bearer ' + deviceToken);
  // The roster query was loaded before this officer was inserted. Reload as a manager would
  // after enrolling a new officer so the Team tab reads the current roster.
  await page.reload();
  await page.getByRole('tab', { name: 'Team', exact: true }).click();
  await officerCard.getByRole('button', { name: 'Attendance', exact: true }).click();
  const [teamDownload] = await Promise.all([
    page.waitForEvent('download'), monthly.getByRole('button', { name: 'Export all employees Excel' }).click(),
  ]);
  expect(teamDownload.suggestedFilename()).toBe(`field-attendance-all-${day.slice(0, 7)}.xlsx`);
  const teamArchive = unzipSync(readFileSync(await teamDownload.path()));
  const workbookManifest = strFromU8(teamArchive['xl/workbook.xml']!);
  expect(workbookManifest).toContain('name="Aardvark salesperson"');
  expect(workbookManifest).toContain('name="Synthetic salesperson"');
  expect(strFromU8(teamArchive['xl/worksheets/sheet1.xml']!)).toContain('<t>Aardvark salesperson</t>');
  expect(strFromU8(teamArchive['xl/worksheets/sheet2.xml']!)).toContain('<t>Synthetic salesperson</t>');
  await page.screenshot({ path: testInfo.outputPath('field-attendance-team-export.png'), fullPage: true });
  await page.getByRole('tab', { name: 'Team', exact: true }).click();
  await expect(team.getByRole('article').first().getByRole('heading', { name: 'Synthetic salesperson' })).toBeVisible();
  const offlineOfficer = team.getByRole('article').filter({ has: page.getByRole('heading', { name: 'Aardvark salesperson' }) });
  const formatPunch = (value: Date) => new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Dubai' }).format(value);
  await expect(offlineOfficer.locator('dl')).toContainText(formatPunch(secondStart));
  await expect(offlineOfficer.locator('dl')).toContainText(formatPunch(secondEnd));
  await officerCard.getByRole('button', { name: 'View route and visits' }).click();
  await expect(page).toHaveURL(/\/app\/field-sales$/);
  const routeDialog = page.getByRole('dialog', { name: 'Route and visits', exact: true });
  await expect(routeDialog).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Route and visits', exact: true })).toBeVisible();
  await routeDialog.getByRole('button', { name: 'Full screen', exact: true }).click();
  // The native vertical scrollbar can reserve 16px of a 1440px test viewport.
  // Full screen must cover the entire usable viewport, including its left edge.
  await expect.poll(() => routeDialog.evaluate(element => {
    const bounds = element.getBoundingClientRect();
    return bounds.left <= 1 && bounds.right >= document.documentElement.clientWidth - 1;
  })).toBe(true);
  await routeDialog.getByRole('button', { name: 'Exit full screen', exact: true }).click();
  await page.getByLabel('Travel date').fill(day);
  await routeDialog.getByText('Field officers', { exact: true }).locator('..').locator('summary').click();
  await expect(routeDialog.getByLabel('Synthetic salesperson', { exact: true })).toBeChecked();
  await routeDialog.getByRole('button', { name: 'All routes' }).click();
  await routeDialog.getByText('Field officers', { exact: true }).locator('..').locator('summary').click();
  await expect(routeDialog.getByRole('region', { name: 'Selected officer routes' })).toBeVisible();
  await expect(routeDialog.getByLabel('Route color for Aardvark salesperson')).toBeVisible();
  const colorA = await routeDialog.getByLabel('Route color for Synthetic salesperson').locator('line').getAttribute('stroke');
  const colorB = await routeDialog.getByLabel('Route color for Aardvark salesperson').locator('line').getAttribute('stroke');
  expect(colorA).not.toBe(colorB);
  await routeDialog.getByLabel('Route color for Aardvark salesperson').click();
  await expect(routeDialog.getByLabel('Route color for Aardvark salesperson')).toHaveAttribute('aria-pressed', 'true');
  await page.screenshot({ path: testInfo.outputPath('highlighted-officer-route.png') });
  await routeDialog.getByLabel('Route color for Aardvark salesperson').click();
  await expect(routeDialog.getByLabel('Route color for Aardvark salesperson')).toHaveAttribute('aria-pressed', 'false');
  await routeDialog.getByRole('region', { name: 'Selected officer routes' }).getByText('Synthetic salesperson', { exact: true })
    .locator('..').getByRole('button', { name: 'View only this officer' }).click();
  await expect(page.getByText('Recorded GPS points for selected date')).toBeVisible();
  await expect(page.getByText('3', { exact: true }).first()).toBeVisible();
  await expect(page.locator('[aria-label="Recorded employee positions and selected work route"]')).toBeVisible();
  await routeDialog.getByRole('button', { name: 'Full screen map' }).click();
  const viewport = await page.evaluate(() => ({ width: document.documentElement.clientWidth, height: window.innerHeight }));
  await expect.poll(async () => {
    const bounds = await routeDialog.boundingBox();
    return !!bounds && bounds.x <= 2 && bounds.y <= 2
      && bounds.width >= viewport.width - 2 && bounds.height >= viewport.height - 2;
  }).toBe(true);
  await expect.poll(async () => {
    const bounds = await page.getByLabel('Recorded employee positions and selected work route').boundingBox();
    return !!bounds && bounds.width > viewport.width * 0.9 && bounds.height > viewport.height * 0.7;
  }).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('route-map-full-screen.png') });
  await routeDialog.getByRole('button', { name: 'Exit full screen map' }).click();
  await expect.poll(async () => Math.round((await routeDialog.boundingBox())?.width ?? viewport.width)).toBeLessThan(viewport.width);
  await expect(routeDialog.getByLabel('Route color for Synthetic salesperson')).toBeVisible();
  await expect(page.getByRole('heading', { name: `Activity notes · ${day}` })).toBeVisible();
  await expect(page.getByText('Going to Synthetic showroom', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Synthetic visited shop', exact: true })).toBeVisible();
  const visits = routeDialog.getByRole('region', { name: 'Officer shop visits and collections' });
  await expect(visits.getByRole('button', { name: 'List' })).toHaveAttribute('aria-pressed', 'true');
  await expect(visits.locator('[data-layout="list"]')).toBeVisible();
  await visits.getByRole('button', { name: 'Grid' }).click();
  await expect(visits.locator('[data-layout="grid"]')).toBeVisible();
  await visits.getByRole('button', { name: 'List' }).click();
  await expect(page.getByText('Shop visit · no amount entered', { exact: true })).toBeVisible();
  await expect(page.getByText('Shop pin · accuracy ±12 m', { exact: true })).toBeVisible();
  if (process.env.FIELD_MAP_PILOT === 'true') await expect(page.locator('[data-map-ready="true"]')).toBeVisible({ timeout: 20000 });
  await page.screenshot({ path: testInfo.outputPath('admin-live-map-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  if (process.env.FIELD_MAP_PILOT === 'true') await expect(page.locator('[data-map-ready="true"]')).toBeVisible({ timeout: 20000 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('admin-live-map-mobile.png'), fullPage: true });
  await routeDialog.getByRole('button', { name: 'Close', exact: true }).click();
  await page.goto('/app/field-sales/live');
  await expect(page.getByText(/Newer GPS at .* was too imprecise or untrusted; pin shows the earlier reliable fix/)).toBeVisible();
  const officerPin = page.getByRole('button', { name: "View Synthetic salesperson's route for this date" });
  await expect(officerPin).toBeVisible();
  await page.getByRole('button', { name: 'Refresh locations' }).click();
  await expect(officerPin).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('last-reliable-pin-after-refresh.png'), fullPage: true });
  await pool.query("update field_sales_devices set last_seen_at=now()-interval '3 minutes' where organization_id=$1 and employee_id=$2", [org, employee]);
  await page.getByRole('button', { name: 'Refresh locations' }).click();
  await expect(officerPin).toHaveCount(0);
  const offlineCard = page.getByRole('region', { name: 'Officer duty status' }).getByRole('article')
    .filter({ has: page.getByRole('heading', { name: 'Synthetic salesperson', exact: true }) });
  await expect(offlineCard.getByText('Punch-in recorded · App offline')).toBeVisible();
  await expect(offlineCard.getByText(/^Offline · App last checked in:/)).toBeVisible();
  await expect(offlineCard.getByText('Phone offline. Last known GPS is historical; there is no current live map pin.')).toBeVisible();
  await expect(offlineCard.getByText('Last reliable position:', { exact: false })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('offline-officer-without-live-pin.png'), fullPage: true });
  await authenticateFieldDevice(pool, 'Bearer ' + deviceToken);
  await pool.query("update field_sales_sessions set punched_in_at=now()-interval '20 minutes' where organization_id=$1 and id=$2", [org, liveSession]);
  await pool.query("update field_sales_locations set captured_at=now()-interval '10 minutes'+sequence*interval '1 second' where organization_id=$1 and session_id=$2", [org, liveSession]);
  await page.getByRole('button', { name: 'Refresh locations' }).click();
  await expect(officerPin).toHaveCount(0);
  await expect(offlineCard.getByText(/^Online · App last checked in:/)).toBeVisible();
  await expect(offlineCard.getByText('Phone online, but no recent reliable GPS. Last known position is historical; there is no current live map pin.')).toBeVisible();
  await offlineCard.getByRole('button', { name: 'View route and visits' }).click();
  await expect(page.getByText('Recorded GPS points for selected date')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('online-officer-with-stale-gps.png'), fullPage: true });
  await pool.query("update field_sales_sessions set status='off_duty',punched_out_at=now() where organization_id=$1 and id=$2", [org, liveSession]);
  await authenticateFieldDevice(pool, 'Bearer ' + deviceToken);
  await page.goto('/app/field-sales');
  await page.getByRole('tab', { name: 'Live view', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Online · no active work session', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'On-duty officers · 0', exact: true })).toBeVisible();
  await expect(page.getByText(/Check attendance sync on the phone if it shows working/)).toBeVisible();
  await expect(page.getByRole('region', { name: 'Officer duty status' }).getByRole('article')
    .filter({ has: page.getByRole('heading', { name: 'Synthetic salesperson', exact: true }) })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('online-officer-without-confirmed-shift.png'), fullPage: true });
});
