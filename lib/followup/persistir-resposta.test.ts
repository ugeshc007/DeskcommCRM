import { describe, expect, it, vi } from "vitest";

import { interpolarDestino, recorteDaResposta, persistirRespostaFollowupPg, persistirRespostaFollowupSupabase } from "./persistir-resposta";

describe("recorteDaResposta", () => {
  it("caps text answers at the existing 2000-character contract", () => {
    expect(recorteDaResposta("x".repeat(3000))).toHaveLength(2000);
  });
  it("trims and keeps short text", () => {
    expect(recorteDaResposta("  Ana  ")).toBe("Ana");
  });
});

describe("answer persistence boundaries", () => {
  it("rejects invalid destinations before a worker can issue a write", async () => {
    const query = vi.fn();
    await expect(persistirRespostaFollowupPg(query, {
      organization_id: "org-a", contact_id: "contact-a", value: "answer",
      save_to: { kind: "lead_custom", key: "../other-record" },
    })).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });
  it("binds both the outer update and lead lookup to the organization", async () => {
    const query = vi.fn();
    await persistirRespostaFollowupPg(query, { organization_id: "org-a", contact_id: "contact-a", value: "answer", save_to: { kind: "lead_custom", key: "product" } });
    expect(query).toHaveBeenCalledWith(expect.stringContaining("where organization_id = $1 and id ="), ["org-a", "contact-a", "product", "answer"]);
  });
  it("does not propagate database diagnostics into worker logs", async () => {
    const q = { update: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), then: (resolve: (v: unknown) => unknown) => resolve({ error: { message: "private answer in DB diagnostic" } }) };
    await expect(persistirRespostaFollowupSupabase({ from: () => q } as never, { organization_id: "org-a", contact_id: "contact-a", value: "answer", save_to: { kind: "contact_name" } })).rejects.toThrow("followup_answer_write_failed");
  });
});

describe("interpolarDestino", () => {
  it("substitui {{volta}} pela última volta do repeat", () => {
    const out = interpolarDestino(
      { kind: "lead_custom", key: "filho_{{volta}}_nome" },
      [{ node_id: "rp", idempotency_key: "rp:0", payload: { repeat_index: 2, repeat_total: 3 } }],
    );
    expect(out).toEqual({ kind: "lead_custom", key: "filho_2_nome" });
  });

  it("nome do contato não muda", () => {
    expect(interpolarDestino({ kind: "contact_name" }, [])).toEqual({ kind: "contact_name" });
  });
});
