import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const assignSchema = z.object({
  user_id: z.string().uuid(),
  store_name: z.string().trim().min(1).max(120),
});

export async function POST(req: NextRequest): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "crm_retail_store_assignments" });
  if (!authz.ok) return authz.response;
  const parsed = assignSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail("validation_failed", "Choose a team member and store.", 422, { requestId });
  const supabase = await createClient();
  const { error } = await supabase.rpc("fn_assign_retail_store" as never, {
    p_org: authz.org.orgId,
    p_user: parsed.data.user_id,
    p_store: parsed.data.store_name,
  } as never);
  if (error) {
    if (error.message.includes("retail_user_unavailable")) {
      return fail("validation_failed", "That person is not an active member of this organization.", 422, { requestId });
    }
    return fail("internal_error", "Could not assign the store.", 500, { requestId });
  }
  return ok({ user_id: parsed.data.user_id, store_name: parsed.data.store_name }, { requestId });
}
