"use client";

import { useEffect, useState } from "react";
import { graphsEqual } from "@/lib/followup/graph-mappers";
import type { FlowGraph } from "@/lib/followup/graph-schema";

/** Keep only persisted graph data; selection and validation marks are not edits. */
export function useGraphHistory(graph: FlowGraph, paused: boolean, restore: (graph: FlowGraph) => void) {
  const [history, setHistory] = useState(() => ({ entries: [structuredClone(graph)], index: 0 }));
  useEffect(() => {
    if (paused) return;
    // Synchronizes React Flow's external node/edge state, once per settled edit.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHistory((current) => {
      if (graphsEqual(current.entries[current.index]!, graph)) return current;
      const entries = [...current.entries.slice(0, current.index + 1), structuredClone(graph)].slice(-100);
      return { entries, index: entries.length - 1 };
    });
  }, [graph, paused]);

  function move(delta: number) {
    const index = history.index + delta;
    if (paused || index < 0 || index >= history.entries.length) return;
    setHistory({ ...history, index });
    restore(structuredClone(history.entries[index]!));
  }
  return {
    canUndo: !paused && history.index > 0,
    canRedo: !paused && history.index < history.entries.length - 1,
    undo: () => move(-1), redo: () => move(1),
  };
}
