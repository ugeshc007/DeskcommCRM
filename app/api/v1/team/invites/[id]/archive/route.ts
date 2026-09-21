import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { NextRequest } from "next/server";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** Hide a revoked invitation without removing the row that invalidates its signed URL. */
export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const denied = await requireSupportWrite(); if (denied) return denied;
  const requestId = randomUUID();
  const auth = await requireRole("admin", { requestId, resource: "team" });
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) return fail("invalid_request", "Invalid invitation.", 400, { requestId });

  const client = await createClient();
  const { data, error } = await client.from("team_invites")
    .update({ archived_at: new Date().toISOString() })
    .eq("organization_id", auth.org.orgId).eq("id", id)
    .not("revoked_at", "is", null).is("accepted_at", null).is("archived_at", null)
    .select("id").maybeSingle();
  if (error) return fail("internal_error", error.message, 500, { requestId });
  if (!data) return fail("state_conflict", "Only a revoked invitation can be removed from the list.", 409, { requestId });
  await audit({ action: "member.invite_archived", actorUserId: auth.user.id,
    organizationId: auth.org.orgId, resourceType: "membership", resourceId: id, requestId });
  return ok({ id, removed: true }, { requestId });
}
