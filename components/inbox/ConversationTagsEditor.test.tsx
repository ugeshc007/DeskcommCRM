import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { IdiomaProvider } from "@/lib/i18n/IdiomaProvider";
import { traduzir } from "@/lib/i18n/dicionario";
import { ConversationTagsEditor } from "./ConversationTagsEditor";

const mutate = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/inbox/useConversationTags", () => ({
  useUpdateConversationTags: () => ({ mutate, isPending: false }),
  useConversationTagVocabulary: () => ({ data: ["dúvida", "reclamação", "cliente-vip"] }),
}));

afterEach(() => {
  cleanup();
  mutate.mockReset();
});

describe("tags canônicas no Inbox", () => {
  it("traduz os oito rótulos padrão para inglês sem mudar seus valores", () => {
    const labels = new Map([
      ["dúvida", "question"], ["reclamação", "complaint"],
      ["troca", "exchange"], ["devolução", "return"],
      ["elogio", "compliment"], ["orçamento", "quote"],
      ["pós-venda", "after-sales"], ["urgente", "urgent"],
    ]);
    for (const [value, label] of labels) {
      expect(traduzir(value, "en")).toBe(label);
      expect(traduzir(value, "pt-BR")).toBe(value);
    }
  });

  it("mostra o idioma escolhido e envia a tag original ao selecionar", () => {
    render(
      <IdiomaProvider locale="en">
        <ConversationTagsEditor conversationId="conversation-1" orgId="org-1" tags={["reclamação"]} />
      </IdiomaProvider>,
    );
    expect(screen.getByText("complaint")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /question/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /cliente-vip/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /question/i }));
    expect(mutate).toHaveBeenCalledWith({
      conversation_id: "conversation-1",
      tags: ["reclamação", "dúvida"],
    });
  });
});
