import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { aplicarConvite } from "@/lib/auth/aplicar-convite";
import type { InvitePayload } from "@/lib/auth/invite-token";
import { audit, hashEmail } from "@/lib/audit";
import { logger } from "@/lib/logger";
import { manualInviteEligible } from "@/lib/auth/manual-invite-eligibility";
import { isExistingAccountError } from "@/lib/auth/existing-account-error";

type ManualResult =
  | { kind: "email_flow" }
  | { kind: "invalid" }
  | { kind: "already_exists" }
  | { kind: "failed" }
  | { kind: "accepted" };

/**
 * Enrollment without a mail gateway is deliberately narrower than ordinary signup.
 * A privately delivered, signed invitation is the proof of possession here; it
 * is NOT proof that the recipient controls the email address. Only a persisted,
 * pending, unsent viewer/agent invitation can use this path. Existing users must
 * sign in and accept instead, so an invitation can never reset their password.
 */
export async function enrollFromManualInvite(input: {
  payload: InvitePayload;
  fullName: string;
  password: string;
  requestId: string | null;
}): Promise<ManualResult> {
  const { payload, fullName, password, requestId } = input;
  const admin = createAdminClient();
  const { data: invite, error: readError } = await admin
    .from("team_invites")
    .select("organization_id, email, role, expires_at, accepted_at, revoked_at, email_dispatched, interface_settings")
    .eq("id", payload.invite_id)
    .eq("organization_id", payload.organization_id)
    .maybeSingle();
  if (readError) return { kind: "failed" };
  // Historical stateless invitations still take the existing email flow.
  // The no-email path requires a persisted, revocable row.
  if (!invite) return { kind: "email_flow" };
  if (invite.email_dispatched) return { kind: "email_flow" };
  if (!manualInviteEligible(invite, payload)) return { kind: "invalid" };

  const sessionClient = await createClient();
  const { data: existingSession } = await sessionClient.auth.getUser();
  if (existingSession.user) return { kind: "invalid" };

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email: payload.email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName, enrollment_method: "admin_shared_invite" },
  });
  if (createError || !created.user) {
    return { kind: isExistingAccountError(createError) ? "already_exists" : "failed" };
  }

  const rollback = async () => {
    await sessionClient.auth.signOut();
    // If membership succeeded but the final state check failed, reopen only
    // this invite, only when this newly created user was the accepter.
    const { error: reopenError } = await admin.from("team_invites")
      .update({ accepted_at: null, accepted_by: null })
      .eq("id", payload.invite_id)
      .eq("organization_id", payload.organization_id)
      .eq("accepted_by", created.user.id)
      .is("revoked_at", null);
    if (reopenError) logger.error("manual invite reopen failed", { organization_id: payload.organization_id, invite_id: payload.invite_id });
    const { error } = await admin.auth.admin.deleteUser(created.user.id);
    if (error) logger.error("manual invite rollback failed", { organization_id: payload.organization_id, invite_id: payload.invite_id });
  };
  const { error: loginError } = await sessionClient.auth.signInWithPassword({
    email: payload.email,
    password,
  });
  if (loginError) {
    await rollback();
    return { kind: "failed" };
  }

  const accepted = await aplicarConvite({ userId: created.user.id, payload, requestId });
  if (!accepted.ok) {
    await rollback();
    return { kind: accepted.motivo === "invalid_or_expired" ? "invalid" : "failed" };
  }
  // An inviter may revoke while GoTrue is creating the user. The regular accept
  // helper uses a conditional UPDATE; confirm that this exact invite was closed
  // for this user before leaving the new account active.
  const { data: closed, error: closeError } = await admin
    .from("team_invites")
    .select("accepted_by, revoked_at")
    .eq("id", payload.invite_id)
    .eq("organization_id", payload.organization_id)
    .maybeSingle();
  if (closeError || closed?.revoked_at || closed?.accepted_by !== created.user.id) {
    await rollback();
    return { kind: "invalid" };
  }
  await audit({
    action: "auth.manual_invite_enrolled",
    actorUserId: created.user.id,
    organizationId: payload.organization_id,
    resourceType: "membership",
    resourceId: accepted.membershipId,
    metadata: { invite_id: payload.invite_id, email_hash: hashEmail(payload.email) },
    requestId,
  });
  return { kind: "accepted" };
}
