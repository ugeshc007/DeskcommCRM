import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import pg from 'pg';
import sharp from 'sharp';

// A real software WebGL renderer is needed for the map in headless CI.
test.use({ launchOptions: { args: ['--enable-unsafe-swiftshader'] } });

// A dedicated synthetic organization, never shared credentials or production data.
const org = randomUUID(), employee = randomUUID(), project = randomUUID();
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
});
test.afterAll(async () => {
  if (pool) {
    await pool.query('delete from organizations where id=$1 and slug=$2', [org, `field-ui-${org}`]);
    await pool.query('delete from auth.users where id=$1 and email=$2', [employee, `employee-${org}@synthetic.test`]);
    if (actor) await admin.auth.admin.deleteUser(actor);
    await pool.end();
  }
});

test('weekly project assignment, scoped activity and narrow-screen layout', async ({ page }, testInfo) => {
  test.setTimeout(90000);
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
  await page.getByLabel('Starting date', { exact: true }).fill('2027-01-04');
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
  expect((await visitCard.boundingBox())!.width).toBeGreaterThan(200);
  await expect.poll(async () => Number((await pool.query('select count(*) from field_sales_schedules where organization_id=$1', [org])).rows[0].count)).toBe(1);
  const schedule = (await pool.query('select id from field_sales_schedules where organization_id=$1', [org])).rows[0].id;
  const visitId = randomUUID();
  await pool.query(`insert into field_sales_visits(organization_id,id,employee_id,project_id,schedule_id,local_date,status,completed_at,next_action,next_action_at)
    values($1,$2,$3,$4,$5,'2027-01-04','completed',now(),'Synthetic follow-up call','2020-01-01T00:00:00Z')`, [org, visitId, employee, project, schedule]);
  await page.screenshot({ path: testInfo.outputPath('calendar-desktop.png'), fullPage: true });
  await page.getByRole('tab', { name: 'Live view', exact: true }).click();
  await expect(page.getByText('Basemap not configured.', { exact: false })).toBeVisible();
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

  // The administrator's dedicated map uses real scoped GPS rows and an independent date selector.
  const liveSession = randomUUID(), start = new Date(Date.now() - 120000);
  const day = `${part('year')}-${part('month')}-${part('day')}`;
  await pool.query(`insert into field_sales_sessions(organization_id,id,employee_id,status,punched_in_at,last_event_at)
    values($1,$2,$3,'working',$4,$4)`, [org, liveSession, employee, start]);
  for (const [sequence, latitude, longitude] of [[0, 25.2048, 55.2708], [1, 25.2100, 55.2800]] as const) {
    await pool.query(`insert into field_sales_locations(organization_id,id,session_id,sequence,captured_at,latitude,longitude,accuracy_m,mock_location,fingerprint)
      values($1,$2,$3,$4,$5,$6,$7,12,false,$8)`, [org, randomUUID(), liveSession, sequence, new Date(start.getTime() + 30000 + sequence * 30000), latitude, longitude, 'a'.repeat(64)]);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/app/field-sales');
  await page.getByRole('tab', { name: 'Team', exact: true }).click();
  const officerCard = page.getByRole('article').filter({ has: page.getByRole('link', { name: 'View position and route' }) });
  await expect(officerCard.getByText('Present', { exact: true })).toBeVisible();
  await expect(officerCard.getByText('Punched in')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('field-team-presence-desktop.png'), fullPage: true });
  await officerCard.getByRole('link', { name: 'View position and route' }).click();
  await expect(page).toHaveURL(new RegExp(`/app/field-sales/live\\?employee_id=${employee}&date=${day}`));
  await expect(page.getByRole('heading', { name: 'Field team live view' })).toBeVisible();
  await page.getByLabel('Travel date').fill(day);
  await page.getByLabel('Field officer').selectOption(employee);
  await expect(page.getByText('2 recorded points', { exact: false })).toBeVisible();
  await expect(page.locator('[aria-label="Recorded employee positions and selected work route"]')).toBeVisible();
  if (process.env.FIELD_MAP_PILOT === 'true') await expect(page.locator('[data-map-ready="true"]')).toBeVisible({ timeout: 20000 });
  await page.screenshot({ path: testInfo.outputPath('admin-live-map-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  if (process.env.FIELD_MAP_PILOT === 'true') await expect(page.locator('[data-map-ready="true"]')).toBeVisible({ timeout: 20000 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('admin-live-map-mobile.png'), fullPage: true });
});
