import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CanalOficialClient } from "./CanalOficialClient";

const state = vi.hoisted(() => ({ platformWebhook: null as null | { configured: boolean; source: "database" | "environment" | null } }));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn(async () => undefined) }),
}));
vi.mock("@/hooks/i18n/useT", () => ({ useT: () => (text: string) => text }));
vi.mock("@/hooks/channels/useOfficialChannel", () => ({
  useOfficialChannel: () => ({
    isPending: false,
    data: {
      data: {
        connected: true,
        hasToken: true,
        phoneNumberId: "123",
        wabaId: "456",
        displayName: "Sales",
        phoneNumber: "+971500000000",
        status: "WORKING",
        webhook: { callbackUrl: "https://example.test/hook", verifyToken: "verify", fields: ["messages"] },
        platformWebhook: state.platformWebhook,
      },
    },
  }),
  useConnectOfficialChannel: () => ({ isPending: false, mutateAsync: vi.fn() }),
}));
vi.mock("@/app/actions/settings/updateMetaWebhookSecret", () => ({
  updateMetaWebhookSecret: vi.fn(async () => ({ ok: true })),
}));
vi.mock("./ChannelAiAccess", () => ({ ChannelAiAccess: () => null }));

afterEach(() => {
  cleanup();
  state.platformWebhook = null;
});

describe("App Secret sob o card de callback", () => {
  it("não existe para admin comum da organização", () => {
    render(<CanalOficialClient />);
    expect(screen.queryByTestId("meta-app-secret-card")).toBeNull();
  });

  it("aparece entre callback e troca de credencial para platform admin", () => {
    state.platformWebhook = { configured: true, source: "database" };
    render(<CanalOficialClient />);

    const callbackHeading = screen.getByText("Cole isto no painel da Meta");
    const callback = callbackHeading.closest("[data-slot='card']") ?? callbackHeading.parentElement!.parentElement!;
    const secret = screen.getByTestId("meta-app-secret-card");
    const exchangeHeading = screen.getByText("Trocar credencial");
    const exchange = exchangeHeading.closest("[data-slot='card']") ?? exchangeHeading.parentElement!;
    expect(callback.compareDocumentPosition(secret) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(secret.compareDocumentPosition(exchange) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByLabelText("Meta App Secret")).toHaveValue("");
    expect(secret).toHaveTextContent("Carregado atualmente por esta página.");
  });
});
