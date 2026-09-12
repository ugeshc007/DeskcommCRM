import { redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { emailDeSuporte } from "@/lib/branding/saida";
import { getBudgetStatus } from "@/lib/ai/budget/check";
import type { OrganizationSubscription } from "@/lib/saas/subscription";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function BillingPage() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg || ROLE_RANK[activeOrg.role] < ROLE_RANK.admin) redirect("/403");
  const db = await createClient();
  const [{ data }, members, channels, aiUsage] = await Promise.all([
    db.from("organization_subscriptions" as never).select("*").eq("organization_id", activeOrg.orgId).maybeSingle(),
    db.from("user_organizations").select("*", { count: "exact", head: true }).eq("organization_id", activeOrg.orgId).is("revoked_at", null),
    db.from("channel_sessions").select("*", { count: "exact", head: true }).eq("organization_id", activeOrg.orgId).is("archived_at", null),
    getBudgetStatus(activeOrg.orgId),
  ]);
  const subscription = data as OrganizationSubscription | null;
  const support = emailDeSuporte();
  return <div className="flex h-full flex-col gap-6 p-6">
    <header><h1 className="text-2xl font-semibold tracking-tight">Billing</h1><p className="text-sm text-muted-foreground">Your managed plan, current status, and included limits.</p></header>
    {!subscription ? <Card className="max-w-2xl"><CardHeader><CardTitle>Self-hosted installation</CardTitle><CardDescription>No managed subscription is attached to this organization. The complete self-hosted edition remains available without SaaS limits.</CardDescription></CardHeader>{support && <CardContent><a className="underline" href={`mailto:${support}`}>Contact support</a></CardContent>}</Card> : <>
      <Card className="max-w-2xl"><CardHeader><div className="flex items-center justify-between gap-3"><CardTitle className="capitalize">{subscription.plan_code} plan</CardTitle><Badge variant={subscription.status === "active" || subscription.status === "trialing" ? "success" : "warning"}>{subscription.status.replace("_", " ")}</Badge></div><CardDescription>Managed by {subscription.billing_provider}. Billing state never silently suspends your workspace.</CardDescription></CardHeader><CardContent className="grid gap-3 text-sm sm:grid-cols-2"><p>Current period ends<br/><strong>{subscription.current_period_end ? new Date(subscription.current_period_end).toLocaleDateString(user.idioma) : "Not set"}</strong></p><p>Cancellation at period end<br/><strong>{subscription.cancel_at_period_end ? "Scheduled" : "No"}</strong></p></CardContent></Card>
      <Card className="max-w-2xl"><CardHeader><CardTitle>Usage and limits</CardTitle><CardDescription>A missing limit means that resource is not capped.</CardDescription></CardHeader><CardContent className="grid gap-4 sm:grid-cols-3"><Usage label="Members" used={members.count ?? 0} limit={subscription.limits.members}/><Usage label="Channels" used={channels.count ?? 0} limit={subscription.limits.channels}/><Usage label="Monthly AI spend" used={aiUsage.current_month_consumed_cents} limit={subscription.limits.monthly_ai_cents} suffix=" cents" note={aiUsage.gasto_incompleto ? "Some calls do not have a known price, so actual spend may be higher." : "Measured from this month's model calls."}/></CardContent></Card>
    </>}
  </div>;
}

function Usage({ label, used, limit, suffix = "", note }: { label: string; used: number; limit?: number; suffix?: string; note?: string }) {
  return <div className="rounded-lg border p-4"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 text-xl font-semibold">{used}{suffix} / {limit === undefined ? "Unlimited" : `${limit}${suffix}`}</p>{note && <p className="mt-2 text-xs text-muted-foreground">{note}</p>}</div>;
}
