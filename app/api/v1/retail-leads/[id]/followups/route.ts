import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  expected_due_at: z.iso.datetime({ offset: true }),
  next_stage_id: z.string().uuid(),
  next_followup_at: z.iso.datetime({ offset: true }).nullable(),
  note: z.string().trim().max(2000).nullable().optional(),
  lost_reason: z.string().trim().max(500).nullable().optional(),
});

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId, resource: "crm_retail_followup_actions" });
  if (!authz.ok) return authz.response;
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) return fail("validation_failed", "Invalid Event ID.", 422, { requestId });
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail("validation_failed", "Choose a status and the next follow-up, or close the lead.", 422, {
    requestId, details: { issues: parsed.error.issues },
  });
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("fn_complete_retail_followup" as never, {
    p_org: authz.org.orgId,
    p_lead: id,
    p_expected_due_at: parsed.data.expected_due_at,
    p_next_stage: parsed.data.next_stage_id,
    p_next_due_at: parsed.data.next_followup_at,
    p_note: parsed.data.note ?? null,
    p_lost_reason: parsed.data.lost_reason ?? null,
  } as never);
  if (error) {
    if (error.message.includes("retail_followup_changed")) {
      return fail("conflict", "This follow-up changed. Refresh the Event ID before marking it done.", 409, { requestId });
    }
    if (error.message.includes("retail_next_followup_required")) {
      return fail("validation_failed", "Choose a future next follow-up for an open lead.", 422, { requestId });
    }
    if (error.message.includes("retail_lost_reason_required")) {
      return fail("validation_failed", "A Lost lead needs a reason.", 422, { requestId });
    }
    if (error.message.includes("retail_lead_unavailable") || error.message.includes("retail_stage_unavailable")) {
      return fail("not_found", "This Event ID or stage is unavailable in your organization.", 404, { requestId });
    }
    return fail("internal_error", "Could not complete the follow-up.", 500, { requestId });
  }
  return ok(data, { requestId });
}
