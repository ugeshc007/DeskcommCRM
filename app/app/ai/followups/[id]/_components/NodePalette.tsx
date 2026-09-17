"use client";

import { Button } from "@/components/ui/button";
import { ChatCircle, Sparkle, FileText, HandWaving, ShoppingBag, CreditCard } from "@/lib/ui/icons";
import { cn } from "@/lib/utils";
import type { NodeType } from "@/lib/followup/graph-schema";
import { useT } from "@/hooks/i18n/useT";
import { NODE_VISUAL_LIST } from "./nodes/nodeVisuals";
import { FLOW_STARTERS, MESSAGE_BLOCKS, type FlowStarterId } from "@/lib/followup/builder-library";

const MESSAGE_ICONS = { text: ChatCircle, ai: Sparkle, template: FileText };
const STARTER_ICONS = { welcome: HandWaving, sales: ShoppingBag, payment: CreditCard };
// Override BOTH button height rules: desktop lg:h-9 otherwise clips multiline cards.
const libraryCardClass = "h-auto min-h-16 w-full shrink-0 items-start justify-start gap-3 rounded-lg p-3 text-left whitespace-normal lg:h-auto";

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
        "flex min-h-0 flex-col gap-2 overflow-x-hidden overflow-y-auto p-4 [&>section]:shrink-0 [&>h2]:shrink-0 [&>h3]:shrink-0 [&>p]:shrink-0",
        isMobile
          ? "h-full w-full"
          : "hidden w-72 shrink-0 border-r border-border bg-surface lg:flex",
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
          {MESSAGE_BLOCKS.map((block) => {
            const Icon = MESSAGE_ICONS[block.id as keyof typeof MESSAGE_ICONS];
            return (
            <Button
              key={block.id}
              type="button"
              variant="secondary"
              className={libraryCardClass}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData("application/x-followup-message-block", block.id);
                e.dataTransfer.effectAllowed = "move";
              }}
              onClick={() => onMessage(block.id)}
            >
              <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-accent-soft text-accent"><Icon size={18} aria-hidden /></span>
              <span className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="text-sm leading-5 font-medium">{t(block.title)}</span>
                <span className="text-xs leading-4 font-normal text-text-muted">{t(block.description)}</span>
              </span>
            </Button>
            );
          })}
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
            className="min-h-10 shrink-0 justify-start gap-3 rounded-md lg:h-10"
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
            {visual.type === "repeat" ? t("Repeat") : visual.type === "action" ? t("Action") : t(visual.paletteLabel)}
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
          {FLOW_STARTERS.map((starter) => {
            const Icon = STARTER_ICONS[starter.id];
            return (
            <Button
              key={starter.id}
              type="button"
              variant="secondary"
              disabled={!canUseStarter}
              className={libraryCardClass}
              onClick={() => onStarter(starter.id)}
            >
              <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-info-bg text-info-fg"><Icon size={18} aria-hidden /></span>
              <span className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="text-sm leading-5 font-medium">{t(starter.title)}</span>
                <span className="text-xs leading-4 font-normal text-text-muted">{t(starter.description)}</span>
              </span>
            </Button>
            );
          })}
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
