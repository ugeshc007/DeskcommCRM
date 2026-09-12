import { ResetPasswordForm } from "@/components/auth/ResetPasswordForm";
import { createClient } from "@/lib/supabase/server";
import { normalizarIdioma } from "@/lib/i18n/idiomas";
import { traduzir } from "@/lib/i18n/dicionario";
import { metadataNoIdiomaDaInstalacao } from "@/lib/i18n/metadata";
import { env } from "@/lib/env";

export const generateMetadata = () => metadataNoIdiomaDaInstalacao("Nova senha");

export default async function ResetPasswordPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const idioma = normalizarIdioma(
    (user?.user_metadata?.locale as string | undefined) ?? env.APP_LOCALE,
  );
  const t = (texto: string) => traduzir(texto, idioma);

  return (
    <div className="space-y-6">
      <div className="space-y-1.5 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">{t("Definir nova senha")}</h1>
        <p className="text-sm text-muted-foreground">
          {t("Escolha uma nova senha para sua conta")}
        </p>
      </div>
      <ResetPasswordForm />
    </div>
  );
}
