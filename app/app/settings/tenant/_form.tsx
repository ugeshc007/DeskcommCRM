"use client";
import { useState, useTransition } from "react";
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
import { updateTenant } from "@/app/actions/settings/updateTenant";
import { useT } from "@/hooks/i18n/useT";
import { MOEDAS_SERVIDAS, simboloDaMoeda, type MoedaServida } from "@/lib/money";
import { COUNTRY_OPTIONS, TIMEZONE_OPTIONS, countryForTimezone } from "@/lib/geography";
import { tenantSchema, type Locale, type TenantInput } from "@/lib/schemas/settings";

interface Props {
  initial: TenantInput;
}

export function TenantForm({ initial }: Props) {
  const t = useT();
  const [form, setForm] = useState<TenantInput>(initial);
  const [reasonsText, setReasonsText] = useState((initial.lost_reasons_extra ?? []).join(", "));
  const [isPending, startTransition] = useTransition();

  function set<K extends keyof TenantInput>(key: K, value: TenantInput[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const reasons = reasonsText
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    const candidate = { ...form, lost_reasons_extra: reasons };
    const parsed = tenantSchema.safeParse(candidate);
    if (!parsed.success) {
      toast.error(t("Dados inválidos."));
      return;
    }
    startTransition(async () => {
      const r = await updateTenant(parsed.data);
      if (r.ok) toast.success(t("Organização atualizada."));
      else toast.error(`${t("Erro")}: ${r.error}`);
    });
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-2xl">
      <Card className="space-y-4 p-6">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="display_name">{t("Nome de exibição")}</Label>
            <Input
              id="display_name"
              value={form.display_name}
              onChange={(e) => set("display_name", e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="legal_name">{t("Razão social")}</Label>
            <Input
              id="legal_name"
              value={form.legal_name}
              onChange={(e) => set("legal_name", e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="cnpj">{t("CNPJ")}</Label>
            <Input
              id="cnpj"
              value={form.cnpj ?? ""}
              onChange={(e) => set("cnpj", e.target.value || null)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="dpo_email">{t("DPO email")}</Label>
            <Input
              id="dpo_email"
              type="email"
              value={form.dpo_email ?? ""}
              onChange={(e) => set("dpo_email", e.target.value || null)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="country_code">{t("País ou região")}</Label>
            <select id="country_code" value={form.country_code ?? ""} onChange={(e) => {
              const country = e.target.value;
              setForm((current) => ({ ...current, country_code: country,
                timezone: countryForTimezone(current.timezone) === country ? current.timezone
                  : TIMEZONE_OPTIONS.find((zone) => zone.countryCode === country)?.id ?? current.timezone }));
            }} className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm lg:h-9" required>
              <option value="">{t("País ou região")}</option>
              {COUNTRY_OPTIONS.map((country) => <option key={country.code} value={country.code}>{country.name}</option>)}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="timezone">{t("Fuso horário")}</Label>
            <select id="timezone" value={form.timezone} onChange={(e) => set("timezone", e.target.value)}
              className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm lg:h-9">
              {!TIMEZONE_OPTIONS.some((zone) => zone.id === form.timezone) && <option value={form.timezone}>{form.timezone}</option>}
              {TIMEZONE_OPTIONS.filter((zone) => !form.country_code || zone.countryCode === form.country_code || zone.id === form.timezone)
                .map((zone) => <option key={zone.id} value={zone.id}>{zone.label}</option>)}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="locale">{t("Idioma")}</Label>
            <Select value={form.locale} onValueChange={(v) => set("locale", v as Locale)}>
              <SelectTrigger id="locale">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="pt-BR">Português (BR)</SelectItem>
                <SelectItem value="es">Español</SelectItem>
                <SelectItem value="en">English</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="currency">{t("Moeda")}</Label>
            <Select value={form.currency} onValueChange={(v) => set("currency", v as MoedaServida)}>
              <SelectTrigger id="currency">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MOEDAS_SERVIDAS.map((moeda) => (
                  <SelectItem key={moeda} value={moeda}>
                    {moeda} · {simboloDaMoeda(moeda)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {t(
                "Vale para todo preço do catálogo. Produto já cadastrado guarda a moeda com que nasceu.",
              )}
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="media_retention_days">{t("Retenção de mídia (dias)")}</Label>
            <Input
              id="media_retention_days"
              type="number"
              min={30}
              max={3650}
              value={form.media_retention_days}
              onChange={(e) => set("media_retention_days", Number(e.target.value))}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="privacy_policy_url">{t("URL política de privacidade")}</Label>
            <Input
              id="privacy_policy_url"
              type="url"
              value={form.privacy_policy_url ?? ""}
              onChange={(e) => set("privacy_policy_url", e.target.value || null)}
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="lost_reasons">
            {t("Motivos de perda extras (separados por vírgula)")}
          </Label>
          <Input
            id="lost_reasons"
            value={reasonsText}
            onChange={(e) => setReasonsText(e.target.value)}
            placeholder={t("ex: Sem orçamento, Concorrente")}
          />
          <p className="text-xs text-muted-foreground">
            {t("Adicionados ao set padrão. Cada pipeline pode ter seus próprios motivos.")}
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
