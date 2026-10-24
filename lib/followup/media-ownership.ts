import type { FlowGraph } from "./graph-schema";
import { ownsFlowMedia } from "@/lib/messaging/media/flow-media";

/** Draft and publish boundaries both reject references outside this flow and organization. */
export function flowMediaIsOwned(graph: FlowGraph, orgId: string, flowId: string): boolean {
  return graph.nodes.every((node) => node.type !== "action" || node.config.mode !== "media"
    || node.config.assets.every((asset) => ownsFlowMedia(asset.storage_path, orgId, flowId)));
}
