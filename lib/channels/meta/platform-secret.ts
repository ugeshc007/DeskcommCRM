/** App Secret do webhook oficial desta INSTALAÇÃO: banco primeiro, env como rollback. */
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";
import { decryptWebhookSecret } from "@/lib/webhooks/secrets";

export type MetaAppSecretSource = "database" | "environment";

export interface ResolvedMetaAppSecret {
  value: string;
  source: MetaAppSecretSource;
}
interface Linha {
  app_secret_encrypted: string;
}

const TTL_MS = 30_000;

declare global {
  // eslint-disable-next-line no-var
  var __memoMetaAppSecret:
    | { readonly value: ResolvedMetaAppSecret | null; readonly expiresAt: number }
    | null
    | undefined;
}

function texto(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

export function invalidateMetaAppSecret(): void {
  globalThis.__memoMetaAppSecret = null;
}

export async function resolveMetaAppSecret(): Promise<ResolvedMetaAppSecret | null> {
  const memo = globalThis.__memoMetaAppSecret;
  if (memo && memo.expiresAt > Date.now()) return memo.value;

  try {
    const { data, error } = await createAdminClient()
      .from("platform_meta_webhook")
      .select("app_secret_encrypted")
      .eq("id", 1)
      .maybeSingle();

    if (!error && data) {
      const encrypted = texto((data as Linha).app_secret_encrypted);
      const decrypted = encrypted
        ? await decryptWebhookSecret(createAdminClient(), encrypted)
        : null;
      if (decrypted) {
        const value = { value: decrypted, source: "database" as const };
        globalThis.__memoMetaAppSecret = { value, expiresAt: Date.now() + TTL_MS };
        return value;
      }
      logger.warn("[channels.meta.config] App Secret do banco não decifrou; usando ambiente");
    } else if (error && error.code !== "42P01") {
      logger.warn("[channels.meta.config] leitura do App Secret falhou; usando ambiente", {
        code: error.code,
      });
    }
  } catch (error) {
    logger.warn("[channels.meta.config] leitura do App Secret falhou; usando ambiente", {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  const fromEnvironment = texto(env.META_APP_SECRET);
  const value = fromEnvironment
    ? { value: fromEnvironment, source: "environment" as const }
    : null;
  globalThis.__memoMetaAppSecret = { value, expiresAt: Date.now() + TTL_MS };
  return value;
}

export async function metaAppSecretState(): Promise<{
  configured: boolean;
  source: MetaAppSecretSource | null;
}> {
  const resolved = await resolveMetaAppSecret();
  return { configured: resolved !== null, source: resolved?.source ?? null };
}
