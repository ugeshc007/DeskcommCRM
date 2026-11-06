import { describe, expect, it } from "vitest";
import {
  createFlowStarter,
  FLOW_STARTERS,
  isFlowStarterId,
  MESSAGE_BLOCKS,
} from "@/lib/followup/builder-library";
import { flowGraphSchema, actionConfigSchema } from "@/lib/followup/graph-schema";
import { validateFlowForPublish } from "@/lib/followup/validate-publish";
import { fromReactFlow, toReactFlow } from "@/lib/followup/graph-mappers";

describe("visual builder library", () => {
  for (const starter of FLOW_STARTERS) {
    it(`${starter.id} is executable, connected and round-trips through the editor`, () => {
      const graph = createFlowStarter(starter.id);
      expect(flowGraphSchema.safeParse(graph).success).toBe(true);
      expect(validateFlowForPublish(graph)).toEqual({ ok: true });
      const rf = toReactFlow(graph);
      expect(fromReactFlow(rf.nodes, rf.edges)).toEqual(graph);
      expect(graph.nodes.filter((node) => node.type === "trigger")).toHaveLength(1);
    });
  }
  it("does not share mutable nodes between organizations or drafts", () => {
    const graph = createFlowStarter("welcome");
    graph.nodes[0]!.label = "Changed";
    expect(createFlowStarter("welcome").nodes[0]!.label).toBe("Start");
  });
  it("requires the operator to choose a real saved template", () => {
    for (const block of MESSAGE_BLOCKS) {
      expect(actionConfigSchema.safeParse(block.config).success).toBe(block.id !== "template");
    }
  });
  it("rejects unknown starter IDs", () => {
    expect(isFlowStarterId("sales")).toBe(true);
    expect(isFlowStarterId("__proto__")).toBe(false);
  });
  it("ends a product enquiry without a reply rather than sending an invented recommendation", () => {
    const graph = createFlowStarter("sales");
    const noReply = graph.edges.find(
      (edge) => edge.condition.type === "branch" && edge.condition.branch_id === "no_reply",
    );
    expect(graph.nodes.find((node) => node.id === noReply?.target)?.type).toBe("end");
  });
});
