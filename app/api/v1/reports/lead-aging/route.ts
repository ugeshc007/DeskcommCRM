import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  days: z.coerce.number().int().min(1).max(365).default(30),
});

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "reports" });
  if (!authz.ok) return authz.response;

  const parsed = querySchema.safeParse({
    days: new URL(req.url).searchParams.get("days") ?? undefined,
  });
  if (!parsed.success) {
    return fail("validation_failed", "Days must be between 1 and 365.", 422, { requestId });
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("fn_lead_stage_aging" as never, {
    p_org: authz.org.orgId,
    p_min_days: parsed.data.days,
    p_limit: 100,
  } as never);
  if (error) return fail("internal_error", "Could not load lead aging.", 500, { requestId });

  return ok({ days: parsed.data.days, ...(data as Record<string, unknown>) }, { requestId });
}
