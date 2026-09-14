"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { useT } from "@/hooks/i18n/useT";

import { acceptWelcome } from "@/app/actions/onboarding/acceptWelcome";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  COUNTRY_OPTIONS,
  TIMEZONE_OPTIONS,
  canonicalTimezone,
  countryForTimezone,
  suggestedCurrency,
} from "@/lib/geography";
import { MOEDAS_SERVIDAS, simboloDaMoeda, type MoedaServida } from "@/lib/money";

interface WelcomeFormProps {
  defaultOrgName: string;
  defaultCountry?: string | null;
  defaultTimezone: string;
  defaultCurrency: MoedaServida;
}

export function WelcomeForm({
  defaultOrgName,
  defaultCountry,
  defaultTimezone,
  defaultCurrency,
}: WelcomeFormProps) {
  const t = useT();
  const [displayName, setDisplayName] = useState(defaultOrgName);
  const [oQueFaz, setOQueFaz] = useState("");
  const [country, setCountry] = useState(
    defaultCountry ?? countryForTimezone(defaultTimezone) ?? "US",
  );
  const [timezone, setTimezone] = useState(canonicalTimezone(defaultTimezone));
  const [currency, setCurrency] = useState<MoedaServida>(defaultCurrency);
  const [accepted, setAccepted] = useState(false);
  const [pending, startTransition] = useTransition();

  const timezones = useMemo(() => {
    const filtered = TIMEZONE_OPTIONS.filter((zone) => zone.countryCode === country);
    return filtered.length > 0 ? filtered : TIMEZONE_OPTIONS.filter((zone) => zone.id === "UTC");
  }, [country]);

  useEffect(() => {
    if (defaultCountry) return;
    const timer = window.setTimeout(() => {
      const browserTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const detectedCountry = countryForTimezone(browserTimezone);
      if (!detectedCountry) return;
      setCountry(detectedCountry);
      setTimezone(canonicalTimezone(browserTimezone));
      setCurrency(suggestedCurrency(detectedCountry));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [defaultCountry]);

  function changeCountry(nextCountry: string) {
    setCountry(nextCountry);
    const firstZone = TIMEZONE_OPTIONS.find((zone) => zone.countryCode === nextCountry);
    if (firstZone) setTimezone(firstZone.id);
    setCurrency(suggestedCurrency(nextCountry));
  }

  return (
    <form
      className="space-y-5 rounded-lg border bg-background p-6"
      action={(formData) => {
        if (!accepted) {
          toast.error(t("Aceite os termos para continuar."));
          return;
        }
        startTransition(async () => {
          const res = await acceptWelcome(formData);
          if (res && !res.ok) {
            toast.error(`${t("Erro")}: ${res.error}`);
          }
        });
      }}
    >
      <div className="space-y-2">
        <Label htmlFor="display_name">{t("Como se chama o seu negócio?")}</Label>
        <Input
          id="display_name"
          name="display_name"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          minLength={2}
          maxLength={120}
          required
        />
        <p className="text-xs text-muted-foreground">
          {t("É o nome que aparece para o seu time e nos relatórios. Pode ser clínica, loja, escritório — o que for seu.")}
        </p>
      </div>

      {/*
        A pergunta que faltava no produto inteiro. Sem ela, o funcionário nasce
        se apresentando como atendente de uma "loja online" — era o que os três
        modelos de prompt diziam — e o quadro de clientes nasce com as colunas
        de e-commerce que o gatilho semeia. Os dois defeitos têm a mesma origem:
        uma instalação que nunca pergunta em que ramo entrou.
      */}
      <div className="space-y-2">
        <Label htmlFor="o_que_faz">{t("O que vocês fazem?")}</Label>
        <Input
          id="o_que_faz"
          name="o_que_faz"
          value={oQueFaz}
          onChange={(e) => setOQueFaz(e.target.value)}
          maxLength={280}
          placeholder={t("Ex.: clínica odontológica, ou venda de roupa fitness pelo WhatsApp")}
        />
        <p className="text-xs text-muted-foreground">
          {t(
            "Uma linha basta. É com isso que seu funcionário aprende com quem ele está falando — e que a gente monta o quadro de clientes do seu jeito.",
          )}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="country_code">{t("País ou região")}</Label>
          <select
            id="country_code"
            name="country_code"
            value={country}
            onChange={(event) => changeCountry(event.target.value)}
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
          >
            {COUNTRY_OPTIONS.map((option) => (
              <option key={option.code} value={option.code}>
                {option.name}
              </option>
            ))}
          </select>
          <p className="text-xs text-muted-foreground">
            {t("Serve para sugerir fuso horário e moeda. Não limita os países dos seus clientes.")}
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="timezone">{t("Fuso horário da empresa")}</Label>
          <select
            id="timezone"
            name="timezone"
            value={timezone}
            onChange={(event) => setTimezone(event.target.value)}
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
          >
            {timezones.map((zone) => (
              <option key={zone.id} value={zone.id}>
                {zone.label}
              </option>
            ))}
          </select>
          <p className="text-xs text-muted-foreground">
            {t("Controla o horário comercial, a agenda e os relatórios.")}
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="currency">{t("Moeda padrão e de relatórios")}</Label>
          <select
            id="currency"
            name="currency"
            value={currency}
            onChange={(event) => setCurrency(event.target.value as MoedaServida)}
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
          >
            {MOEDAS_SERVIDAS.map((code) => (
              <option key={code} value={code}>
                {code} · {simboloDaMoeda(code)}
              </option>
            ))}
          </select>
          <p className="text-xs text-muted-foreground">
            {t("É o padrão da empresa. Cada negócio pode usar uma moeda diferente.")}
          </p>
        </div>
      </div>

      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={accepted}
          onChange={(e) => setAccepted(e.target.checked)}
          className="mt-1"
          required
        />
        <span>
          {t("Li e aceito os")}{" "}
          <a className="underline" href="/legal/terms" target="_blank" rel="noreferrer">
            {t("Termos de Uso")}
          </a>{" "}
          {t("e a")}{" "}
          <a className="underline" href="/legal/privacy" target="_blank" rel="noreferrer">
            {t("Política de Privacidade")}
          </a>
          .
        </span>
      </label>

      <div className="flex sm:justify-end">
        <Button type="submit" disabled={pending || !accepted} className="w-full sm:w-auto">
          {pending ? t("Salvando...") : t("Continuar")}
        </Button>
      </div>
    </form>
  );
}
