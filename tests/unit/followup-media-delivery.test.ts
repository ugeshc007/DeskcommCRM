import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { JobRow } from "@/lib/agent-engine/queue/queue";
import type { FollowupTurnDeps } from "@/lib/agent-engine/agent/followup-turn";
import type * as FollowupTurnModule from "@/lib/agent-engine/agent/followup-turn";

const mocks = vi.hoisted(() => ({ handoff: vi.fn(), gate: vi.fn(), accepted: vi.fn(), reschedule: vi.fn() }));
vi.mock("@/lib/agent-engine/agent/human-handoff", () => ({ isLeadInHandoff: mocks.handoff }));
vi.mock("@/lib/agent-engine/guardrails/before-send", () => ({ runBeforeSend: mocks.gate }));
vi.mock("@/lib/agent-engine/edge/crm/get-lead-context", () => ({ getLeadContext: vi.fn(async () => ({ ok: true, context: { contact: { is_blocked: false } }, lgpd: {} })) }));
vi.mock("@/lib/agent-engine/agent/fuso-da-org", () => ({ fusoDaOrganizacao: vi.fn(async () => "UTC") }));
vi.mock("@/lib/atendimento/fronteira-server", () => ({ requireCurrentServiceBoundary: vi.fn() }));
vi.mock("@/lib/agent-engine/edge/crm/send-ledger", () => ({ reconcileAcceptedSend: mocks.accepted, resultadoDoEnvioDoFollowup: vi.fn() }));
vi.mock("@/lib/agent-engine/queue/queue", async (original) => ({ ...await original<object>(), rescheduleJob: mocks.reschedule }));
const org = "11111111-1111-4111-8111-111111111111";
const flow = "22222222-2222-4222-8222-222222222222";
const id = "33333333-3333-4333-8333-333333333333";
const asset = { storage_path: `${org}/flow-media/${flow}/${id}.png`, kind: "image", mime: "image/png", size_bytes: 8, caption: "Product photo" };
let createHandler: typeof FollowupTurnModule.createFollowupTurnHandler;
beforeAll(async () => { ({ createFollowupTurnHandler: createHandler } = await import("@/lib/agent-engine/agent/followup-turn")); }, 60_000);
beforeEach(() => {
  vi.clearAllMocks(); mocks.handoff.mockResolvedValue(false); mocks.accepted.mockResolvedValue(false);
  mocks.gate.mockImplementation(async (args) => ({ status: "sent", outcome: await args.send(args.body), trace: [] }));
});
function fixture(assets = [asset, { ...asset, caption: "Second photo" }]) {
  const job = { id, organization_id: org, contact_id: id, kind: "followup_turn", locked_by: "test-worker", locked_at: new Date(),
    payload: { followup_enrollment_id: flow, node_id: "media-1", purpose: "send_message", media_assets: assets,
      service_boundary: { organization_id: org, contact_id: id, conversation_id: flow, service_revision: 1, demanda_id: null, demanda_revision: null } } } as unknown as JobRow;
  const pool = { query: vi.fn(async () => ({ rows: [{ channel_session_id: id, archived_at: null }] })) };
  const send = vi.fn(async () => ({ kind: "sent", idempotencyKey: id, messageId: id }));
  const complete = vi.fn();
  const deps = { channel: () => ({ send }), log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }, crmCfg: {}, llmCfg: {}, knobs: {}, completeFollowupTurn: complete } as unknown as FollowupTurnDeps;
  return { job, pool, send, complete, run: () => createHandler(deps)(job, pool as never, { workerId: "test-worker" }) };
}
describe("media delivery through the existing worker and safeguards", () => {
  it("sends each file in order and completes only after both succeed", async () => {
    const f = fixture(); await f.run();
    expect(f.send).toHaveBeenNthCalledWith(1, expect.objectContaining({ seq: 2, tenantId: org, media: asset }));
    expect(f.send).toHaveBeenNthCalledWith(2, expect.objectContaining({ seq: 4, media: expect.objectContaining({ caption: "Second photo" }) }));
    expect(mocks.gate).toHaveBeenCalledTimes(2);
    expect(f.complete).toHaveBeenCalledWith(f.pool, expect.objectContaining({ result: { kind: "sent" } }));
  });
  it("skips accepted file receipts on retry", async () => {
    mocks.accepted.mockImplementation(async (_pool, input) => input.seq === 2);
    const f = fixture(); await f.run();
    expect(f.send).toHaveBeenCalledTimes(1);
    expect(f.send).toHaveBeenCalledWith(expect.objectContaining({ seq: 4 }));
  });
  it("stops before any send during human handoff", async () => {
    mocks.handoff.mockResolvedValue(true);
    const f = fixture(); await f.run();
    expect(f.send).not.toHaveBeenCalled();
    expect(f.complete).toHaveBeenCalledWith(f.pool, expect.objectContaining({ result: expect.objectContaining({ kind: "skipped" }) }));
  });
  it("does not falsely complete a failed or queued file", async () => {
    const f = fixture(); f.send.mockResolvedValue({ kind: "failed", idempotencyKey: id, messageId: id });
    await expect(f.run()).rejects.toThrow("failed");
    expect(f.complete).not.toHaveBeenCalled();
    expect(f.send).toHaveBeenCalledTimes(1);
  });
  it("retains the same job identity when the send window defers an album", async () => {
    mocks.gate.mockResolvedValue({ status: "vetoed", code: "outside_window", nextAllowedAt: new Date(Date.now() + 60_000) });
    const f = fixture(); await expect(f.run()).rejects.toThrow("deferred");
    expect(mocks.reschedule).toHaveBeenCalledWith(f.pool, id, "test-worker", expect.objectContaining({ reason: expect.stringContaining("Media") }));
    expect(f.send).not.toHaveBeenCalled(); expect(f.complete).not.toHaveBeenCalled();
  });
  it("sends accompanying audio text separately with its own replay identity", async () => {
    const audio = { ...asset, storage_path: asset.storage_path.replace(".png", ".mp3"), kind: "audio", mime: "audio/mpeg" };
    const f = fixture([audio]); await f.run();
    expect(f.send).toHaveBeenNthCalledWith(1, expect.objectContaining({ seq: 1, body: "Product photo" }));
    expect(f.send).toHaveBeenNthCalledWith(2, expect.objectContaining({ seq: 2, body: "", media: audio }));
  });
});
