import type { SupabaseClient } from "@supabase/supabase-js";
import { flowMediaAssetSchema, ownsFlowMedia, mediaSignatureMatches, type FlowMediaAsset } from "./flow-media";

/** Reuse the canonical conversation send path; never relax its storage ownership guard. */
export async function materializeFlowMedia(admin: SupabaseClient, input: {
  organizationId: string; conversationId: string; messageId: string; asset: FlowMediaAsset;
}): Promise<string> {
  const asset = flowMediaAssetSchema.parse(input.asset);
  if (!ownsFlowMedia(asset.storage_path, input.organizationId)) throw new Error("flow_media_not_owned");
  const { data: conversation, error: lookupError } = await admin.from("conversations").select("id")
    .eq("id", input.conversationId).eq("organization_id", input.organizationId).maybeSingle();
  if (lookupError || !conversation) throw new Error("flow_media_conversation_unavailable");
  const bucket = admin.storage.from("whatsapp-media");
  const { data, error } = await bucket.download(asset.storage_path);
  if (error || !data || data.size !== asset.size_bytes) throw new Error("flow_media_unavailable");
  const bytes = new Uint8Array(await data.arrayBuffer());
  if (!mediaSignatureMatches(bytes, asset.mime)) throw new Error("flow_media_invalid_content");
  const filename = asset.storage_path.split("/").at(-1)!;
  const path = `${input.organizationId}/${input.conversationId}/flow-${input.messageId}-${filename}`;
  // Destination belongs only to this immutable send intent. Retrying writes the same bytes.
  const { error: uploadError } = await bucket.upload(path, bytes, { contentType: asset.mime, upsert: true });
  if (uploadError) throw new Error("flow_media_prepare_failed");
  return path;
}
