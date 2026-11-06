import { z } from "zod";

/** Immutable private-storage references, never provider URLs or credentials. */
export const FLOW_MEDIA_FORMATS = {
  "image/jpeg": { kind: "image", ext: "jpg", max: 5 * 1024 * 1024 },
  "image/png": { kind: "image", ext: "png", max: 5 * 1024 * 1024 },
  "video/mp4": { kind: "video", ext: "mp4", max: 16 * 1024 * 1024 },
  "audio/mpeg": { kind: "audio", ext: "mp3", max: 16 * 1024 * 1024 },
  "audio/ogg": { kind: "audio", ext: "ogg", max: 16 * 1024 * 1024 },
  "application/pdf": { kind: "document", ext: "pdf", max: 50 * 1024 * 1024 },
} as const;
const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
export const flowMediaPathSchema = z.string().regex(new RegExp(`^${uuid}/flow-media/${uuid}/${uuid}\\.(jpg|png|mp4|mp3|ogg|pdf)$`));
export const flowMediaAssetSchema = z.strictObject({
  storage_path: flowMediaPathSchema,
  kind: z.enum(["image", "video", "audio", "document"]),
  mime: z.enum(["image/jpeg", "image/png", "video/mp4", "audio/mpeg", "audio/ogg", "application/pdf"]),
  size_bytes: z.number().int().positive(),
  caption: z.string().max(1024).default(""),
}).refine((asset) => {
  const format = FLOW_MEDIA_FORMATS[asset.mime];
  return asset.kind === format.kind && asset.size_bytes <= format.max && asset.storage_path.endsWith(`.${format.ext}`);
}, "Media type, extension or size is invalid.");
export const flowMediaConfigSchema = z.strictObject({
  mode: z.literal("media"),
  media_kind: z.enum(["image", "video", "audio", "document"]),
  multiple: z.boolean().default(false),
  assets: z.array(flowMediaAssetSchema).max(10),
}).refine((config) => config.assets.every((asset) => asset.kind === config.media_kind)
  && (config.multiple ? config.media_kind === "image" : config.assets.length <= 1),
"Choose files matching this block. Only image blocks support multiple files.");
export type FlowMediaConfig = z.infer<typeof flowMediaConfigSchema>;
export type FlowMediaAsset = z.infer<typeof flowMediaAssetSchema>;
export function ownsFlowMedia(path: string, orgId: string, flowId?: string): boolean {
  return flowMediaPathSchema.safeParse(path).success && path.startsWith(`${orgId}/flow-media/${flowId ? `${flowId}/` : ""}`);
}

/** Cheap content sniffing: reject mislabeled HTML/SVG; codec checks still belong to transport. */
export function mediaSignatureMatches(bytes: Uint8Array, mime: string): boolean {
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.slice(start, end));
  switch (mime) {
    case "image/jpeg": return bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
    case "image/png": return [137, 80, 78, 71, 13, 10, 26, 10].every((b, i) => bytes[i] === b);
    case "video/mp4": return ascii(4, 8) === "ftyp";
    case "audio/mpeg": return ascii(0, 3) === "ID3" || (bytes[0] === 255 && ((bytes[1] ?? 0) & 224) === 224);
    case "audio/ogg": return ascii(0, 4) === "OggS";
    case "application/pdf": return ascii(0, 5) === "%PDF-";
    default: return false;
  }
}
