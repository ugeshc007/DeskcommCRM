import { describe, expect, it } from "vitest";

import { flowGraphSchema } from "./graph-schema";
import { IDS_MODELO_FOLLOWUP, MODELOS_FOLLOWUP, montarModeloFollowup } from "./modelos-exemplo";

describe("modelos de exemplo de follow-up", () => {
  it("mantém catálogo, construtor e schema em acordo", () => {
    expect(MODELOS_FOLLOWUP.map((modelo) => modelo.id)).toEqual(IDS_MODELO_FOLLOWUP);

    for (const id of IDS_MODELO_FOLLOWUP) {
      const modelo = montarModeloFollowup(id, (texto) => texto);
      expect(flowGraphSchema.safeParse(modelo.graph).success, id).toBe(true);
      expect(modelo.graph.nodes[0]?.type, id).toBe("trigger");
      expect(modelo.graph.nodes.at(-1)?.type, id).toBe("end");
    }
  });

  it("todo exemplo cancela a sequência quando o contato responde", () => {
    for (const id of IDS_MODELO_FOLLOWUP) {
      expect(montarModeloFollowup(id, (texto) => texto).triggerConfig.cancel_on_reply, id).toBe(
        true,
      );
    }
  });
});
