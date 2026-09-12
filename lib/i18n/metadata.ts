import type { Metadata } from "next";

import { env } from "@/lib/env";
import { traduzir } from "@/lib/i18n/dicionario";
import { normalizarIdioma } from "@/lib/i18n/idiomas";

/** Metadado das portas públicas, onde ainda não existe uma sessão para consultar. */
export function metadataNoIdiomaDaInstalacao(titulo: string): Metadata {
  return { title: traduzir(titulo, normalizarIdioma(env.APP_LOCALE)) };
}
