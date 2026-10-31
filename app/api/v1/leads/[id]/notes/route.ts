import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { requireSupportWrite } from "@/lib/impersonate/support";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { buildLeadActivityRow } from "@/lib/leads/activity-emitter";
import { audit } from "@/lib/audit";
import { fail, ok } from "@/lib/api/wrappers";

const NoteBody = z.object({ note: z.string().trim().min(1).max(2000) });

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId, resource: "crm_leads" });
  if (!authz.ok) return authz.response;
  const { id: leadId } = await ctx.params;
  if (!z.string().uuid().safeParse(leadId).success) {
    return fail("validation_failed", "Invalid lead ID.", 422, { requestId });
  }
  const parsed = NoteBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return fail("validation_failed", "Enter a note of up to 2,000 characters.", 422, { requestId });
  }

  const supabase = await createClient();
  const { data: lead, error: leadError } = await supabase.from("crm_leads")
    .select("id, organization_id, contact_id")
    .eq("organization_id", authz.org.orgId)
    .eq("id", leadId)
    .maybeSingle();
  if (leadError) return fail("internal_error", leadError.message, 500, { requestId });
  if (!lead) return fail("not_found", "Lead not found.", 404, { requestId });

  // A anotação é a própria atividade do negócio. Não há coluna espelho no lead:
  // o quadro lê a última linha do mesmo histórico que o dossiê apresenta.
  const row = buildLeadActivityRow({
    organizationId: authz.org.orgId,
    leadId,
    contactId: lead.contact_id,
    type: "note",
    sourceModule: "crm",
    actor: { type: "user", id: authz.user.id },
    reason: parsed.data.note,
  });
  const { data: created, error } = await supabase.from("crm_lead_activities")
    .insert(row).select("id, performed_at").single();
  if (error || !created) return fail("internal_error", error?.message ?? "Note was not saved.", 500, { requestId });

  await audit({
    action: "lead.updated",
    actorUserId: authz.user.id,
    organizationId: authz.org.orgId,
    resourceType: "lead",
    resourceId: leadId,
    metadata: { field: "note", activity_id: created.id },
    requestId,
  });
  return ok(created, { status: 201, requestId });
}
