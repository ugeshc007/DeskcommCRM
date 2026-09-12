"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useTenantSubscription } from "@/hooks/useTenantSubscription";
import type { OrganizationBillingEvent, OrganizationSubscription, SaasNotice } from "@/lib/saas/subscription";

const field = "h-9 rounded-sm border border-border bg-surface px-3 text-sm";
export function SubscriptionCard({ organizationId }: { organizationId: string }) {
  const { data, isLoading, save, isSaving, saveError } = useTenantSubscription(organizationId);
  const subscription = data?.data.subscription;
  const events = data?.data.events ?? [];
  const notices = data?.data.notices ?? [];
  return <Card>
    <CardHeader><CardTitle>Managed subscription</CardTitle><CardDescription>{subscription ? `Manual ledger · revision ${subscription.revision}` : "No managed subscription. Self-host behavior remains unchanged until you save."}</CardDescription></CardHeader>
    <CardContent>{isLoading ? <p className="text-sm text-muted-foreground">Loading subscription…</p> : <SubscriptionForm key={subscription?.revision ?? "new"} subscription={subscription ?? null} events={events} notices={notices} save={save} isSaving={isSaving} saveError={saveError} />}</CardContent>
  </Card>;
}

function localDate(value: string | null | undefined) { return value ? new Date(value).toISOString().slice(0, 16) : ""; }
function wireDate(value: string) { return value ? new Date(value).toISOString() : null; }
function SubscriptionForm({ subscription, events, notices, save, isSaving, saveError }: { subscription: OrganizationSubscription | null; events: OrganizationBillingEvent[]; notices: SaasNotice[]; save: (body: unknown) => Promise<unknown>; isSaving: boolean; saveError: Error | null }) {
  const [plan, setPlan] = useState<string>(subscription?.plan_code ?? "standard");
  const [status, setStatus] = useState<string>(subscription?.status ?? "trialing");
  const [members, setMembers] = useState(subscription?.limits.members?.toString() ?? "");
  const [channels, setChannels] = useState(subscription?.limits.channels?.toString() ?? "");
  const [ai, setAi] = useState(subscription?.limits.monthly_ai_cents?.toString() ?? "");
  const [provider, setProvider] = useState(subscription?.billing_provider ?? "manual");
  const [customerRef, setCustomerRef] = useState(subscription?.external_customer_ref ?? "");
  const [subscriptionRef, setSubscriptionRef] = useState(subscription?.external_subscription_ref ?? "");
  const [trialEnds, setTrialEnds] = useState(localDate(subscription?.trial_ends_at));
  const [periodStart, setPeriodStart] = useState(localDate(subscription?.current_period_start));
  const [periodEnd, setPeriodEnd] = useState(localDate(subscription?.current_period_end));
  const [cancelAtEnd, setCancelAtEnd] = useState(subscription?.cancel_at_period_end ?? false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const limits = Object.fromEntries([["members", members], ["channels", channels], ["monthly_ai_cents", ai]].filter(([, value]) => value !== "").map(([key, value]) => [key, Number(value)]));
    await save({ plan_code: plan, status, billing_provider: provider, external_customer_ref: customerRef || null, external_subscription_ref: subscriptionRef || null, trial_ends_at: wireDate(trialEnds), current_period_start: wireDate(periodStart), current_period_end: wireDate(periodEnd), cancel_at_period_end: cancelAtEnd, limits });
  }
  return <form className="space-y-4" onSubmit={submit}>
      {notices.map((notice, index) => <div key={`${notice.code}-${notice.resource ?? index}`} role="status" className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">{notice.message}</div>)}
      <div className="grid gap-3 sm:grid-cols-2"><label className="grid gap-1 text-sm">Plan<select className={field} value={plan} onChange={e=>setPlan(e.target.value)}><option value="standard">Standard</option><option value="pro">Pro</option><option value="enterprise">Enterprise</option></select></label><label className="grid gap-1 text-sm">Status<select className={field} value={status} onChange={e=>setStatus(e.target.value)}><option value="trialing">Trialing</option><option value="active">Active</option><option value="past_due">Past due</option><option value="canceled">Canceled</option></select></label></div>
      <div className="grid gap-3 sm:grid-cols-3"><label className="grid gap-1 text-xs">Provider<input className={field} value={provider} onChange={e=>setProvider(e.target.value)} /></label><label className="grid gap-1 text-xs">Customer reference<input className={field} value={customerRef} onChange={e=>setCustomerRef(e.target.value)} /></label><label className="grid gap-1 text-xs">Subscription reference<input className={field} value={subscriptionRef} onChange={e=>setSubscriptionRef(e.target.value)} /></label></div>
      <div className="grid gap-3 sm:grid-cols-3"><label className="grid gap-1 text-xs">Trial ends<input className={field} type="datetime-local" value={trialEnds} onChange={e=>setTrialEnds(e.target.value)} /></label><label className="grid gap-1 text-xs">Period starts<input className={field} type="datetime-local" value={periodStart} onChange={e=>setPeriodStart(e.target.value)} /></label><label className="grid gap-1 text-xs">Period ends<input className={field} type="datetime-local" value={periodEnd} onChange={e=>setPeriodEnd(e.target.value)} /></label></div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={cancelAtEnd} onChange={e=>setCancelAtEnd(e.target.checked)} /> Cancel at period end</label>
      <div><p className="mb-2 text-sm font-medium">Optional limits</p><div className="grid gap-3 sm:grid-cols-3"><label className="grid gap-1 text-xs">Members<input className={field} min="0" type="number" value={members} onChange={e=>setMembers(e.target.value)} /></label><label className="grid gap-1 text-xs">Channels<input className={field} min="0" type="number" value={channels} onChange={e=>setChannels(e.target.value)} /></label><label className="grid gap-1 text-xs">Monthly AI cents<input className={field} min="0" type="number" value={ai} onChange={e=>setAi(e.target.value)} /></label></div></div>
      {saveError && <p role="alert" className="text-sm text-destructive">The subscription could not be saved.</p>}
      <Button disabled={isSaving} type="submit">{isSaving ? "Saving…" : subscription ? "Update subscription" : "Create subscription"}</Button>
      {events.length > 0 && <div className="border-t pt-4"><p className="mb-2 text-sm font-medium">Recent billing events</p><ul className="space-y-2 text-xs text-muted-foreground">{events.map(event => <li key={event.id} className="flex justify-between gap-3"><span>{event.event_type.replaceAll("_", " ")}{event.previous_status ? `: ${event.previous_status} → ${event.new_status}` : ""}</span><time>{new Date(event.occurred_at).toLocaleString()}</time></li>)}</ul></div>}
    </form>;
}
