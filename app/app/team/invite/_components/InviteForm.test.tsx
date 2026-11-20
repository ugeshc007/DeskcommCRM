import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { render } from "@/tests/helpers/render-portuguese";

const { invite, notify } = vi.hoisted(() => ({
  invite: vi.fn(),
  notify: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/hooks/team/useInviteMembers", () => ({
  useInviteMembers: () => ({ mutateAsync: invite, isPending: false }),
}));
vi.mock("@/components/team/InterfaceEditor", () => ({
  InterfaceEditor: () => <div>Interface settings</div>,
}));
vi.mock("@/components/ui/select", () => ({
  Select: ({ value, onValueChange, children }: { value: string; onValueChange: (value: string) => void; children: React.ReactNode }) =>
    <select aria-label="Role" value={value} onChange={(event) => onValueChange(event.target.value)}>{children}</select>,
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children: React.ReactNode }) => <option value={value}>{children}</option>,
}));
vi.mock("sonner", () => ({ toast: notify }));

import { InviteForm } from "./InviteForm";

const setupUrl = "https://crm.example.test/team/accept-invite/private-test-token";

beforeEach(() => {
  vi.clearAllMocks();
  invite.mockResolvedValue({
    data: {
      sent: [{ email: "staff@example.test", accept_url: setupUrl, email_dispatched: false, expires_at: "2026-09-22T12:00:00Z" }],
      failed: [],
    },
  });
});

describe("manual team invitation without email", () => {
  it("shows a private link and copies it without putting the token in a toast", async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
    render(<InviteForm />);

    expect(screen.getByText(/Sem email configurado/)).toBeInTheDocument();
    await user.type(screen.getByLabelText("Emails"), "staff@example.test");
    await user.click(screen.getByRole("button", { name: "Enviar convites" }));

    expect(await screen.findByText(setupUrl)).toBeInTheDocument();
    expect(screen.getByText(/define a própria senha/)).toBeInTheDocument();
    expect(invite).toHaveBeenCalledWith({
      invitations: [{ email: "staff@example.test", role: "agent", interface_settings: { preset: "completa" } }],
    });

    await user.click(screen.getByRole("button", { name: "Copiar link de acesso" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(setupUrl));
    expect(notify.success).toHaveBeenCalledWith("Link de acesso copiado.");
    expect(JSON.stringify(notify.success.mock.calls)).not.toContain(setupUrl);
  });

  it("keeps the link selectable if clipboard access is denied", async () => {
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(new Error("clipboard blocked"));
    render(<InviteForm />);
    await user.type(screen.getByLabelText("Emails"), "staff@example.test");
    await user.click(screen.getByRole("button", { name: "Enviar convites" }));
    expect(await screen.findByText(setupUrl)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Copiar link de acesso" }));
    await waitFor(() => expect(notify.error).toHaveBeenCalledWith(
      "Não foi possível copiar. Selecione o link abaixo e copie manualmente.",
    ));
    expect(screen.getByText(setupUrl)).toHaveClass("select-all");
  });

  it("warns when a manager invite was not emailed", async () => {
    const user = userEvent.setup();
    render(<InviteForm />);
    await user.type(screen.getByLabelText("Emails"), "manager@example.test");
    await user.selectOptions(screen.getByRole("combobox", { name: "Role" }), "manager");
    await user.click(screen.getByRole("button", { name: "Enviar convites" }));

    expect(await screen.findByText(/Quem tiver o link pode criar uma conta de gerente ou administrador/)).toBeInTheDocument();
    expect(invite).toHaveBeenCalledWith({
      invitations: [{ email: "manager@example.test", role: "manager", interface_settings: { preset: "completa" } }],
    });
  });
});
