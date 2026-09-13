import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const raiz = process.cwd();
const entradaPublica = join(raiz, "app", "(public)", "page.tsx");

describe("porta pública da instalação SaaS", () => {
  it("não redireciona a raiz diretamente para a área autenticada", () => {
    expect(existsSync(join(raiz, "app", "page.tsx"))).toBe(false);

    const fonte = readFileSync(entradaPublica, "utf8");
    expect(fonte).not.toContain('redirect("/app")');
  });

  it("expõe as duas jornadas sem antecipar o onboarding", () => {
    const fonte = readFileSync(entradaPublica, "utf8");

    expect(fonte).toContain('href="/login"');
    expect(fonte).toContain('href="/signup"');
    expect(fonte).not.toContain('href="/onboarding/welcome"');
  });
});
