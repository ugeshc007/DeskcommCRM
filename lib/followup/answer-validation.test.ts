import { describe, expect, it } from "vitest";
import { validateAnswer, type AnswerFormat } from "./answer-validation";
import { matchReplyConfigSchema, nodeBranches } from "./graph-schema";
import { createQuestionBlock, QUESTION_BLOCKS } from "./question-presets";
import { flowGraphSchema } from "./graph-schema";

describe("validated answers", () => {
  it("creates fresh connected presets, with validation and no implicit CRM write", () => {
    for (const preset of QUESTION_BLOCKS) {
      const graph = createQuestionBlock(preset.id, { prompt: "prompt", reply: "reply", edge: "edge" }, { x: 20, y: 30 })!;
      expect(flowGraphSchema.safeParse(graph).success).toBe(true);
      expect(graph.edges[0]).toMatchObject({ source: "prompt", target: "reply" });
      expect(graph.nodes[1]?.config).toMatchObject({ answer_format: preset.id, branches: [] });
      expect(graph.nodes[1]?.config).not.toHaveProperty("save_to");
      expect(graph.nodes[1]?.position.x).toBeGreaterThan(graph.nodes[0]!.position.x);
    }
    expect(createQuestionBlock("forged", { prompt: "p", reply: "r", edge: "e" }, { x: 0, y: 0 })).toBeNull();
  });
  it.each<[AnswerFormat, string, string]>([
    ["text", "  Hello  ", "Hello"], ["name", "نور", "نور"],
    ["name", "D'Arcy Smith", "D'Arcy Smith"], ["name", "李", "李"],
    ["email", " person@example.com ", "person@example.com"],
    ["number", "-12.50", "-12.50"], ["number", "0", "0"],
    ["phone", "+971 (50) 123-4567", "+971501234567"],
    ["date", "2028-02-29", "2028-02-29"],
  ])("normalizes %s without guessing locale", (format, raw, value) => {
    expect(validateAnswer(format, raw)).toEqual({ valid: true, value });
  });
  it.each<[AnswerFormat, string]>([
    ["text", " "], ["text", "x".repeat(2001)], ["text", "bad\u0000value"],
    ["name", "12345"], ["name", "Jane\nSmith"], ["name", "x".repeat(201)],
    ["email", "not an email"], ["email", "a@"],
    ["number", "1,000"], ["number", "1e3"], ["number", "Infinity"], ["number", "1".repeat(400)],
    ["phone", "0501234567"], ["phone", "+012345678"], ["phone", "+1234567890123456"],
    ["date", "2026-02-29"], ["date", "2026-04-31"], ["date", "17/09/2026"], ["date", "0000-01-01"],
  ])("rejects %s malformed input without returning its content", (format, raw) => {
    expect(validateAnswer(format, raw)).toEqual({ valid: false });
  });
  const legacy = { branches: [{ id: "accepted", label: "Accepted", op: "contains", pattern: "ok" }], grace_timeout_ms: 900000 };
  it("leaves legacy graphs byte-compatible and adds an output only when configured", () => {
    expect(matchReplyConfigSchema.parse(legacy)).toEqual(legacy);
    const config = matchReplyConfigSchema.parse({ ...legacy, answer_format: "email" });
    expect(nodeBranches({ type: "match_reply", config }).map((b) => b.id)).toContain("invalid_answer");
    expect(nodeBranches({ type: "match_reply", config: matchReplyConfigSchema.parse(legacy) }).map((b) => b.id)).not.toContain("invalid_answer");
  });
  it("rejects unknown formats and conflicting branch ids only for validated graphs", () => {
    expect(matchReplyConfigSchema.safeParse({ ...legacy, answer_format: "javascript" }).success).toBe(false);
    const collision = { ...legacy, branches: [{ ...legacy.branches[0], id: "invalid_answer" }] };
    expect(matchReplyConfigSchema.safeParse(collision).success).toBe(true);
    expect(matchReplyConfigSchema.safeParse({ ...collision, answer_format: "email" }).success).toBe(false);
  });
});
