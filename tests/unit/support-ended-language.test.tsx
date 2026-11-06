import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { loadAuthUser } = vi.hoisted(() => ({ loadAuthUser: vi.fn() }));
vi.mock("@/lib/auth/server", () => ({ loadAuthUser }));
vi.mock("@/components/shell/OrganizationTransitionProvider", () => ({
  useOrganizationTransition: () => ({ begin: vi.fn(), cancel: vi.fn() }),
}));
import SupportEndedPage from "@/app/support-ended/page";

afterEach(cleanup);
describe("idioma após expirar o suporte", () => {
  it.each([
    ["pt-BR", "Sair do acompanhamento"],
    ["en", "Leave tracking"],
  ])("mantém o botão de saída no idioma %s", async (idioma, label) => {
    loadAuthUser.mockResolvedValue({ idioma, support: {
      organization_id: "fixture-org", name: "Fixture support",
      expires_at: "2026-01-01T00:00:00Z",
    } });
    render(await SupportEndedPage());
    expect(screen.getByRole("button", { name: label }).hasAttribute("disabled")).toBe(false);
  });
});
