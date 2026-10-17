import { describe, expect, it } from "vitest";
import { manualInviteEligible, type ManualInviteRow } from "./manual-invite-eligibility";
import type { InvitePayload } from "./invite-token";

const now = Date.parse("2026-09-21T12:00:00Z");
const org = "11111111-1111-4111-8111-111111111111";
const otherOrg = "22222222-2222-4222-8222-222222222222";
const payload: InvitePayload = {
  invite_id: "33333333-3333-4333-8333-333333333333",
  email: "staff@synthetic.test",
  organization_id: org,
  role: "agent",
  exp: Math.floor(now / 1000) + 3600,
  interface_settings: { preset: "completa" },
};
const row: ManualInviteRow = {
  organization_id: org,
  email: payload.email,
  role: payload.role,
  expires_at: new Date(payload.exp * 1000).toISOString(),
  accepted_at: null,
  revoked_at: null,
  interface_settings: { preset: "completa" },
};

describe("manual staff enrollment eligibility", () => {
  it("accepts only the matching pending invitation", () => {
    expect(manualInviteEligible(row, payload, now)).toBe(true);
  });
  it("rejects a used, revoked, expired or superseded invitation", () => {
    expect(manualInviteEligible({ ...row, accepted_at: new Date(now).toISOString() }, payload, now)).toBe(false);
    expect(manualInviteEligible({ ...row, revoked_at: new Date(now).toISOString() }, payload, now)).toBe(false);
    expect(manualInviteEligible(row, payload, now + 3600_000)).toBe(false);
    expect(manualInviteEligible({ ...row, expires_at: new Date(now + 7200_000).toISOString() }, payload, now)).toBe(false);
  });
  it("rejects cross-organization, changed role, and elevated roles", () => {
    expect(manualInviteEligible({ ...row, organization_id: otherOrg }, payload, now)).toBe(false);
    expect(manualInviteEligible({ ...row, role: "manager" }, payload, now)).toBe(false);
    expect(manualInviteEligible({ ...row, role: "manager" }, { ...payload, role: "manager" }, now)).toBe(false);
  });
  it("permits a matching Field Officer invite without granting manager enrollment", () => {
    expect(manualInviteEligible({ ...row, role: "field_officer" }, { ...payload, role: "field_officer" }, now)).toBe(true);
  });
});
