import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const schema = z.object({
  destination_org_id: z.string().uuid(),
  destination_pipeline_id: z.string().uuid(),
  destination_stage_id: z.string().uuid(),
  destination_owner_user_id: z.string().uuid(),
});

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "crm_leads" });
  if (!authz.ok) return authz.response;
  const { id } = await context.params;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!z.uuid().safeParse(id).success || !parsed.success) {
    return fail("validation_failed", "Choose an Event ID, destination brand, pipeline, stage and salesperson.", 422, { requestId });
  }
  const v = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("fn_transfer_retail_lead" as never, {
    p_source_org: authz.org.orgId,
    p_destination_org: v.destination_org_id,
    p_lead: id,
    p_destination_pipeline: v.destination_pipeline_id,
    p_destination_stage: v.destination_stage_id,
    p_destination_owner: v.destination_owner_user_id,
  } as never);
  if (error) {
    if (error.message.includes("retail_transfer_forbidden")) {
      return fail("forbidden", "A manager or admin must belong to both organizations to move this Event ID.", 403, { requestId });
    }
    if (error.message.includes("retail_transfer_unavailable")) {
      return fail("not_found", "This open retail Event ID is no longer available in the source organization.", 404, { requestId });
    }
    if (error.message.includes("retail_destination_stage_unavailable") ||
        error.message.includes("retail_destination_owner_store_unavailable")) {
      return fail("validation_failed", "Choose an open destination stage and an active salesperson with a store assignment.", 422, { requestId });
    }
    if (error.message.includes("retail_event_open") ||
        error.message.includes("crm_retail_one_open_event_per_phone")) {
      return fail("conflict", "The destination already has an open Event ID for this phone.", 409, { requestId });
    }
    if (error.message.includes("retail_transfer_linked_") ||
        error.message.includes("retail_transfer_shared_contact") ||
        error.message.includes("retail_destination_contact_exists")) {
      return fail("conflict", "This Event ID has linked records or a matching destination contact that require a manager review before transfer.", 409, { requestId });
    }
    return fail("internal_error", "The Event ID could not be moved.", 500, { requestId });
  }
  return ok({ event_id: data, destination_org_id: v.destination_org_id }, { requestId });
}
