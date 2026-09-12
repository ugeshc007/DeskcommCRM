import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";

const INVITE_EMAIL = "managed-limit-recovery@deskcomm.test";
type Fixture = { password: string; org_id: string; user_id: string; email: string };

async function fixture(): Promise<Fixture> {
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const tag = randomUUID();
  const email = `managed-owner-${tag}@invariant.test`;
  const password = `E2e!${randomUUID()}`;
  const user = await db.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { locale: "en" } });
  if (user.error || !user.data.user) throw user.error ?? new Error("fixture user missing");
  const org = await db.from("organizations").insert({ slug: `managed-${tag}`, display_name: "Managed SaaS E2E", legal_name: "Managed SaaS E2E", onboarded_at: new Date().toISOString() }).select("id").single();
  if (org.error || !org.data) throw org.error ?? new Error("fixture org missing");
  const membership = await db.from("user_organizations").insert({ user_id: user.data.user.id, organization_id: org.data.id, role: "admin", accepted_at: new Date().toISOString() });
  if (membership.error) throw membership.error;
  const platform = await db.from("platform_admins").insert({ user_id: user.data.user.id, granted_by: user.data.user.id, scope: "full", mfa_required: false, reason: "managed SaaS E2E" });
  if (platform.error) throw platform.error;
  return { password, org_id: org.data.id, user_id: user.data.user.id, email };
}

async function login(page: Page, c: Fixture) {
  await page.goto("/login");
  await page.locator("#email").fill(c.email);
  await page.locator("#password").fill(c.password);
  await page.getByRole("button", { name: /entrar|sign in/i }).click();
  await page.waitForURL(/\/app\//, { timeout: 60_000 });
}

test.describe.configure({ mode: "serial", timeout: 180_000 });

test("platform owner configures a limit, tenant sees it, block is visible, and correction recovers", async ({ page }) => {
  const c = await fixture();
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const members = await db.from("user_organizations").select("*", { count: "exact", head: true }).eq("organization_id", c.org_id).is("revoked_at", null);
  if (members.error || members.count === null) throw members.error ?? new Error("member count unavailable");
  try {
    await login(page, c);
    await page.goto(`/admin/tenants/${c.org_id}`);
    await expect(page.getByText("Managed subscription", { exact: true })).toBeVisible();
    await page.getByLabel("Plan").selectOption("pro");
    await page.getByLabel("Status").selectOption("active");
    await page.getByLabel("Subscription reference").fill("e2e-managed-subscription");
    await page.getByLabel("Members").fill(String(members.count));
    const saved = page.waitForResponse(r => r.url().includes(`/api/v1/admin/tenants/${c.org_id}/subscription`) && r.request().method() === "PATCH");
    await page.getByRole("button", { name: /create subscription|update subscription/i }).click();
    expect((await saved).status()).toBe(200);
    await expect(page.getByText(/members has reached its configured limit/i)).toBeVisible();

    await page.goto("/app/settings/billing");
    await expect(page.getByRole("heading", { name: "Billing" })).toBeVisible();
    await expect(page.getByText(`${members.count} / ${members.count}`, { exact: true })).toBeVisible();
    fs.mkdirSync(path.join(process.cwd(), "evidence"), { recursive: true });
    await page.screenshot({ path: path.join(process.cwd(), "evidence", "managed-saas-billing.png"), fullPage: true });

    const blocked = await page.request.post("/api/v1/team/invite", { data: { invitations: [{ email: INVITE_EMAIL, role: "agent" }] } });
    expect(blocked.status(), await blocked.text()).toBe(409);

    await page.goto(`/admin/tenants/${c.org_id}`);
    await page.getByLabel("Members").fill(String(members.count + 1));
    const corrected = page.waitForResponse(r => r.url().includes(`/api/v1/admin/tenants/${c.org_id}/subscription`) && r.request().method() === "PATCH");
    await page.getByRole("button", { name: "Update subscription" }).click();
    expect((await corrected).status()).toBe(200);
    const recovered = await page.request.post("/api/v1/team/invite", { data: { invitations: [{ email: INVITE_EMAIL, role: "agent" }] } });
    expect(recovered.status(), await recovered.text()).toBe(201);
  } finally {
    await db.from("team_invites").delete().eq("organization_id", c.org_id).eq("email", INVITE_EMAIL);
    await db.from("organization_billing_events" as never).delete().eq("organization_id", c.org_id);
    await db.from("billing_webhook_receipts" as never).delete().eq("organization_id", c.org_id);
    await db.from("organizations").delete().eq("id", c.org_id);
    await db.auth.admin.deleteUser(c.user_id);
  }
});
