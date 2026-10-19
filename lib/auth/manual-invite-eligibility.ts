import { isDeepStrictEqual } from "node:util";
import type { InvitePayload } from "@/lib/auth/invite-token";

export interface ManualInviteRow {
  organization_id: string;
  email: string;
  role: string;
  expires_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
  interface_settings: unknown;
}

/** The admin-delivered link is usable for any human role only while its persisted row matches. */
export function manualInviteEligible(row: ManualInviteRow, payload: InvitePayload, now = Date.now()): boolean {
  return (
    (["field_officer", "viewer", "agent", "manager", "admin"] as string[]).includes(payload.role) &&
    row.organization_id === payload.organization_id &&
    row.accepted_at === null && row.revoked_at === null &&
    Date.parse(row.expires_at) > now &&
    row.email.trim().toLowerCase() === payload.email.trim().toLowerCase() &&
    row.role === payload.role &&
    Math.abs(Date.parse(row.expires_at) / 1000 - payload.exp) <= 1 &&
    isDeepStrictEqual(row.interface_settings, payload.interface_settings ?? { preset: "completa" })
  );
}
