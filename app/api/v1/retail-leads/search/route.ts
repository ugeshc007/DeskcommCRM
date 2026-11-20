import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const searchSchema = z.object({ phone: z.string().regex(/^\+[0-9]{8,15}$/) });

export async function POST(req: NextRequest): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId, resource: "crm_retail_leads" });
  if (!authz.ok) return authz.response;
  const parsed = searchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail("validation_failed", "Enter a phone in international format, such as +971501234567.", 422, { requestId });

  const supabase = await createClient();
  const { data: profiles, error: profileError } = await supabase.from("crm_retail_leads" as never)
    .select("lead_id,primary_phone,store_name,active,created_at")
    .eq("organization_id", authz.org.orgId).eq("primary_phone", parsed.data.phone)
    .order("created_at", { ascending: false }).limit(201);
  if (profileError) return fail("internal_error", "Could not search Event IDs.", 500, { requestId });
  const visibleProfiles = (profiles ?? []) as Array<{ lead_id: string; primary_phone: string;
    store_name: string; active: boolean; created_at: string }>;
  const selected = visibleProfiles.slice(0, 200);
  if (!selected.length) return ok({ events: [], has_more: false }, { requestId });
  const { data: leads, error: leadError } = await supabase.from("crm_leads")
    .select("id,title,pipeline_id,status,custom_fields,created_at")
    .eq("organization_id", authz.org.orgId).in("id", selected.map((profile) => profile.lead_id));
  if (leadError) return fail("internal_error", "Could not search Event IDs.", 500, { requestId });
  const byId = new Map((leads ?? []).map((lead) => [lead.id, lead]));
  return ok({
    events: selected.flatMap((profile) => {
      const lead = byId.get(profile.lead_id);
      return lead ? [{ event_id: profile.lead_id, customer_name: lead.title,
        phone: profile.primary_phone, store_name: profile.store_name,
        pipeline_id: lead.pipeline_id, status: lead.status,
        custom_fields: lead.custom_fields, created_at: lead.created_at }] : [];
    }),
    has_more: visibleProfiles.length > 200,
  }, { requestId });
}
