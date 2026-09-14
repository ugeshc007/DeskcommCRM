import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("estado de verificação na Central de Conexões", () => {
  it("não exige carimbo de health check do transporte para um canal oficial já validado", () => {
    const fonte = readFileSync(
      join(process.cwd(), "components/connections/ConnectionsClient.tsx"),
      "utf8",
    );

    expect(fonte).toContain('!vivaNoTransporte && c.status === "WORKING"');
    expect(fonte).toContain('t("Credencial do canal oficial validada")');
  });
});
