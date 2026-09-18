import { describe, expect, it, vi } from "vitest";
import { Blob } from "node:buffer";
import { flowMediaAssetSchema, flowMediaConfigSchema, mediaSignatureMatches, ownsFlowMedia } from "@/lib/messaging/media/flow-media";
import { materializeFlowMedia } from "@/lib/messaging/media/materialize-flow-media";
import { flowMediaIsOwned } from "@/lib/followup/media-ownership";
import { validateFlowForPublish } from "@/lib/followup/validate-publish";
import { flowGraphSchema } from "@/lib/followup/graph-schema";
import { createFlowStarter } from "@/lib/followup/builder-library";
import { runFollowupTick, type AdminClient, type FollowupJobRequest } from "@/lib/followup/engine";
import type { EnrollmentRow } from "@/lib/followup/node-handlers";

const org = "11111111-1111-4111-8111-111111111111";
const flow = "22222222-2222-4222-8222-222222222222";
const other = "33333333-3333-4333-8333-333333333333";
const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const asset = { storage_path: `${org}/flow-media/${flow}/${other}.png`, kind: "image" as const, mime: "image/png" as const, size_bytes: 8, caption: "Product photo" };
function graph(assets = [asset]) {
  const value = createFlowStarter("welcome");
  const message = value.nodes.find((node) => node.type === "action")!;
  message.config = { mode: "media", media_kind: "image", multiple: true, assets };
  return value;
}
describe("private flow media contract", () => {
  it("enqueues media references and the pinned service boundary without invoking AI", async () => {
    const now = "2026-09-17T12:00:00Z";
    const boundary = { organization_id: org, contact_id: other, conversation_id: flow, service_revision: 1, demanda_id: null, demanda_revision: null };
    const enrollment: EnrollmentRow = { id: other, organization_id: org, pointer_id: flow, version_id: other,
      contact_id: other, conversation_id: flow, current_node_id: "action-2", status: "active",
      next_eval_at: now, claimed_until: null, attempts: 0, max_attempts: 5, last_error: null,
      steps_taken: 1, outcome: null, cancel_reason: null, started_at: now, completed_at: null,
      updated_at: now, service_boundary: boundary };
    const db: AdminClient = {
      claimDueEnrollments: vi.fn(async () => [enrollment]),
      loadFlowGraph: vi.fn(async () => graph()), loadLeadFacts: vi.fn(async () => ({ lead_stage: null, tags: [] })),
      loadEnrollmentEvents: vi.fn(async () => []), loadLastInboundBody: vi.fn(async () => null),
      insertEnrollmentEvent: vi.fn(async () => ({ inserted: true })), updateEnrollment: vi.fn(async () => {}),
      loadFlowPointerName: vi.fn(async () => "Fixture"), insertDeadInboxItem: vi.fn(async () => {}),
      persistirRespostaFollowup: vi.fn(async () => {}), assertServiceBoundary: vi.fn(async () => {}),
    };
    const enqueueJob = vi.fn<(job: FollowupJobRequest) => Promise<void>>(async () => {});
    const result = await runFollowupTick({ db, enqueueJob, clock: () => new Date(now) });
    expect(result.failed).toBe(0);
    expect(enqueueJob).toHaveBeenCalledWith(expect.objectContaining({ organization_id: org, contact_id: other,
      payload: expect.objectContaining({ purpose: "send_message", media_assets: [asset], service_boundary: boundary }) }));
    expect(enqueueJob.mock.calls[0]?.[0]).not.toHaveProperty("payload.prompt_hint");
    expect(db.loadEnrollmentEvents).toHaveBeenCalledWith(other, org);
  });
  it("allows a draft with no file but blocks its publication", () => {
    expect(flowGraphSchema.safeParse(graph([])).success).toBe(true);
    expect(validateFlowForPublish(graph([]))).toMatchObject({ ok: false, errors: [expect.objectContaining({ code: "media_missing" })] });
    expect(validateFlowForPublish(graph())).toEqual({ ok: true });
  });
  it("rejects foreign organizations, other flows, paths and URL references", () => {
    expect(ownsFlowMedia(asset.storage_path, org, flow)).toBe(true);
    expect(ownsFlowMedia(asset.storage_path, other, flow)).toBe(false);
    expect(flowMediaIsOwned(graph(), other, flow)).toBe(false);
    expect(flowMediaIsOwned(graph(), org, other)).toBe(false);
    expect(ownsFlowMedia(`${org}/flow-media/../${flow}/photo.png`, org)).toBe(false);
    expect(flowMediaAssetSchema.safeParse({ ...asset, storage_path: "https://example.com/photo.png" }).success).toBe(false);
  });
  it("checks media limits, kind, MIME, extension and album cardinality", () => {
    for (const patch of [{ size_bytes: 0 }, { size_bytes: 6 * 1024 * 1024 }, { kind: "video" }, { mime: "image/svg+xml" }, { caption: "x".repeat(1025) }]) {
      expect(flowMediaAssetSchema.safeParse({ ...asset, ...patch }).success).toBe(false);
    }
    expect(flowMediaConfigSchema.safeParse({ mode: "media", media_kind: "image", multiple: false, assets: [asset, asset] }).success).toBe(false);
    expect(flowMediaConfigSchema.safeParse({ mode: "media", media_kind: "image", multiple: true, assets: Array(11).fill(asset) }).success).toBe(false);
  });
  it("rejects HTML masquerading as media", () => {
    expect(mediaSignatureMatches(png, "image/png")).toBe(true);
    expect(mediaSignatureMatches(new TextEncoder().encode("<script>alert(1)</script>"), "image/png")).toBe(false);
    expect(mediaSignatureMatches(png, "image/jpeg")).toBe(false);
  });
  it("does not offer a plain media send after a 24-hour wait", () => {
    const value = graph();
    value.nodes.push({ id: "wait-9", type: "wait", label: "Wait", position: { x: 1, y: 1 }, config: { mode: "fixed", duration_ms: 86_400_000 } });
    value.edges[0]!.target = "wait-9";
    value.edges.push({ id: "edge-9", source: "wait-9", target: "action-2", priority: 0, condition: { type: "always" } });
    expect(validateFlowForPublish(value)).toMatchObject({ ok: false, errors: expect.arrayContaining([expect.objectContaining({ code: "long_wait_needs_template" })]) });
  });
});

describe("materialize media at the authorized conversation boundary", () => {
  function storage(found = true) {
    const query = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), maybeSingle: vi.fn(async () => ({ data: found ? { id: flow } : null, error: null })) };
    const bucket = { download: vi.fn(async () => ({ data: new Blob([png], { type: asset.mime }), error: null })), upload: vi.fn(async () => ({ error: null })) };
    const client = { from: vi.fn(() => query), storage: { from: vi.fn(() => bucket) } };
    return { query, bucket, client };
  }
  it("refuses a foreign asset before reading storage", async () => {
    const { client, bucket } = storage();
    await expect(materializeFlowMedia(client as never, { organizationId: other, conversationId: flow, messageId: other, asset })).rejects.toThrow("flow_media_not_owned");
    expect(bucket.download).not.toHaveBeenCalled();
  });
  it("refuses a missing/foreign conversation before reading storage", async () => {
    const { client, bucket, query } = storage(false);
    await expect(materializeFlowMedia(client as never, { organizationId: org, conversationId: flow, messageId: other, asset })).rejects.toThrow("flow_media_conversation_unavailable");
    expect(query.eq).toHaveBeenCalledWith("organization_id", org);
    expect(bucket.download).not.toHaveBeenCalled();
  });
  it("copies only verified bytes into a deterministic conversation-owned path", async () => {
    const { client, bucket } = storage();
    const path = await materializeFlowMedia(client as never, { organizationId: org, conversationId: flow, messageId: other, asset });
    expect(path).toBe(`${org}/${flow}/flow-${other}-${other}.png`);
    expect(bucket.upload).toHaveBeenCalledWith(path, png, { contentType: asset.mime, upsert: true });
  });
});
