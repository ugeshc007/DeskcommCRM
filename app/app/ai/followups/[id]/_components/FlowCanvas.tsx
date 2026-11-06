"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useGraphHistory } from "@/hooks/followup/useGraphHistory";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  ConnectionLineType,
  addEdge,
  useNodesState,
  useEdgesState,
  useReactFlow,
  type Connection,
  type EdgeMouseHandler,
  type NodeMouseHandler,
  type NodeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { estimateNodeSize, layoutFlowGraph, LAYOUT_NODE_WIDTH } from "@/lib/followup/auto-layout";
import { semAresta, semArestasDoNo, semNo } from "@/lib/followup/excluir-do-grafo";
import {
  toReactFlow,
  fromReactFlow,
  graphsEqual,
  toFlowNode,
  type RFNode,
  type RFEdge,
  type RFNodeData,
} from "@/lib/followup/graph-mappers";
import { conditionLabel } from "@/lib/followup/edge-condition-options";
import { nextSequenceId } from "@/lib/followup/next-sequence-id";
import {
  branchIdForCondition,
  conditionForBranch,
  nodeBranches,
  type FlowEdge,
  type FlowGraph,
  type NodeType,
} from "@/lib/followup/graph-schema";
import { rotuloDoRamo } from "@/lib/followup/rotulo-do-ramo";
import { useFollowupFlow, type FollowupFlowDetailRow } from "@/hooks/followup/useFollowupFlow";
import { useT } from "@/hooks/i18n/useT";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Plus, X, ArrowBendUpLeft } from "@/lib/ui/icons";
import { NodeConfigPanel } from "./NodeConfigPanel";
import { EdgeConfigPanel } from "./EdgeConfigPanel";
import { NodePalette } from "./NodePalette";
import { CanvasDeleteControl } from "./CanvasDeleteControl";
import { PublishBar } from "./PublishBar";
import { FlowSimulator } from "./FlowSimulator";
import { NODE_VISUALS } from "./nodes/nodeVisuals";
import { TriggerNode } from "./nodes/TriggerNode";
import { WaitNode } from "./nodes/WaitNode";
import { ConditionNode } from "./nodes/ConditionNode";
import { ClassifyNode } from "./nodes/ClassifyNode";
import { MatchReplyNode } from "./nodes/MatchReplyNode";
import { RepeatNode } from "./nodes/RepeatNode";
import { ActionNode } from "./nodes/ActionNode";
import { EndNode } from "./nodes/EndNode";
import {
  createFlowStarter,
  FLOW_STARTERS,
  MESSAGE_BLOCKS,
  type FlowStarterId,
} from "@/lib/followup/builder-library";
import { createQuestionBlock } from "@/lib/followup/question-presets";
import { createChoiceReply, choiceBranches } from '@/lib/followup/choice-presets';
import { actionConfigSchema, matchReplyConfigSchema } from '@/lib/followup/graph-schema';

const EMPTY_GRAPH: FlowGraph = { nodes: [], edges: [] };
const DND_MIME = "application/x-followup-node-type";

// Defined outside the component — React Flow warns (and re-mounts nodes) if
// nodeTypes is a fresh object every render.
const nodeTypes: NodeTypes = {
  trigger: TriggerNode,
  wait: WaitNode,
  condition: ConditionNode,
  ai_classify: ClassifyNode,
  match_reply: MatchReplyNode,
  repeat: RepeatNode,
  action: ActionNode,
  end: EndNode,
};

interface Props {
  flowId: string;
  initialData: FollowupFlowDetailRow;
}

function FlowCanvasInner({ flowId, initialData }: Props) {
  const t = useT();
  const { data: flow } = useFollowupFlow(flowId, { initialData });
  // `initial` seeds React Flow state ONCE on mount — it must NOT react to
  // `flow` changing on every refetch (that would clobber in-progress edits).
  const initial = useMemo(
    () => toReactFlow(initialData.draft_graph ?? EMPTY_GRAPH),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const [nodes, setNodes, onNodesChange] = useNodesState<RFNode>(initial.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<RFEdge>(initial.edges);
  const [savedGraph, setSavedGraph] = useState<FlowGraph>(initialData.draft_graph ?? EMPTY_GRAPH);
  // Continue after the largest persisted suffix. Starting again at 1 makes a
  // newly-created node/edge reuse an existing React Flow key and visually
  // replace a connection in older drafts.
  const nextId = useRef(nextSequenceId(initial.nodes.map((node) => node.id)));
  const nextEdgeId = useRef(nextSequenceId(initial.edges.map((edge) => edge.id)));
  const { screenToFlowPosition, fitView } = useReactFlow();
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const liveGraph = useMemo(() => fromReactFlow(nodes, edges), [nodes, edges]);
  const dirty = useMemo(() => !graphsEqual(liveGraph, savedGraph), [liveGraph, savedGraph]);
  const restoreGraph = useCallback((graph: FlowGraph) => {
    const restored = toReactFlow(graph);
    setNodes(restored.nodes);
    setEdges(restored.edges);
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
    nextId.current = Math.max(nextId.current, nextSequenceId(graph.nodes.map((node) => node.id)));
    nextEdgeId.current = Math.max(nextEdgeId.current, nextSequenceId(graph.edges.map((edge) => edge.id)));
  }, [setNodes, setEdges]);
  const history = useGraphHistory(liveGraph, nodes.some((node) => node.dragging), restoreGraph);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    const guardLink = (event: MouseEvent) => {
      const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (link instanceof HTMLAnchorElement && link.target !== "_blank" && link.href !== window.location.href &&
          !window.confirm(t("You have unsaved changes. Leave without saving?"))) {
        event.preventDefault(); event.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", warn);
    document.addEventListener("click", guardLink, true);
    return () => { window.removeEventListener("beforeunload", warn); document.removeEventListener("click", guardLink, true); };
  }, [dirty, t]);

  const markNodeErrors = useCallback(
    (errorsByNode: Record<string, string[]>) => {
      setNodes((nds) =>
        nds.map((n) => ({ ...n, data: { ...n.data, errors: errorsByNode[n.id] } })),
      );
    },
    [setNodes],
  );
  const clearNodeErrors = useCallback(() => {
    setNodes((nds) =>
      nds.map((n) => (n.data.errors ? { ...n, data: { ...n.data, errors: undefined } } : n)),
    );
  }, [setNodes]);

  // Node and edge selection are mutually exclusive — opening one panel closes the other's.
  const onNodeClick = useCallback<NodeMouseHandler<RFNode>>((_, node) => {
    setSelectedNodeId(node.id);
    setSelectedEdgeId(null);
  }, []);
  const onEdgeClick = useCallback<EdgeMouseHandler<RFEdge>>((_, edge) => {
    setSelectedEdgeId(edge.id);
    setSelectedNodeId(null);
  }, []);
  const onPaneClick = useCallback(() => {
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
  }, []);

  const updateNodeData = useCallback(
    (id: string, patch: Partial<RFNodeData>) => {
      const action = actionConfigSchema.safeParse(patch.config);
      setNodes((nds) =>
        nds.map((n) => {
          if (n.id === id) return { ...n, data: { ...n.data, ...patch } };
          const reply = n.type === 'match_reply' ? matchReplyConfigSchema.safeParse(n.data.config) : null;
          if (action.success && action.data.mode === 'interactive' && reply?.success && reply.data.choice_source_node_id === id)
            return { ...n, data: { ...n.data, config: { ...reply.data, branches: choiceBranches(action.data.interactive) } } };
          return n;
        }),
      );
    },
    [setNodes],
  );
  const updateEdgeCondition = useCallback(
    (id: string, condition: FlowEdge["condition"]) => {
      setEdges((eds) =>
        eds.map((e) =>
          e.id === id ? { ...e, data: { priority: e.data?.priority ?? 0, condition } } : e,
        ),
      );
    },
    [setEdges],
  );

  const selectedNode = nodes.find((n) => n.id === selectedNodeId) ?? null;
  const selectedEdge = edges.find((e) => e.id === selectedEdgeId) ?? null;
  const selectedEdgeSource = selectedEdge
    ? (nodes.find((n) => n.id === selectedEdge.source) ?? null)
    : null;
  const selectedEdgeTarget = selectedEdge
    ? (nodes.find((n) => n.id === selectedEdge.target) ?? null)
    : null;

  // Wire label: derived at render time from `data.condition`, never persisted on the edge
  // itself — `condition` alone stays the source of truth the mapper round-trips.
  // Num nó que ramifica o texto vem do RAMO (o rótulo que o usuário leu na
  // bolinha de onde arrastou), não da condição crua: `conditionLabel` sozinho
  // mostraria o id do ramo, que não é palavra nenhuma para quem não programa.
  const edgesForRender = useMemo(
    () =>
      edges.map((e) => {
        const condition = e.data?.condition ?? { type: "always" as const };
        const source = nodes.find((n) => n.id === e.source);
        const branch = source
          ? nodeBranches(toFlowNode(source)).find(
              (b) => b.id === branchIdForCondition(toFlowNode(source), condition),
            )
          : undefined;
        return {
          ...e,
          type: "smoothstep" as const,
          label: branch ? t(rotuloDoRamo(branch)) : t(conditionLabel(condition)),
          selected: e.id === selectedEdgeId,
        };
      }),
    [edges, nodes, selectedEdgeId, t],
  );

  // Quais saídas do nó selecionado já têm aresta. Quem sabe isso é o canvas —
  // o formulário não vê o grafo, e sem esse dado ele trocaria o modo do nó
  // deixando ligações órfãs sem conseguir dizer quantas.
  const ramosLigadosDoSelecionado = useMemo(() => {
    if (!selectedNode) return [];
    const source = toFlowNode(selectedNode);
    return edges
      .filter((e) => e.source === selectedNode.id)
      .map((e) => branchIdForCondition(source, e.data?.condition ?? { type: "always" }))
      .filter((id): id is string => id !== null);
  }, [selectedNode, edges]);

  const onConnect = useCallback(
    (connection: Connection) => {
      // A bolinha de onde o usuário arrastou É a saída escolhida: o React Flow
      // devolve o id do ramo em `sourceHandle`. Antes a aresta nascia sempre
      // `always` e o usuário tinha que ir ao painel dizer de novo, de qual regra
      // ela saía — o que, com uma bolinha só, era impossível de expressar.
      const source = nodes.find((n) => n.id === connection.source);
      const fromBranch =
        source && connection.sourceHandle
          ? conditionForBranch(toFlowNode(source), connection.sourceHandle)
          : null;
      const newEdge: RFEdge = {
        id: `edge-${nextEdgeId.current++}`,
        source: connection.source,
        target: connection.target,
        sourceHandle: connection.sourceHandle,
        targetHandle: connection.targetHandle,
        data: { priority: 0, condition: fromBranch ?? { type: "always" } },
      };
      setEdges((eds) => addEdge(newEdge, eds));
    },
    [setEdges, nodes],
  );

  const addNodeAt = useCallback(
    (type: NodeType, position: { x: number; y: number }) => {
      const visual = NODE_VISUALS[type];
      const id = `${type}-${nextId.current++}`;
      const newNode: RFNode = {
        id,
        type,
        position,
        data: { label: t(visual.defaultLabel), config: visual.defaultConfig() },
      };
      setNodes((nds) => nds.concat(newNode));
      setSelectedNodeId(id);
      setSelectedEdgeId(null);
      setPaletteOpen(false);
      requestAnimationFrame(() => requestAnimationFrame(() => { void fitView({ nodes: [{ id }], padding: 0.5, maxZoom: 1, duration: 200 }); }));
    },
    [setNodes, t, fitView],
  );

  const onPaletteAdd = useCallback(
    (type: NodeType) => {
      const index = nodes.length;
      addNodeAt(type, { x: 80 + (index % 4) * 220, y: 80 + Math.floor(index / 4) * 150 });
    },
    [nodes.length, addNodeAt],
  );

  const addMessageBlock = useCallback(
    (id: string, position?: { x: number; y: number }) => {
      const block = MESSAGE_BLOCKS.find((item) => item.id === id);
      if (!block) return;
      const nodeId = `action-${nextId.current++}`;
      const bottom = Math.max(0, ...nodes.map(n => n.position.y + (n.measured?.height ?? 220)));
      const at = position ?? { x: 80, y: bottom + 80 };
      setNodes((current) =>
        current.concat({
          id: nodeId,
          type: "action",
          position: at,
          data: { label: block.title, config: structuredClone(block.config) },
        }),
      );
      if (block.config.mode === 'interactive') {
        const reply = toReactFlow(createChoiceReply(nodeId, `match_reply-${nextId.current++}`, `edge-${nextEdgeId.current++}`,
          block.config.interactive, { x: at.x + 380, y: at.y }));
        setNodes(current => current.concat(reply.nodes));
        setEdges(current => current.concat(reply.edges));
      }
      setSelectedNodeId(nodeId);
      setSelectedEdgeId(null);
      setPaletteOpen(false);
      requestAnimationFrame(() => requestAnimationFrame(() => { void fitView({ nodes: [{ id: nodeId }], padding: 0.5, maxZoom: 1, duration: 200 }); }));
    },
    [nodes, setNodes, setEdges, fitView],
  );

  const addQuestionBlock = useCallback((id: string, position?: { x: number; y: number }) => {
    const ids = { prompt: `action-${nextId.current++}`, reply: `match_reply-${nextId.current++}`, edge: `edge-${nextEdgeId.current++}` };
    const bottom = Math.max(0, ...nodes.map((node) => node.position.y + (node.measured?.height ?? 220)));
    const block = createQuestionBlock(id, ids, position ?? { x: 80, y: bottom + 80 });
    if (!block) return;
    const mapped = toReactFlow(block);
    setNodes((current) => current.concat(mapped.nodes));
    setEdges((current) => current.concat(mapped.edges));
    setSelectedNodeId(ids.reply);
    setSelectedEdgeId(null);
    setPaletteOpen(false);
    requestAnimationFrame(() => requestAnimationFrame(() => { void fitView({ nodes: mapped.nodes, padding: 0.5, maxZoom: 1, duration: 200 }); }));
  }, [nodes, setNodes, setEdges, fitView]);

  const applyStarter = useCallback(
    (id: FlowStarterId) => {
      if (nodes.length || edges.length) return;
      const graph = toReactFlow(createFlowStarter(id));
      setNodes(graph.nodes);
      setEdges(graph.edges);
      nextId.current = nextSequenceId(graph.nodes.map((node) => node.id));
      nextEdgeId.current = nextSequenceId(graph.edges.map((edge) => edge.id));
      setPaletteOpen(false);
      window.setTimeout(() => {
        void fitView({ padding: 0.2, duration: 200 });
      }, 0);
    },
    [nodes.length, edges.length, setNodes, setEdges, fitView],
  );

  const deleteNode = useCallback(
    (id: string) => {
      setNodes((nds) => semNo(nds, id));
      setEdges((eds) => semArestasDoNo(eds, id));
      setSelectedNodeId((cur) => (cur === id ? null : cur));
    },
    [setNodes, setEdges],
  );

  const deleteEdge = useCallback(
    (id: string) => {
      setEdges((eds) => semAresta(eds, id));
      setSelectedEdgeId((cur) => (cur === id ? null : cur));
    },
    [setEdges],
  );

  const onDeleteSelection = useCallback(() => setDeleteOpen(true), []);
  const duplicateSelected = () => {
    if (!selectedNode) return;
    const id = `${selectedNode.type}-${nextId.current++}`;
    const clone = structuredClone(toFlowNode(selectedNode));
    clone.id = id;
    clone.label = `${clone.label.slice(0, 53)} (copy)`;
    clone.position = { x: clone.position.x + 60, y: clone.position.y + 80 };
    setNodes((current) => [...current, ...toReactFlow({ nodes: [clone], edges: [] }).nodes]);
    setSelectedNodeId(id);
    requestAnimationFrame(() => requestAnimationFrame(() => { void fitView({ nodes: [{ id }], padding: 0.5, maxZoom: 1, duration: 200 }); }));
  };

  const onAutoFit = useCallback(() => {
    if (nodes.length === 0) return;
    const sizes = new Map<string, { width: number; height: number }>();
    for (const n of nodes) {
      sizes.set(n.id, {
        width: n.measured?.width ?? LAYOUT_NODE_WIDTH,
        height: n.measured?.height ?? estimateNodeSize(toFlowNode(n)).height,
      });
    }
    const laid = layoutFlowGraph(liveGraph, sizes);
    const pos = new Map(laid.nodes.map((n) => [n.id, n.position]));
    setNodes((nds) =>
      nds.map((n) => {
        const p = pos.get(n.id);
        return p ? { ...n, position: p } : n;
      }),
    );
    window.setTimeout(() => {
      void fitView({ padding: 0.2, duration: 200 });
    }, 0);
  }, [nodes, liveGraph, setNodes, fitView]);

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const messageBlock = e.dataTransfer.getData("application/x-followup-message-block");
      const questionBlock = e.dataTransfer.getData("application/x-followup-question-block");
      if (questionBlock) {
        addQuestionBlock(questionBlock, screenToFlowPosition({ x: e.clientX, y: e.clientY }));
        return;
      }
      if (messageBlock) {
        addMessageBlock(messageBlock, screenToFlowPosition({ x: e.clientX, y: e.clientY }));
        return;
      }
      const type = e.dataTransfer.getData(DND_MIME) as NodeType | "";
      if (!type || !Object.hasOwn(NODE_VISUALS, type)) return;
      const position = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      addNodeAt(type, position);
    },
    [screenToFlowPosition, addNodeAt, addMessageBlock, addQuestionBlock],
  );

  return (
    <div className="flex h-[calc(100dvh-160px)] min-h-[480px] w-full flex-col overflow-hidden">
      {flow && (
        <PublishBar
          flowId={flowId}
          flow={flow}
          graph={liveGraph}
          dirty={dirty}
          selection={selectedNode ? "node" : selectedEdge ? "edge" : null}
          onDeleteSelection={onDeleteSelection}
          onSaved={setSavedGraph}
          onPublishErrors={markNodeErrors}
          onPublishSuccess={clearNodeErrors}
          onAutoFit={onAutoFit}
          canAutoFit={nodes.length > 0}
        />
      )}
      <ol
        className="flex shrink-0 flex-wrap gap-x-6 gap-y-1 border-b border-border bg-surface px-4 py-2 text-xs text-text-muted"
        aria-label="Builder steps"
      >
        <li>1. {t("Choose blocks or a template")}</li>
        <li>2. {t("Connect and configure")}</li>
        <li>3. {t("Save, test, then publish")}</li>
      </ol>
      <div className="flex shrink-0 items-center gap-2 border-b border-border bg-surface px-4 py-2" aria-label="Workspace history">
        <Button type="button" size="sm" variant="secondary" disabled={!history.canUndo} onClick={history.undo}><ArrowBendUpLeft size={16} aria-hidden />{t("Undo")}</Button>
        <Button type="button" size="sm" variant="secondary" disabled={!history.canRedo} onClick={history.redo}><ArrowBendUpLeft size={16} className="-scale-x-100" aria-hidden />{t("Redo")}</Button>
        <span role="status" className="text-xs text-text-muted">{dirty ? t("Unsaved draft changes") : t("Draft is saved")}</span>
        <FlowSimulator graph={liveGraph} />
      </div>
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <NodePalette
          onAdd={onPaletteAdd}
          onMessage={addMessageBlock}
          onQuestion={addQuestionBlock}
          onStarter={applyStarter}
          canUseStarter={!nodes.length && !edges.length}
        />
        {/* Abaixo de `lg` a paleta fixa de 224px não cabe do lado do canvas —
            vira um drawer, disparado por este botão flutuante. */}
        <Sheet open={paletteOpen} onOpenChange={setPaletteOpen}>
          <SheetContent side="left" className="w-72 max-w-[85vw] gap-0 p-0 lg:hidden">
            <SheetTitle className="sr-only">{t("Adicionar nó")}</SheetTitle>
            <NodePalette
              variant="mobile"
              onMessage={addMessageBlock}
              onQuestion={addQuestionBlock}
              onStarter={applyStarter}
              canUseStarter={!nodes.length && !edges.length}
              onAdd={(type) => {
                onPaletteAdd(type);
                setPaletteOpen(false);
              }}
            />
          </SheetContent>
        </Sheet>

        <div
          className="relative h-full min-w-0 flex-1"
          data-testid="flow-canvas"
          onDragOver={onDragOver}
          onDrop={onDrop}
        >
          <ReactFlow
            nodes={nodes}
            edges={edgesForRender}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={onNodeClick}
            onEdgeClick={onEdgeClick}
            onPaneClick={onPaneClick}
            defaultEdgeOptions={{ type: "smoothstep" }}
            connectionLineType={ConnectionLineType.SmoothStep}
            deleteKeyCode={null}
            fitView
          >
            <Background />
            <Controls />
          </ReactFlow>
          {selectedNode ? (
            <CanvasDeleteControl
              key={`block-${selectedNode.id}`}
              kind="block"
              label={selectedNode.data.label || t("Block")}
              onDelete={() => deleteNode(selectedNode.id)}
              onDuplicate={duplicateSelected}
              open={deleteOpen}
              onOpenChange={setDeleteOpen}
            />
          ) : selectedEdge ? (
            <CanvasDeleteControl
              key={`connection-${selectedEdge.id}`}
              kind="connection"
              label={`${selectedEdgeSource?.data.label || t("Block")} → ${selectedEdgeTarget?.data.label || t("Block")}`}
              onDelete={() => deleteEdge(selectedEdge.id)}
              open={deleteOpen}
              onOpenChange={setDeleteOpen}
            />
          ) : null}
          {nodes.length === 0 && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6">
              <section className="pointer-events-auto max-h-full w-full max-w-xl overflow-y-auto rounded-xl border border-border bg-surface p-6 shadow-sm">
                <h2 className="text-xl font-semibold">{t("Build your first conversation")}</h2>
                <p className="mt-2 text-sm text-text-muted">
                  {t(
                    "Choose a starting point below, or drag a Trigger block from the library. Click any block to edit its message or rules.",
                  )}
                </p>
                <div className="mt-4 space-y-2">
                  {FLOW_STARTERS.map((starter) => (
                    <Button
                      type="button"
                      key={starter.id}
                      variant="secondary"
                      onClick={() => applyStarter(starter.id)}
                      className="h-auto w-full shrink-0 flex-col items-start gap-1 p-3 text-left whitespace-normal lg:h-auto"
                    >
                      <span>{t(starter.title)}</span>
                      <span className="text-xs font-normal text-text-muted">
                        {t(starter.steps)}
                      </span>
                    </Button>
                  ))}
                </div>
                <p className="mt-4 text-xs text-text-muted">
                  {t(
                    "Templates create an unsaved draft. Review your trigger, agent access and channel rules before publishing.",
                  )}
                </p>
              </section>
            </div>
          )}
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="absolute bottom-4 left-4 z-10 shadow-md lg:hidden"
            onClick={() => setPaletteOpen(true)}
          >
            <Plus size={14} aria-hidden /> {t("Adicionar nó")}
          </Button>
        </div>

        {/*
          Docked panel em telas grandes (`lg:`) — NÃO é overlay ali: o canvas
          continua clicável, então trocar de nó/aresta selecionado funciona com
          o painel aberto. Abaixo de `lg` os 384px (`w-96`) sozinhos já passavam
          da largura de QUALQUER celular, e como o pai é `overflow-hidden`, o
          painel não ganhava scroll — ficava certo, cortado, inacessível. Vira
          bottom sheet (`fixed`, ancorado embaixo, com teto de altura e X pra
          fechar) só nesse intervalo de tela.
        */}
        {selectedNode && (
          <aside
            className="fixed inset-x-0 bottom-0 z-40 flex max-h-[75vh] flex-col overflow-hidden rounded-t-lg border-t border-border bg-surface shadow-lg lg:static lg:z-auto lg:h-full lg:max-h-none lg:w-96 lg:shrink-0 lg:rounded-none lg:border-t-0 lg:border-l lg:shadow-none"
            data-testid="node-config-sheet"
          >
            {/* Barra própria pro X, não sobreposta ao conteúdo — um botão
                flutuante por cima do cabeçalho do painel colidiria com rótulo
                comprido (texto sobre texto). */}
            <div className="flex shrink-0 justify-end p-2 lg:hidden">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => setSelectedNodeId(null)}
                aria-label={t("Fechar")}
              >
                <X size={16} aria-hidden />
              </Button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 pt-0 lg:pt-4">
              <NodeConfigPanel
                key={selectedNode.id}
                flowId={flowId}
                node={selectedNode}
                onChange={(patch) => updateNodeData(selectedNode.id, patch)}
                onDelete={onDeleteSelection}
                ramosLigados={ramosLigadosDoSelecionado}
              />
            </div>
          </aside>
        )}

        {selectedEdge && (
          <aside
            className="fixed inset-x-0 bottom-0 z-40 flex max-h-[75vh] flex-col overflow-hidden rounded-t-lg border-t border-border bg-surface shadow-lg lg:static lg:z-auto lg:h-full lg:max-h-none lg:w-96 lg:shrink-0 lg:rounded-none lg:border-t-0 lg:border-l lg:shadow-none"
            data-testid="edge-config-sheet"
          >
            <div className="flex shrink-0 justify-end p-2 lg:hidden">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => setSelectedEdgeId(null)}
                aria-label={t("Fechar")}
              >
                <X size={16} aria-hidden />
              </Button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 pt-0 lg:pt-4">
              <EdgeConfigPanel
                key={selectedEdge.id}
                sourceNode={selectedEdgeSource ? toFlowNode(selectedEdgeSource) : undefined}
                targetNode={selectedEdgeTarget ? toFlowNode(selectedEdgeTarget) : undefined}
                condition={selectedEdge.data?.condition ?? { type: "always" }}
                onChange={(condition) => updateEdgeCondition(selectedEdge.id, condition)}
                onDelete={onDeleteSelection}
              />
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}

export function FlowCanvas(props: Props) {
  return (
    <ReactFlowProvider>
      <FlowCanvasInner {...props} />
    </ReactFlowProvider>
  );
}
