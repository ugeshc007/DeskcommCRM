"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { NodeType } from "@/lib/followup/graph-schema";
import { useT } from "@/hooks/i18n/useT";
import { NODE_VISUAL_LIST } from "./nodes/nodeVisuals";
import { FLOW_STARTERS, MESSAGE_BLOCKS, type FlowStarterId } from "@/lib/followup/builder-library";

interface Props {
  onAdd: (type: NodeType) => void;
  onMessage?: (id: string) => void;
  onStarter?: (id: FlowStarterId) => void;
  canUseStarter?: boolean;
  /** "mobile" = mesmo conteúdo dentro do Sheet que `FlowCanvas` abre abaixo de
   * `lg` — a barra fixa de 224px não cabia perto do canvas num celular. */
  variant?: "desktop" | "mobile";
}

/** Sidebar palette — click to add. Native HTML5 drag-and-drop wired in FlowCanvas (increment 3). */
export function NodePalette({
  onAdd,
  onMessage,
  onStarter,
  canUseStarter = false,
  variant = "desktop",
}: Props) {
  const t = useT();
  const isMobile = variant === "mobile";
  return (
    <aside
      className={cn(
        "flex flex-col gap-1.5 overflow-y-auto p-3",
        isMobile
          ? "h-full w-full"
          : "hidden w-64 shrink-0 border-r border-border bg-surface lg:flex",
      )}
      data-testid="node-palette"
    >
      <h2 className="px-1 pb-1 text-xs font-medium tracking-wide text-text-muted uppercase">
        {t("Build your conversation")}
      </h2>
      <p className="px-1 pb-3 text-xs text-text-muted">
        {t("Drag a block onto the canvas or click to add it. Connect the dots to set the order.")}
      </p>
      {onMessage && (
        <section className="space-y-2 pb-3" aria-label="Message blocks">
          <h3 className="px-1 text-xs font-semibold text-text-muted">{t("MESSAGES")}</h3>
          {MESSAGE_BLOCKS.map((block) => (
            <Button
              key={block.id}
              type="button"
              variant="secondary"
              className="h-auto w-full flex-col items-start gap-1 p-3 text-left whitespace-normal"
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData("application/x-followup-message-block", block.id);
                e.dataTransfer.effectAllowed = "move";
              }}
              onClick={() => onMessage(block.id)}
            >
              <span className="text-sm font-medium">{t(block.title)}</span>
              <span className="text-xs font-normal text-text-muted">{t(block.description)}</span>
            </Button>
          ))}
        </section>
      )}
      <h3 className="px-1 text-xs font-semibold text-text-muted">{t("LOGIC & TIMING")}</h3>
      {NODE_VISUAL_LIST.map((visual) => {
        const Icon = visual.icon;
        return (
          <Button
            key={visual.type}
            type="button"
            variant="secondary"
            size="sm"
            className="justify-start gap-2"
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData("application/x-followup-node-type", visual.type);
              e.dataTransfer.effectAllowed = "move";
            }}
            onClick={() => onAdd(visual.type)}
            data-testid={`palette-add-${visual.type}`}
          >
            <span
              className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${visual.chipClassName}`}
            >
              <Icon size={14} aria-hidden />
            </span>
            {t(visual.paletteLabel)}
          </Button>
        );
      })}
      {onStarter && (
        <section className="mt-4 space-y-2 border-t border-border pt-3" aria-label="Flow templates">
          <h3 className="px-1 text-xs font-semibold text-text-muted">{t("READY-MADE FLOWS")}</h3>
          <p className="px-1 text-xs text-text-muted">
            {t(
              canUseStarter
                ? "Start with connected steps, then customize each block. Nothing is published automatically."
                : "Templates are available on an empty canvas, so your existing work is never replaced.",
            )}
          </p>
          {FLOW_STARTERS.map((starter) => (
            <Button
              key={starter.id}
              type="button"
              variant="secondary"
              disabled={!canUseStarter}
              className="h-auto w-full flex-col items-start gap-1 p-3 text-left whitespace-normal"
              onClick={() => onStarter(starter.id)}
            >
              <span>{t(starter.title)}</span>
              <span className="text-xs font-normal text-text-muted">{t(starter.description)}</span>
            </Button>
          ))}
        </section>
      )}
      <p className="mt-3 rounded-md border border-border p-2 text-xs text-text-muted">
        {t(
          "Image, video, audio and interactive product blocks are not yet supported by this flow engine.",
        )}
      </p>
    </aside>
  );
}
