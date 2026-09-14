import { describe, expect, it } from "vitest";

import {
  COUNTRY_OPTIONS,
  TIMEZONE_OPTIONS,
  countryForTimezone,
  suggestedCurrency,
} from "@/lib/geography";
import { IDIOMA_PADRAO, normalizarIdioma } from "@/lib/i18n/idiomas";

describe("onboarding internacional", () => {
  it("oferece o catálogo mundial, não uma lista regional fixa", () => {
    expect(COUNTRY_OPTIONS.length).toBeGreaterThan(240);
    expect(COUNTRY_OPTIONS.some((country) => country.code === "AE")).toBe(true);
    expect(COUNTRY_OPTIONS.some((country) => country.code === "IN")).toBe(true);
    expect(COUNTRY_OPTIONS.some((country) => country.code === "US")).toBe(true);
    expect(TIMEZONE_OPTIONS.length).toBeGreaterThan(300);
  });

  it("liga Emirados ao fuso e às moedas suportadas sem prender o negócio ao país", () => {
    expect(countryForTimezone("Asia/Dubai")).toBe("AE");
    expect(suggestedCurrency("AE")).toBe("AED");
    expect(suggestedCurrency("US")).toBe("USD");
  });

  it("inglês é o padrão quando ninguém escolheu idioma", () => {
    expect(IDIOMA_PADRAO).toBe("en");
    expect(normalizarIdioma(null)).toBe("en");
  });
});
