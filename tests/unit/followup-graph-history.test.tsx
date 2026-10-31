import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useGraphHistory } from "@/hooks/followup/useGraphHistory";
import type { FlowGraph } from "@/lib/followup/graph-schema";

const empty: FlowGraph = { nodes: [], edges: [] };
const added: FlowGraph = { nodes: [{ id: "start", type: "trigger", label: "Start", position: { x: 0, y: 0 }, config: {} }], edges: [] };
describe("workspace history", () => {
  it("restores additions and connections together, and clears redo on a new edit", () => {
    const restore = vi.fn();
    const { result, rerender } = renderHook(({ graph }) => useGraphHistory(graph, false, restore), { initialProps: { graph: empty } });
    expect(result.current.canUndo).toBe(false);
    rerender({ graph: added });
    act(() => result.current.undo());
    expect(restore).toHaveBeenLastCalledWith(empty);
    rerender({ graph: empty });
    expect(result.current.canRedo).toBe(true);
    act(() => result.current.redo());
    expect(restore).toHaveBeenLastCalledWith(added);
    rerender({ graph: added });
    act(() => result.current.undo());
    rerender({ graph: empty });
    rerender({ graph: { ...added, nodes: [{ ...added.nodes[0]!, label: "Different" }] } });
    expect(result.current.canRedo).toBe(false);
  });

  it("groups an entire drag into one history entry", () => {
    const restore = vi.fn();
    const { result, rerender } = renderHook(({ graph, paused }) => useGraphHistory(graph, paused, restore), { initialProps: { graph: added, paused: false } });
    const moved = { ...added, nodes: [{ ...added.nodes[0]!, position: { x: 80, y: 90 } }] };
    rerender({ graph: moved, paused: true });
    expect(result.current.canUndo).toBe(false);
    rerender({ graph: moved, paused: false });
    act(() => result.current.undo());
    expect(restore).toHaveBeenLastCalledWith(added);
  });
});
