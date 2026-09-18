"use client";

import type { NodeProps } from "@xyflow/react";

import type { RFNode } from "@/lib/followup/graph-mappers";
import { useT } from "@/hooks/i18n/useT";
import { NODE_VISUALS, describeNodeConfig } from "./nodeVisuals";
import { NodeCard } from "./NodeCard";
import type { FlowNode } from "@/lib/followup/graph-schema";
import { nodeBranches } from "@/lib/followup/graph-schema";
import { MediaPreview } from "../forms/MediaForm";
import { ImageIcon, MonitorPlay, MusicNote, FileText, PlugsConnected } from "@/lib/ui/icons";

export function ActionNode({ id, data, selected }: NodeProps<RFNode>) {
  const t = useT();
  const config = data.config as Extract<FlowNode, { type: "action" }>["config"];
  const media = config.mode === "media" ? config : null;
  const icons = { image: ImageIcon, video: MonitorPlay, audio: MusicNote, document: FileText };
  return (
    <NodeCard
      id={id}
      visual={media ? { ...NODE_VISUALS.action, icon: icons[media.media_kind] } : config.mode==='integration' ? {...NODE_VISUALS.action,icon:PlugsConnected} : NODE_VISUALS.action}
      label={data.label}
      subtitle={describeNodeConfig("action", data.config, t)}
      selected={selected}
      errors={data.errors}
      branches={config.mode==='integration'?nodeBranches({type:'action',config}):undefined}
    >
      {media?.assets[0] && <MediaPreview asset={media.assets[0]} flowId={media.assets[0].storage_path.split("/")[2]!} />}
      {media && media.assets.length > 1 && <p className="pt-2 text-xs text-text-muted">+{media.assets.length - 1} more images · sent in order</p>}
      {config.mode === "text" && <p className="line-clamp-4 rounded-md bg-accent-soft p-2 text-xs whitespace-pre-wrap break-words">{config.body}</p>}
      {config.mode === 'interactive' && <div className="space-y-1 text-xs">
        <p className="line-clamp-3 whitespace-pre-wrap break-words">{config.body}</p>
        {(config.interactive.kind === 'buttons' ? config.interactive.choices : config.interactive.sections.flatMap(s => s.rows)).map(choice =>
          <div key={choice.id} className="rounded-md border border-border bg-accent-soft px-2 py-1 text-center">{choice.title}</div>)}
      </div>}
    </NodeCard>
  );
}
