"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { updateProfile } from "@/app/actions/settings/updateProfile";
import { useT } from "@/hooks/i18n/useT";
import { profileSchema, SEM_PREFERENCIA_DE_IDIOMA, type Locale } from "@/lib/schemas/settings";
import { TIMEZONE_OPTIONS, canonicalTimezone } from "@/lib/geography";

interface Props {
  email: string;
  initialFullName: string | null;
  initialAvatarUrl: string | null;
  initialLocale: Locale | typeof SEM_PREFERENCIA_DE_IDIOMA;
  initialTimezone: string;
}

export function ProfileForm({
  email,
  initialFullName,
  initialAvatarUrl,
  initialLocale,
  initialTimezone,
}: Props) {
  const t = useT();
  const router = useRouter();
  const [fullName, setFullName] = useState(initialFullName ?? "");
  const [locale, setLocale] = useState<Locale | typeof SEM_PREFERENCIA_DE_IDIOMA>(initialLocale);
  const [timezone, setTimezone] = useState(canonicalTimezone(initialTimezone));
  const [avatarUrl, setAvatarUrl] = useState(initialAvatarUrl ?? "");
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = profileSchema.safeParse({
      full_name: fullName || null,
      locale,
      timezone,
      avatar_url: avatarUrl || null,
    });
    if (!parsed.success) {
      toast.error(t("Dados inválidos."));
      return;
    }
    startTransition(async () => {
      const r = await updateProfile(parsed.data);
      if (r.ok) {
        toast.success(t("Perfil atualizado."));
        router.push("/app/inbox");
        router.refresh();
      } else {
        toast.error(`${t("Erro")}: ${r.error}`);
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-xl">
      <Card className="space-y-4 p-6">
        <div className="space-y-2">
          <Label htmlFor="email">{t("Email")}</Label>
          <Input id="email" value={email} disabled />
          <p className="text-xs text-muted-foreground">{t("Trocar email — em breve.")}</p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="full_name">{t("Nome completo")}</Label>
          <Input
            id="full_name"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            maxLength={120}
          />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="locale">{t("Idioma")}</Label>
            <Select value={locale} onValueChange={(v) => setLocale(v as Locale)}>
              <SelectTrigger id="locale">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={SEM_PREFERENCIA_DE_IDIOMA}>
                  {t("Seguir o idioma da empresa")}
                </SelectItem>
                <SelectItem value="pt-BR">Português (BR)</SelectItem>
                {/* Cada idioma entra quando passa a MUDAR alguma coisa. Enquanto
                    o campo era guardado e ninguém o lia, oferecer um idioma a
                    mais era prometer o que a tela não cumpre — e o operador
                    conclui que o sistema está quebrado. */}
                <SelectItem value="es">Español</SelectItem>
                <SelectItem value="en">English</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="timezone">{t("Fuso horário")}</Label>
            <select
              id="timezone"
              value={timezone}
              onChange={(event) => setTimezone(event.target.value)}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              {TIMEZONE_OPTIONS.map((zone) => (
                <option key={zone.id} value={zone.id}>{zone.label}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="avatar_url">{t("Avatar URL")}</Label>
          <Input
            id="avatar_url"
            type="url"
            placeholder="https://…"
            value={avatarUrl}
            onChange={(e) => setAvatarUrl(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            {t("Upload de arquivo — em breve. Cole uma URL pública.")}
          </p>
        </div>
        <div className="flex sm:justify-end">
          <Button type="submit" disabled={isPending} className="w-full sm:w-auto">
            {isPending ? t("Salvando…") : t("Salvar")}
          </Button>
        </div>
      </Card>
    </form>
  );
}
