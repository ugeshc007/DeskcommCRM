import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const phone = z.string().regex(/^\+[0-9]{8,15}$/);
const createSchema = z.object({
  pipeline_id: z.string().uuid(),
  stage_id: z.string().uuid(),
  customer_name: z.string().trim().min(2).max(200),
  primary_phone: phone,
  secondary_phone: phone.nullable().optional(),
  email: z.email().max(200).nullable().optional(),
  source: z.string().trim().min(1).max(120),
  how_known: z.string().trim().max(500).nullable().optional(),
  products: z.array(z.string().trim().min(1).max(120)).min(1).max(20),
  budget_cents: z.number().int().nonnegative().max(1_000_000_000_000),
  expected_purchase_date: z.iso.date(),
  address: z.string().trim().max(500).nullable().optional(),
  next_followup_at: z.iso.datetime({ offset: true }),
}).refine((value) => Date.parse(value.next_followup_at) > Date.now(), {
  path: ["next_followup_at"],
  message: "The next follow-up must be in the future.",
});

export async function POST(req: NextRequest): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId, resource: "crm_leads" });
  if (!authz.ok) return authz.response;
  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail("validation_failed", "Check the required retail lead fields.", 422, {
    requestId, details: { issues: parsed.error.issues },
  });
  const v = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("fn_create_retail_lead" as never, {
    p_org: authz.org.orgId,
    p_pipeline: v.pipeline_id,
    p_stage: v.stage_id,
    p_name: v.customer_name,
    p_phone: v.primary_phone,
    p_secondary_phone: v.secondary_phone ?? null,
    p_email: v.email ?? null,
    p_source: v.source,
    p_how_known: v.how_known ?? null,
    p_products: v.products,
    p_budget_cents: v.budget_cents,
    p_purchase_date: v.expected_purchase_date,
    p_address: v.address ?? null,
    p_next_followup_at: v.next_followup_at,
  } as never);
  if (error) {
    if (error.message.includes("retail_event_open") ||
        error.message.includes("crm_retail_one_open_event_per_phone")) {
      return fail("conflict", "This phone already has an open Event ID. Close it as Converted or Lost first.", 409, { requestId });
    }
    if (error.message.includes("retail_store_unassigned")) {
      return fail("validation_failed", "A manager must assign your store before you can create retail leads.", 422, { requestId });
    }
    if (error.message.includes("retail_phone_ambiguous") || error.message.includes("retail_phone_identity_conflict")) {
      return fail("validation_failed", "This phone matches conflicting customer records. Ask a manager to review it.", 422, { requestId });
    }
    if (error.message.includes("retail_stage_unavailable")) {
      return fail("validation_failed", "Choose an open stage in this organization's pipeline.", 422, { requestId });
    }
    return fail("internal_error", "The retail lead could not be created.", 500, { requestId });
  }
  return ok({ lead_id: data, event_id: data }, { requestId, status: 201 });
}
