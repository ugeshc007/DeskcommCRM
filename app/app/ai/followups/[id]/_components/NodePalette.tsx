"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { PlugsConnected } from '@/lib/ui/icons';
import { Button } from "@/components/ui/button";
import { ChatCircle, Sparkle, FileText, HandWaving, ShoppingBag, CreditCard, ImageIcon, ImageSquare, MonitorPlay, MusicNote, EnvelopeSimple, Hash, Phone, CalendarBlank, UserCircle } from "@/lib/ui/icons";
import { cn } from "@/lib/utils";
import type { NodeType } from "@/lib/followup/graph-schema";
import { useT } from "@/hooks/i18n/useT";
import { NODE_VISUAL_LIST } from "./nodes/nodeVisuals";
import { FLOW_STARTERS, MESSAGE_BLOCKS, type FlowStarterId } from "@/lib/followup/builder-library";
import { QUESTION_BLOCKS } from "@/lib/followup/question-presets";

const MESSAGE_ICONS = { integration: PlugsConnected, variable: Hash, buttons: ChatCircle, list: FileText, text: ChatCircle, ai: Sparkle, template: FileText, image: ImageIcon, images: ImageSquare, video: MonitorPlay, audio: MusicNote, document: FileText };
const STARTER_ICONS = { 'store-enquiry': ShoppingBag, welcome: HandWaving, sales: ShoppingBag, payment: CreditCard };
const QUESTION_ICONS = { file: FileText, name: UserCircle, email: EnvelopeSimple, phone: Phone, number: Hash, date: CalendarBlank, text: ChatCircle };
// Override BOTH button height rules: desktop lg:h-9 otherwise clips multiline cards.
const libraryCardClass = "h-auto min-h-16 w-full shrink-0 items-start justify-start gap-3 rounded-lg p-3 text-left whitespace-normal lg:h-auto";

interface Props {
  onAdd: (type: NodeType) => void;
  onMessage?: (id: string) => void;
  onQuestion?: (id: string) => void;
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
  onQuestion,
  onStarter,
  canUseStarter = false,
  variant = "desktop",
}: Props) {
  const t = useT();
  const isMobile = variant === "mobile";
  const [search, setSearch] = useState("");
  const matches = (...values: string[]) => values.some((value) => t(value).toLowerCase().includes(search.trim().toLowerCase()));
  const messages = MESSAGE_BLOCKS.filter((block) => matches(block.title, block.description));
  const visuals = NODE_VISUAL_LIST.filter((visual) => matches(visual.type, visual.paletteLabel));
  const starters = FLOW_STARTERS.filter((starter) => matches(starter.title, starter.description));
  const questions = QUESTION_BLOCKS.filter((block) => matches(block.title, block.description));
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
      <Input type="search" aria-label={t("Search building blocks")} placeholder={t("Search by name or purpose")}
        value={search} onChange={(event) => setSearch(event.target.value)} className="shrink-0" />
      {!messages.length && !visuals.length && !starters.length && (!onQuestion || !questions.length) && <p role="status">{t("No matching blocks. Try another search.")}</p>}
      <p className="px-1 pb-3 text-xs text-text-muted">
        {t("Drag a block onto the canvas or click to add it. Connect the dots to set the order.")}
      </p>
      {onQuestion && questions.length > 0 && <section className="space-y-2 pb-3" aria-label={t("Question blocks")}>
        <h3 className="px-1 text-xs font-semibold text-text-muted">{t("QUESTIONS")}</h3>
        {questions.map((block) => { const Icon = QUESTION_ICONS[block.id]; return <Button key={block.id} type="button" variant="secondary" className={libraryCardClass}
          draggable onDragStart={(event) => { event.dataTransfer.setData("application/x-followup-question-block", block.id); event.dataTransfer.effectAllowed = "move"; }}
          onClick={() => onQuestion(block.id)}>
          <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-info-bg text-info-fg"><Icon size={18} aria-hidden /></span>
          <span className="flex min-w-0 flex-1 flex-col gap-1"><span className="text-sm leading-5 font-medium">{t(block.title)}</span>
            <span className="text-xs leading-4 font-normal text-text-muted">{t(block.description)}</span></span>
        </Button>; })}
      </section>}
      {onMessage && [
        { title: 'DATA & LOGIC', label: 'Data blocks', blocks: messages.filter(block => block.config.mode === 'set_variable') },
        { title: 'INTEGRATIONS', label: 'Integration blocks', blocks: messages.filter(block=>block.config.mode==='integration') },
        { title: "MESSAGES", label: "Message blocks", blocks: messages.filter((block) => block.config.mode !== "media" && block.config.mode !== 'set_variable' && block.config.mode !== 'integration') },
        { title: "MEDIA", label: "Media blocks", blocks: messages.filter((block) => block.config.mode === "media") },
      ].filter((group) => group.blocks.length > 0).map((group) => (
        <section key={group.title} className="space-y-2 pb-3" aria-label={group.label}>
          <h3 className="px-1 text-xs font-semibold text-text-muted">{t(group.title)}</h3>
          {group.blocks.map((block) => {
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
      ))}
      {visuals.length > 0 && <h3 className="px-1 text-xs font-semibold text-text-muted">{t("LOGIC & TIMING")}</h3>}
      {visuals.map((visual) => {
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
      {onStarter && starters.length > 0 && (
        <section className="mt-4 space-y-2 border-t border-border pt-3" aria-label="Flow templates">
          <h3 className="px-1 text-xs font-semibold text-text-muted">{t("READY-MADE FLOWS")}</h3>
          <p className="px-1 text-xs text-text-muted">
            {t(
              canUseStarter
                ? "Start with connected steps, then customize each block. Nothing is published automatically."
                : "Templates are available on an empty canvas, so your existing work is never replaced.",
            )}
          </p>
          {starters.map((starter) => {
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
          "Media uploads are private to your organization. Interactive product/catalogue blocks are planned separately.",
        )}
      </p>
    </aside>
  );
}
