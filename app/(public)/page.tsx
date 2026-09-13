import Link from "next/link";

import { Button } from "@/components/ui/button";
import { env } from "@/lib/env";
import { traduzir } from "@/lib/i18n/dicionario";
import { normalizarIdioma } from "@/lib/i18n/idiomas";
import { metadataNoIdiomaDaInstalacao } from "@/lib/i18n/metadata";

export const generateMetadata = () => metadataNoIdiomaDaInstalacao("Início");

/**
 * Porta pública da instalação SaaS.
 *
 * A raiz não decide o destino de uma sessão: ela apresenta as duas jornadas
 * que começam aqui. O login resolve o papel (plataforma ou tenant), enquanto o
 * cadastro cria a organização antes de encaminhar seu administrador para a
 * configuração guiada.
 */
export default function HomePage() {
  const idioma = normalizarIdioma(env.APP_LOCALE);
  const t = (texto: string) => traduzir(texto, idioma);

  return (
    <main className="space-y-6">
      <div className="space-y-2 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">
          {t("Atendimento, vendas e IA em um só lugar")}
        </h1>
        <p className="text-sm leading-6 text-muted-foreground">
          {t("Entre para continuar ou crie uma organização para começar.")}
        </p>
      </div>

      <div className="grid gap-3">
        <Button asChild size="lg">
          <Link href="/signup">{t("Criar organização")}</Link>
        </Button>
        <Button asChild size="lg" variant="outline">
          <Link href="/login">{t("Entrar")}</Link>
        </Button>
      </div>

      <p className="text-center text-xs leading-5 text-muted-foreground">
        {t("Depois do cadastro, você configura sua organização passo a passo.")}
      </p>
    </main>
  );
}
