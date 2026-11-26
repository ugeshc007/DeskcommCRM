import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";
import { audit } from "@/lib/audit";
import { FLOW_MEDIA_FORMATS, mediaSignatureMatches, ownsFlowMedia } from "@/lib/messaging/media/flow-media";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };
const MAX_UPLOAD_BODY_BYTES = 51 * 1024 * 1024;

/** Bound chunked bodies too: Content-Length is optional and cannot be trusted. */
async function boundedForm(req: NextRequest): Promise<FormData | "too_large" | null> {
  if (!req.body) return req.formData().catch(() => null);
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_UPLOAD_BODY_BYTES) {
        await reader.cancel().catch(() => {});
        return "too_large";
      }
      chunks.push(value);
    }
    const body = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
    return await new Response(body, { headers: { "content-type": req.headers.get("content-type") ?? "" } }).formData();
  } catch { return null; }
  finally { reader.releaseLock(); }
}

async function authorize(ctx: Ctx, role: "viewer" | "manager", requestId: string) {
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) return { response: fail("invalid_request", "Invalid flow ID.", 400, { requestId }) };
  const auth = await requireRole(role, { requestId, resource: "followup_flows" });
  if (!auth.ok) return { response: auth.response };
  const admin = createAdminClient();
  const { data, error } = await admin.from("followup_flow_pointers").select("id")
    .eq("id", id).eq("organization_id", auth.org.orgId).maybeSingle();
  if (error) return { response: fail("internal_error", "Unable to verify flow access.", 500, { requestId }) };
  if (!data) return { response: fail("not_found", "Flow not found.", 404, { requestId }) };
  return { id, auth, admin };
}

/** Private preview: authorize before signing. The URL never belongs in the graph. */
export async function GET(req: NextRequest, ctx: Ctx): Promise<Response> {
  const requestId = randomUUID();
  const access = await authorize(ctx, "viewer", requestId);
  if (access.response) return access.response;
  const path = req.nextUrl.searchParams.get("path") ?? "";
  if (!ownsFlowMedia(path, access.auth!.org.orgId, access.id))
    return fail("not_found", "File not found.", 404, { requestId });
  const { data, error } = await access.admin!.storage.from("whatsapp-media").createSignedUrl(path, 120);
  if (error || !data) return fail("not_found", "File unavailable. Upload it again.", 404, { requestId });
  return ok({ url: data.signedUrl }, { requestId, headers: { "Cache-Control": "private, no-store" } });
}

/** Upload does not publish, enroll a customer, or send a message. */
export async function POST(req: NextRequest, ctx: Ctx): Promise<Response> {
  const denied = await requireSupportWrite();
  if (denied) return denied;
  const requestId = randomUUID();
  const access = await authorize(ctx, "manager", requestId);
  if (access.response) return access.response;
  if (Number(req.headers.get("content-length") ?? 0) > MAX_UPLOAD_BODY_BYTES)
    return fail("payload_too_large", "The maximum upload size is 50 MB.", 413, { requestId });
  const form = await boundedForm(req);
  if (form === "too_large") return fail("payload_too_large", "The maximum upload size is 50 MB.", 413, { requestId });
  const file = form?.get("file");
  if (!(file instanceof File)) return fail("validation_failed", "Choose a file to upload.", 422, { requestId });
  const mime = file.type as keyof typeof FLOW_MEDIA_FORMATS;
  const format = Object.hasOwn(FLOW_MEDIA_FORMATS, mime) ? FLOW_MEDIA_FORMATS[mime] : undefined;
  if (!format) return fail("unsupported_media_type", "Use JPEG, PNG, MP4, MP3, OGG or PDF.", 415, { requestId });
  if (!file.size || file.size > format.max)
    return fail("validation_failed", `Choose a non-empty file up to ${format.max / 1024 / 1024} MB.`, 422, { requestId });
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!mediaSignatureMatches(bytes, mime))
    return fail("unsupported_media_type", "The file content does not match its format.", 415, { requestId });
  const assetId = randomUUID();
  const path = `${access.auth!.org.orgId}/flow-media/${access.id}/${assetId}.${format.ext}`;
  const { error } = await access.admin!.storage.from("whatsapp-media").upload(path, bytes, { contentType: mime, upsert: false });
  if (error) return fail("internal_error", "Upload failed. Please retry.", 500, { requestId });
  void audit({ action: "followup_flow.media_uploaded", actorUserId: access.auth!.user.id,
    organizationId: access.auth!.org.orgId, resourceType: "followup_flow_pointer", resourceId: access.id, requestId,
    metadata: { asset_id: assetId, mime, size_bytes: file.size } });
  return ok({ storage_path: path, kind: format.kind, mime, size_bytes: file.size, caption: "" }, { status: 201, requestId });
}
