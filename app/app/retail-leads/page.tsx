import Link from "next/link";
import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK, roleAtLeast } from "@/lib/auth/types";
import { createClient } from "@/lib/supabase/server";
import { nomesDosAtendentes } from "@/lib/users/nome-do-atendente";

import { RetailLeadWorkspace } from "./workspace";
import { RetailFollowupAction } from "./followup-action";
import { RetailLeadTransfer, type TransferDestination } from "./transfer";

export const dynamic = "force-dynamic";

interface RetailProfile {
  lead_id: string;
  primary_phone: string;
  products: string[];
  store_name: string;
  next_followup_at: string | null;
  active: boolean;
}

interface OverdueItem {
  lead_id: string;
  title: string;
  pipeline_id: string;
  store_name: string;
  due_at: string;
  escalation_at: string;
  escalated: boolean;
}

export default async function RetailLeadsPage() {
  const user = await requireAuth();
  const org = await resolveActiveOrg(user);
  if (!org || ROLE_RANK[org.role] < ROLE_RANK.agent) redirect("/app");
  const manager = ROLE_RANK[org.role] >= ROLE_RANK.manager;
  const supabase = await createClient();
  const [{ data: pipelines }, { data: stages }, { data: currencyRow }, profileResult, assignmentResult, myStoreResult] = await Promise.all([
    supabase.from("crm_pipelines").select("id,name").eq("organization_id", org.orgId)
      .eq("is_archived", false).order("position"),
    supabase.from("crm_stages").select("id,pipeline_id,name,position,is_won,is_lost,is_archived")
      .eq("organization_id", org.orgId).order("position"),
    supabase.from("organizations").select("currency").eq("id", org.orgId).maybeSingle(),
    supabase.from("crm_retail_leads" as never).select("lead_id,primary_phone,products,store_name,next_followup_at,active")
      .eq("organization_id", org.orgId).order("created_at", { ascending: false }).limit(50),
    supabase.from("crm_retail_store_assignments" as never).select("user_id,store_name")
      .eq("organization_id", org.orgId),
    supabase.rpc("fn_my_retail_store" as never, { p_org: org.orgId } as never),
  ]);
  const profiles = (profileResult.data ?? []) as RetailProfile[];
  const leadIds = profiles.map((profile) => profile.lead_id);
  const { data: leads } = leadIds.length
    ? await supabase.from("crm_leads").select("id,title,pipeline_id,stage_id,status,value_cents,created_at")
      .eq("organization_id", org.orgId).in("id", leadIds)
    : { data: [] };
  const byId = new Map((leads ?? []).map((lead) => [lead.id, lead]));
  const entries = profiles.flatMap((profile) => {
    const lead = byId.get(profile.lead_id);
    return lead ? [{ ...profile, ...lead }] : [];
  });
  const assignments = (assignmentResult.data ?? []) as Array<{ user_id: string; store_name: string }>;
  let members: Array<{ id: string; label: string }> = [];
  if (manager) {
    const { data: people } = await supabase.from("user_organizations")
      .select("user_id,role").eq("organization_id", org.orgId)
      .is("revoked_at", null).not("accepted_at", "is", null);
    const ids = (people ?? []).map((person) => person.user_id);
    const names = await nomesDosAtendentes(ids);
    members = (people ?? []).map((person) => ({
      id: person.user_id,
      label: `${names.get(person.user_id) ?? person.user_id.slice(0, 8)} · ${person.role}`,
    }));
  }
  const ownStore = (myStoreResult.data as string | null) ?? null;
  const openStages = (stages ?? []).filter((stage) => !stage.is_won && !stage.is_lost && !stage.is_archived);
  const activeStages = (stages ?? []).filter((stage) => !stage.is_archived);
  const { data: overdueData } = manager
    ? await supabase.rpc("fn_retail_overdue_followups" as never, { p_org: org.orgId, p_limit: 100 } as never)
    : { data: [] };
  const overdue = (overdueData ?? []) as OverdueItem[];
  let destinations: TransferDestination[] = [];
  if (manager) {
    const destinationIds = user.organizations
      .filter((membership) => membership.organization_id !== org.orgId &&
        roleAtLeast(membership.role, "manager"))
      .map((membership) => membership.organization_id);
    if (destinationIds.length) {
      const [{ data: orgRows }, { data: destPipelines }, { data: destStages },
        { data: destAssignments }, { data: destMembers }] = await Promise.all([
        supabase.from("organizations").select("id,display_name").in("id", destinationIds),
        supabase.from("crm_pipelines").select("id,organization_id,name")
          .in("organization_id", destinationIds).eq("is_archived", false),
        supabase.from("crm_stages").select("id,organization_id,pipeline_id,name,is_won,is_lost,is_archived")
          .in("organization_id", destinationIds),
        supabase.from("crm_retail_store_assignments" as never).select("organization_id,user_id,store_name")
          .in("organization_id", destinationIds),
        supabase.from("user_organizations").select("organization_id,user_id")
          .in("organization_id", destinationIds).is("revoked_at", null).not("accepted_at", "is", null),
      ]);
      const assigned = (destAssignments ?? []) as Array<{ organization_id: string; user_id: string; store_name: string }>;
      const eligibleMembers = (destMembers ?? []).filter((member) => assigned.some((store) =>
        store.organization_id === member.organization_id && store.user_id === member.user_id));
      const destinationNames = await nomesDosAtendentes(eligibleMembers.map((member) => member.user_id));
      destinations = (orgRows ?? []).map((destination) => ({
        id: destination.id,
        name: destination.display_name,
        pipelines: (destPipelines ?? []).filter((pipeline) => pipeline.organization_id === destination.id)
          .map((pipeline) => ({ id: pipeline.id, name: pipeline.name })),
        stages: (destStages ?? []).filter((stage) => stage.organization_id === destination.id &&
          !stage.is_won && !stage.is_lost && !stage.is_archived)
          .map((stage) => ({ id: stage.id, pipeline_id: stage.pipeline_id, name: stage.name })),
        owners: eligibleMembers.filter((member) => member.organization_id === destination.id)
          .map((member) => ({ id: member.user_id,
            name: destinationNames.get(member.user_id) ?? member.user_id.slice(0, 8),
            store: assigned.find((store) => store.organization_id === destination.id &&
              store.user_id === member.user_id)?.store_name ?? "" })),
      }));
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-8 p-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">Retail leads</h1>
        <p className="text-sm text-muted-foreground">
          Capture customer interest, keep one open Event ID per phone, and plan the next follow-up.
        </p>
      </header>
      <RetailLeadWorkspace
        pipelines={pipelines ?? []}
        stages={openStages}
        currency={currencyRow?.currency ?? "USD"}
        ownStore={ownStore}
        manager={manager}
        members={members}
        assignments={assignments}
      />
      {manager && <section className="space-y-3">
        <h2 className="text-lg font-semibold">Overdue follow-ups</h2>
        <p className="text-sm text-muted-foreground">
          Escalation is flagged after one Monday–Friday working day in this organization’s timezone.
          These are in-app flags; no customer message is sent.
        </p>
        <div className="space-y-2">
          {overdue.map((item) => <article key={item.lead_id} className={`rounded-lg border p-3 text-sm ${item.escalated ? "border-destructive" : ""}`}>
            <Link className="font-medium underline" href={`/app/pipelines/${item.pipeline_id}`}>{item.title}</Link>
            <span className="ml-2">· {item.store_name}</span>
            <p>Due {new Date(item.due_at).toLocaleString(user.idioma)} · {item.escalated
              ? "Escalated to manager" : `Escalates ${new Date(item.escalation_at).toLocaleString(user.idioma)}`}</p>
          </article>)}
          {overdue.length === 0 && <p className="rounded-lg border p-3 text-sm text-muted-foreground">No overdue retail follow-ups.</p>}
        </div>
      </section>}
      {manager && destinations.length > 0 &&
        <RetailLeadTransfer leads={entries.filter((entry) => entry.active).map((entry) => ({
          id: entry.lead_id, name: entry.title,
        }))} destinations={destinations} />}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Recent Event IDs</h2>
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted/40"><tr>
              <th className="p-3">Customer and Event ID</th><th className="p-3">Phone</th>
              <th className="p-3">Store</th><th className="p-3">Status</th>
              <th className="p-3">Next follow-up</th><th className="p-3">Action</th>
            </tr></thead>
            <tbody>{entries.map((entry) => (
              <tr key={entry.lead_id} className="border-t">
                <td className="p-3"><Link className="font-medium underline" href={`/app/pipelines/${entry.pipeline_id}`}>
                  {entry.title}</Link><span className="block font-mono text-xs text-muted-foreground">{entry.lead_id}</span></td>
                <td className="p-3">{entry.primary_phone}</td>
                <td className="p-3">{entry.store_name}</td>
                <td className="p-3">{entry.status === "won" ? "Converted" : entry.status === "lost" ? "Lost" : "Open"}</td>
                <td className="p-3">{entry.next_followup_at ? new Date(entry.next_followup_at).toLocaleString(user.idioma) : "—"}</td>
                <td className="p-3">{entry.active && entry.next_followup_at &&
                  <RetailFollowupAction leadId={entry.lead_id} expectedDueAt={entry.next_followup_at}
                    stageId={entry.stage_id}
                    stages={activeStages.filter((stage) => stage.pipeline_id === entry.pipeline_id)} />}</td>
              </tr>
            ))}</tbody>
          </table>
          {entries.length === 0 && <p className="p-4 text-sm text-muted-foreground">No retail Event IDs yet.</p>}
        </div>
      </section>
    </div>
  );
}
