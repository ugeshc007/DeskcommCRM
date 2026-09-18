import { describe, expect, it, vi } from "vitest";
import { aplicarRespostaInbound, runFollowupTick, type AdminClient } from "./engine";
import { type EnrollmentRow } from "./node-handlers";
import { flowGraphSchema, type FlowGraph, type FlowNode, nodeBranches } from "./graph-schema";
import { validateFlowForPublish } from "./validate-publish";
import type { AnswerFormat } from "./answer-validation";

const now = "2026-09-17T12:00:00.000Z";
function setup(format: AnswerFormat = "email") {
  const question: Extract<FlowNode, { type: "match_reply" }> = {
    id: "question", type: "match_reply", label: "Email", position: { x: 0, y: 0 },
    config: { branches: [{ id: "accepted", label: "Accepted", op: "contains", pattern: "ok" }],
      grace_timeout_ms: 900000, answer_format: format, save_to: { kind: "lead_custom", key: "email" } },
  };
  const graph: FlowGraph = { nodes: [
    { id: "start", type: "trigger", label: "Start", position: { x: 0, y: 0 }, config: {} }, question,
    ...["valid", "invalid", "timeout"].map((id): FlowNode => ({ id, type: "end", label: id, position: { x: 0, y: 0 }, config: { outcome: "custom" } })),
  ], edges: [
    { id: "start", source: "start", target: "question", condition: { type: "always" }, priority: 0 },
    ...nodeBranches(question).map((b) => ({ id: b.id, source: "question", target: b.id === "invalid_answer" ? "invalid" : b.id === "no_reply" ? "timeout" : "valid", condition: b.condition, priority: 0 })),
  ] };
  const enrollment: EnrollmentRow = { id: "enrollment", organization_id: "org-a", pointer_id: "flow", version_id: "version", contact_id: "contact", conversation_id: "conversation", current_node_id: "question", status: "waiting_reply", next_eval_at: now, claimed_until: null, attempts: 0, max_attempts: 5, last_error: null, steps_taken: 1, outcome: null, cancel_reason: null, started_at: now, completed_at: null, updated_at: now };
  const db: AdminClient = {
    claimDueEnrollments: vi.fn(async () => [enrollment]), loadFlowGraph: vi.fn(async () => graph),
    loadLeadFacts: vi.fn(async () => ({ lead_stage: null, tags: [] })),
    loadEnrollmentEvents: vi.fn(async () => [{ node_id: "question", idempotency_key: "question:0" }]),
    loadLastInboundBody: vi.fn(async () => null),
    insertEnrollmentEvent: vi.fn(async () => ({ inserted: true })), updateEnrollment: vi.fn(async () => {}),
    loadFlowPointerName: vi.fn(async () => "Test"), insertDeadInboxItem: vi.fn(async () => {}),
    persistirRespostaFollowup: vi.fn(async () => {}), assertServiceBoundary: vi.fn(async () => {}),
  };
  const deps = { db, enqueueJob: vi.fn(async () => {}), clock: () => new Date(now) };
  return { deps, db, graph, enrollment, question };
}

describe("validated question execution", () => {
  it("requires the invalid-answer output before publication", () => {
    const { graph } = setup();
    expect(flowGraphSchema.safeParse(graph).success).toBe(true);
    expect(validateFlowForPublish(graph)).toEqual({ ok: true });
    graph.edges = graph.edges.filter((e) => e.id !== "invalid_answer");
    expect(validateFlowForPublish(graph).ok).toBe(false);
  });
  it("routes invalid content without persisting it or putting it in an event", async () => {
    const { deps, db, enrollment } = setup();
    await aplicarRespostaInbound(deps, enrollment, "invalid private answer");
    expect(db.updateEnrollment).toHaveBeenCalledWith("enrollment", "org-a", expect.objectContaining({ current_node_id: "invalid" }));
    expect(db.persistirRespostaFollowup).not.toHaveBeenCalled();
    expect(JSON.stringify(vi.mocked(db.insertEnrollmentEvent).mock.calls)).not.toContain("invalid private answer");
  });
  it("saves a valid normalized answer only inside the enrollment organization", async () => {
    const { deps, db, enrollment } = setup("phone");
    await aplicarRespostaInbound(deps, enrollment, "+971 (50) 123-4567");
    expect(db.updateEnrollment).toHaveBeenCalledWith("enrollment", "org-a", expect.objectContaining({ current_node_id: "valid" }));
    expect(db.persistirRespostaFollowup).toHaveBeenCalledWith({ organization_id: "org-a", contact_id: "contact", save_to: { kind: "lead_custom", key: "email" }, value: "+971501234567" });
  });
  it("does not confuse silence with an invalid answer", async () => {
    const { deps, db } = setup();
    await runFollowupTick(deps);
    expect(db.updateEnrollment).toHaveBeenCalledWith("enrollment", "org-a", expect.objectContaining({ current_node_id: "timeout" }));
    expect(db.persistirRespostaFollowup).not.toHaveBeenCalled();
  });
  it("fails closed without an invalid edge, even if the valid fallback exists", async () => {
    const { deps, db, graph, enrollment } = setup();
    graph.edges = graph.edges.filter((e) => e.id !== "invalid_answer");
    await aplicarRespostaInbound(deps, enrollment, "bad");
    expect(db.persistirRespostaFollowup).not.toHaveBeenCalled();
    expect(db.updateEnrollment).toHaveBeenCalledWith("enrollment", "org-a", expect.objectContaining({ last_error: "invalid_answer_path_missing" }));
  });
  it("does not save twice on a replay", async () => {
    const { deps, db, enrollment } = setup();
    vi.mocked(db.insertEnrollmentEvent).mockResolvedValue({ inserted: false });
    await aplicarRespostaInbound(deps, enrollment, "person@example.com");
    expect(db.persistirRespostaFollowup).not.toHaveBeenCalled();
  });
  it("allows confirmation of an existing value without replacing it with yes", async () => {
    const { deps, db, enrollment, question } = setup();
    question.config.if_exists = "confirm";
    vi.mocked(db.loadLeadFacts).mockResolvedValue({ lead_stage: null, tags: [], custom_fields: { email: "person@example.com" } });
    await aplicarRespostaInbound(deps, enrollment, "yes");
    expect(db.updateEnrollment).toHaveBeenCalledWith("enrollment", "org-a", expect.objectContaining({ current_node_id: "valid" }));
    expect(db.persistirRespostaFollowup).not.toHaveBeenCalled();
  });
});
