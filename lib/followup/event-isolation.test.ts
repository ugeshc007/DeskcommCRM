import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type pg from "pg";
import { createSupabaseAdminClient } from "./engine";
import { createPgAdminClient } from "./turn-bridge";

describe("follow-up event tenant scope", () => {
  it("filters Supabase event history by organization as well as enrollment", async () => {
    const query = {
      select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({ data: [], error: null }),
    };
    const db = { from: vi.fn().mockReturnValue(query) };
    await createSupabaseAdminClient(db as unknown as SupabaseClient).loadEnrollmentEvents("enrollment-a", "org-b");
    expect(db.from).toHaveBeenCalledWith("followup_enrollment_events");
    expect(query.eq).toHaveBeenCalledWith("enrollment_id", "enrollment-a");
    expect(query.eq).toHaveBeenCalledWith("organization_id", "org-b");
  });

  it("binds organization in the worker PostgreSQL query", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    await createPgAdminClient({ query } as unknown as pg.Pool).loadEnrollmentEvents("enrollment-a", "org-b");
    expect(query).toHaveBeenCalledWith(expect.stringContaining("organization_id = $2"), ["enrollment-a", "org-b"]);
  });
});
