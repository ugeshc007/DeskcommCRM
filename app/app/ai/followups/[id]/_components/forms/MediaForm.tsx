"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CaretUp, CaretDown, Trash, UploadSimple, FileText } from "@/lib/ui/icons";
import { FLOW_MEDIA_FORMATS, flowMediaAssetSchema, type FlowMediaAsset, type FlowMediaConfig } from "@/lib/messaging/media/flow-media";
import { TIPOS_DE_MIDIA, FORMATOS_DE_MIDIA } from "@/lib/followup/vocabulario";

export function MediaPreview({ asset, flowId }: { asset: FlowMediaAsset; flowId: string }) {
  const [preview, setPreview] = useState<{ path: string; url?: string; error?: boolean } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/v1/ai/followup-flows/${flowId}/media?path=${encodeURIComponent(asset.storage_path)}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("preview_unavailable");
        const json = await response.json();
        if (typeof json.data?.url !== "string") throw new Error("preview_unavailable");
        if (!controller.signal.aborted) setPreview({ path: asset.storage_path, url: json.data.url });
      }).catch(() => { if (!controller.signal.aborted) setPreview({ path: asset.storage_path, error: true }); });
    return () => controller.abort();
  }, [flowId, asset.storage_path]);
  if (preview?.path !== asset.storage_path) return <p className="p-3 text-xs">Loading preview…</p>;
  if (!preview.url) return <p className="p-3 text-xs" role="status">Preview unavailable. Reopen this block to retry.</p>;
  if (asset.kind === "image") return <img src={preview.url} alt={asset.caption || "Uploaded image preview"} className="max-h-48 w-full rounded-md object-contain" />; // eslint-disable-line @next/next/no-img-element -- authenticated, short-lived storage URL
  if (asset.kind === "video") return <video src={preview.url} controls preload="metadata" className="max-h-48 w-full rounded-md" aria-label="Uploaded video preview" />;
  if (asset.kind === "audio") return <audio src={preview.url} controls preload="metadata" className="w-full" aria-label="Uploaded audio preview" />;
  return <a href={preview.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 p-3 text-sm underline"><FileText size={20} aria-hidden />Preview PDF</a>;
}

export function MediaForm({ flowId, config, onChange }: {
  flowId?: string; config: FlowMediaConfig; onChange: (config: FlowMediaConfig) => void;
}) {
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const upload = useRef<XMLHttpRequest | null>(null);
  useEffect(() => () => { upload.current?.abort(); }, []);
  const formats = Object.entries(FLOW_MEDIA_FORMATS).filter(([, format]) => format.kind === config.media_kind);
  const maxFiles = config.multiple ? 10 : 1;
  const updateAssets = (assets: FlowMediaAsset[]) => onChange({ ...config, assets });
  async function addFiles(files: File[]) {
    if (!flowId || progress !== null || files.length === 0) return;
    setError(null);
    if (files.length + config.assets.length > maxFiles) {
      setError(`This block accepts ${maxFiles} file${maxFiles > 1 ? "s" : ""}. Remove a file before adding more.`); return;
    }
    for (const file of files) {
      const format = formats.find(([mime]) => mime === file.type)?.[1];
      if (!format || !file.size || file.size > format.max) {
        setError("Unsupported format or size. Check the file limits below."); return;
      }
    }
    setProgress(0);
    const assets = [...config.assets];
    try {
      for (const [index, file] of files.entries()) {
        const asset = await new Promise<FlowMediaAsset>((resolve, reject) => {
          const xhr = new XMLHttpRequest(); upload.current = xhr;
          xhr.open("POST", `/api/v1/ai/followup-flows/${flowId}/media`);
          xhr.upload.onprogress = (event) => { if (event.lengthComputable) setProgress(Math.round((index + event.loaded / event.total) / files.length * 100)); };
          xhr.onerror = () => reject(new Error("Upload interrupted. Please retry."));
          xhr.onabort = () => reject(new Error("Upload cancelled."));
          xhr.onload = () => {
            try {
              if (xhr.status < 200 || xhr.status >= 300) throw new Error("Upload failed. Check your access, file format and size, then retry.");
              resolve(flowMediaAssetSchema.parse(JSON.parse(xhr.responseText).data));
            } catch { reject(new Error("Upload failed. Check your access, file format and size, then retry.")); }
          };
          const body = new FormData(); body.append("file", file); xhr.send(body);
        });
        assets.push(asset);
        updateAssets([...assets]); // preserve each successful upload if a later file fails
      }
    } catch (err) { setError(err instanceof Error ? err.message : "Upload failed."); }
    finally { upload.current = null; setProgress(null); }
  }
  function move(index: number, offset: number) {
    const assets = [...config.assets]; const other = index + offset;
    if (!assets[index] || !assets[other]) return;
    [assets[index], assets[other]] = [assets[other]!, assets[index]!]; updateAssets(assets);
  }
  return <section className="space-y-4" aria-label="Media settings">
    <div className="space-y-2 rounded-lg border border-dashed border-border p-3">
      <Label htmlFor="flow-media-upload" className="flex items-center gap-2"><UploadSimple size={18} aria-hidden />Upload {config.multiple ? "images" : TIPOS_DE_MIDIA[config.media_kind].toLowerCase()}</Label>
      <Input id="flow-media-upload" type="file" accept={formats.map(([mime]) => mime).join(",")} multiple={config.multiple}
        disabled={!flowId || progress !== null || config.assets.length >= maxFiles}
        onChange={(event) => { void addFiles(Array.from(event.target.files ?? [])); event.target.value = ""; }} />
      <p className="text-xs text-text-muted">{formats.map(([mime, format]) => `${FORMATOS_DE_MIDIA[mime as keyof typeof FORMATOS_DE_MIDIA]}: ${format.max / 1024 / 1024} MB`).join(" · ")}</p>
      {config.media_kind === "video" && <p className="text-xs text-text-muted">Use MP4 with H.264 video and AAC audio for WhatsApp.</p>}
      {config.media_kind === "audio" && <p className="text-xs text-text-muted">Use MP3 or OGG with Opus audio. Any accompanying text is sent separately.</p>}
      {progress !== null && <div role="status"><progress aria-label="Upload progress" value={progress} max={100} className="w-full" /><p className="text-xs">Uploading {progress}% — do not close this block.</p></div>}
      {error && <p role="alert" className="text-sm text-error-fg">{error}</p>}
    </div>
    {config.assets.map((asset, index) => <div key={asset.storage_path} className="space-y-2 rounded-lg border border-border p-3">
      <div className="flex items-center justify-between gap-2"><span className="text-xs font-medium">File {index + 1} · {(asset.size_bytes / 1024 / 1024).toFixed(2)} MB</span>
        <div className="flex gap-1">
          {config.multiple && <><Button size="icon" variant="ghost" aria-label={`Move file ${index + 1} up`} disabled={index === 0 || progress !== null} onClick={() => move(index, -1)}><CaretUp size={16} aria-hidden /></Button>
            <Button size="icon" variant="ghost" aria-label={`Move file ${index + 1} down`} disabled={index === config.assets.length - 1 || progress !== null} onClick={() => move(index, 1)}><CaretDown size={16} aria-hidden /></Button></>}
          <Button size="icon" variant="ghost" aria-label={`Remove file ${index + 1} from draft`} disabled={progress !== null} onClick={() => updateAssets(config.assets.filter((_, i) => i !== index))}><Trash size={16} aria-hidden /></Button>
        </div>
      </div>
      {flowId && <MediaPreview asset={asset} flowId={flowId} />}
      <Label htmlFor={`media-caption-${index}`}>{asset.kind === "audio" ? "Accompanying text (optional)" : "Caption (optional)"}</Label>
      <Textarea id={`media-caption-${index}`} maxLength={900} value={asset.caption} disabled={progress !== null}
        onChange={(event) => updateAssets(config.assets.map((item, i) => i === index ? { ...item, caption: event.target.value } : item))} />
    </div>)}
    {!config.assets.length && <p className="text-sm text-text-muted">No file uploaded. Upload a file before publishing.</p>}
    <p className="text-xs text-text-muted">Save the draft after uploading. Nothing is sent during editing. Multiple images are delivered in order as individual messages, not an interactive product carousel.</p>
    <p className="text-xs text-text-muted">Removing a file here only removes its draft reference. Published versions retain their files.</p>
  </section>;
}
