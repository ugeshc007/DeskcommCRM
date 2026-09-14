"use server";

import { headers } from "next/headers";
import { z } from "zod";

import { audit } from "@/lib/audit";
import { requirePlatformAdmin } from "@/lib/auth/requirePlatformAdmin";
import { invalidateMetaAppSecret } from "@/lib/channels/meta/platform-secret";
import { createAdminClient } from "@/lib/supabase/admin";
import { encryptWebhookSecret } from "@/lib/webhooks/secrets";

const inputSchema = z.object({ app_secret: z.string().trim().min(16).max(300) });

export type UpdateMetaWebhookSecretResult =
  | { ok: true }
  | { ok: false; error: string };

export async function updateMetaWebhookSecret(
  input: unknown,
): Promise<UpdateMetaWebhookSecretResult> {
  const { user } = await requirePlatformAdmin();
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Digite um App Secret da Meta válido." };

  const admin = createAdminClient();
  const encrypted = await encryptWebhookSecret(admin, parsed.data.app_secret);
  if (!encrypted) {
    return { ok: false, error: "A cifragem não está disponível. O App Secret não foi salvo." };
  }

  const { error } = await admin.from("platform_meta_webhook").upsert(
    {
      id: 1,
      app_secret_encrypted: encrypted,
      updated_by: user.id,
    },
    { onConflict: "id" },
  );
  if (error) return { ok: false, error: "Não foi possível salvar o App Secret da Meta." };

  invalidateMetaAppSecret();
  const requestHeaders = await headers();
  await audit({
    action: "platform_meta_webhook.updated",
    actorUserId: user.id,
    resourceType: "platform_meta_webhook",
    resourceId: null,
    requestId: requestHeaders.get("x-request-id") ?? undefined,
    ip: requestHeaders.get("x-forwarded-for") ?? undefined,
    userAgent: requestHeaders.get("user-agent") ?? undefined,
    actingAsPlatformAdmin: true,
    metadata: { app_secret_replaced: true },
  });

  return { ok: true };
}
