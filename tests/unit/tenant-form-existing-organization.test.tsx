import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { TenantForm } from "@/app/app/settings/tenant/_form";
import { updateTenant } from "@/app/actions/settings/updateTenant";

vi.mock("@/hooks/i18n/useT", () => ({ useT: () => (text: string) => text }));
vi.mock("@/app/actions/settings/updateTenant", () => ({ updateTenant: vi.fn().mockResolvedValue({ ok: true }) }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

it("saves an existing organization's currency without requiring a new country", async () => {
  render(<TenantForm initial={{ display_name: "Loja", legal_name: "Loja", timezone: "America/Sao_Paulo", locale: "pt-BR", currency: "MXN", media_retention_days: 365, lost_reasons_extra: [] }} />);
  const save = screen.getByRole("button", { name: "Salvar" });
  const form = save.closest("form")!;
  expect(form.checkValidity()).toBe(true);
  fireEvent.submit(form);
  await waitFor(() => expect(updateTenant).toHaveBeenCalledWith(expect.objectContaining({ currency: "MXN", country_code: undefined })));
});
