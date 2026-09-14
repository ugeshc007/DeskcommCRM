import { countries } from "countries-list";
import { getTimeZones } from "@vvo/tzdb";

import { MOEDAS_SERVIDAS, MOEDA_PADRAO, type MoedaServida } from "@/lib/money";

export interface CountryOption {
  code: string;
  name: string;
  currencies: string[];
}

export interface TimezoneOption {
  id: string;
  countryCode: string | null;
  label: string;
  aliases: string[];
}

const countryRows = Object.entries(countries) as Array<
  [string, { name: string; currency: string[] }]
>;

export const COUNTRY_OPTIONS: CountryOption[] = countryRows
  .map(([code, country]) => ({
    code,
    name: country.name,
    currencies: country.currency,
  }))
  .sort((a, b) => a.name.localeCompare(b.name, "en"));

export const TIMEZONE_OPTIONS: TimezoneOption[] = getTimeZones({ includeUtc: true })
  .map((zone) => ({
    id: zone.name,
    countryCode: zone.countryCode || null,
    label: `${zone.currentTimeFormat} · ${zone.name}`,
    aliases: zone.group,
  }))
  .sort((a, b) => a.label.localeCompare(b.label, "en"));

export function countryForTimezone(timezone: string): string | null {
  return (
    TIMEZONE_OPTIONS.find(
      (zone) => zone.id === timezone || zone.aliases.includes(timezone),
    )?.countryCode ?? null
  );
}

export function canonicalTimezone(timezone: string): string {
  return (
    TIMEZONE_OPTIONS.find(
      (zone) => zone.id === timezone || zone.aliases.includes(timezone),
    )?.id ?? timezone
  );
}

export function suggestedCurrency(countryCode: string): MoedaServida {
  const country = COUNTRY_OPTIONS.find((item) => item.code === countryCode);
  const supported = country?.currencies.find((currency) =>
    (MOEDAS_SERVIDAS as readonly string[]).includes(currency),
  );
  return (supported as MoedaServida | undefined) ?? MOEDA_PADRAO;
}
