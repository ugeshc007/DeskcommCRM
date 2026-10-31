import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadCredential } from "./credentials";

const mocks = vi.hoisted(() => ({
  from: vi.fn(), decryptKey: vi.fn(), byteaToBuffer: vi.fn(),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: mocks.from }),
}));
vi.mock("@/lib/crypto/aes_gcm", () => ({
  decryptKey: mocks.decryptKey, byteaToBuffer: mocks.byteaToBuffer,
}));

const row = {
  id: "credential-a", organization_id: "org-a", provider: "openai",
  label: "Test connection", api_key_encrypted: "encrypted-test-value",
  api_key_iv: "test-iv", api_key_tag: "test-tag", is_active: true,
  validated_at: "2026-09-17T00:00:00Z",
};

function database(rows = [row], error: { message: string } | null = null, ignoreFilters = false) {
  const filters = new Map<string, unknown>();
  const query = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn((key: string, value: unknown) => { filters.set(key, value); return query; }),
    maybeSingle: vi.fn(async () => ({
      data: rows.find((r) => ignoreFilters || [...filters].every(([k, v]) => r[k as keyof typeof r] === v)) ?? null,
      error,
    })),
  };
  mocks.from.mockReturnValue(query);
  return query;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.decryptKey.mockReturnValue("test-only-secret");
  mocks.byteaToBuffer.mockImplementation(() => Buffer.from("test"));
});

describe("credential organization boundary", () => {
  it("scopes the database read by both credential and trusted organization", async () => {
    const query = database();
    await expect(loadCredential(row.id, "org-a")).resolves.toEqual({
      apiKey: "test-only-secret", provider: "openai", label: "Test connection",
    });
    expect(query.eq).toHaveBeenCalledWith("id", row.id);
    expect(query.eq).toHaveBeenCalledWith("organization_id", "org-a");
  });

  it("does not reveal whether another organization's credential exists", async () => {
    database();
    await expect(loadCredential(row.id, "org-b")).rejects.toMatchObject({ reason: "not_found" });
    expect(mocks.decryptKey).not.toHaveBeenCalled();
    expect(mocks.byteaToBuffer).not.toHaveBeenCalled();
  });

  it("retains a defensive ownership check if a backend returns an unexpected row", async () => {
    database([row], null, true);
    await expect(loadCredential(row.id, "org-b")).rejects.toMatchObject({ reason: "wrong_org" });
    expect(mocks.decryptKey).not.toHaveBeenCalled();
  });

  it.each([
    { ...row, is_active: false, reason: "inactive" },
    { ...row, validated_at: null, reason: "not_validated" },
  ])("refuses $reason credentials before decryption", async ({ reason, ...credential }) => {
    const query = database();
    query.maybeSingle.mockResolvedValue({ data: credential as typeof row, error: null });
    await expect(loadCredential(row.id, "org-a")).rejects.toMatchObject({ reason });
    expect(mocks.decryptKey).not.toHaveBeenCalled();
  });

  it("does not copy database diagnostics into propagated errors", async () => {
    database([], { message: "sensitive-diagnostic-marker" });
    const error = await loadCredential(row.id, "org-a").catch((e: Error) => e);
    expect(error).toMatchObject({ reason: "not_found" });
    expect(String(error)).not.toContain("sensitive-diagnostic-marker");
    expect(mocks.decryptKey).not.toHaveBeenCalled();
  });

  it("does not copy crypto diagnostics into propagated errors", async () => {
    database();
    mocks.decryptKey.mockImplementation(() => { throw new Error("sensitive-crypto-marker"); });
    const error = await loadCredential(row.id, "org-a").catch((e: Error) => e);
    expect(error).toMatchObject({ reason: "decrypt_failed" });
    expect(String(error)).not.toContain("sensitive-crypto-marker");
  });
});
