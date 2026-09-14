import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ExampleFlowTemplates } from "./ExampleFlowTemplates";

const mutate = vi.fn();
const push = vi.fn();

vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/hooks/followup/useFollowupFlows", () => ({
  useCreateFollowupFlow: () => ({ mutate, isPending: false }),
}));

describe("ExampleFlowTemplates", () => {
  beforeEach(() => {
    mutate.mockReset();
    push.mockReset();
  });

  it("explica os quatro casos comuns e cria um rascunho pelo id do exemplo", async () => {
    render(<ExampleFlowTemplates />);

    expect(screen.getByRole("heading", { name: "Examples to get started" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Use this example" })).toHaveLength(4);
    expect(screen.getByText("Sales proposal follow-up")).toBeInTheDocument();
    expect(screen.getByText("Re-engage a silent lead")).toBeInTheDocument();
    expect(screen.getByText("Abandoned checkout recovery")).toBeInTheDocument();
    expect(screen.getByText("Reschedule a missed appointment")).toBeInTheDocument();

    await userEvent.click(screen.getAllByRole("button", { name: "Use this example" })[0]!);
    expect(mutate).toHaveBeenCalledWith(
      { name: "Sales proposal follow-up", template_id: "proposta-vendas" },
      expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) }),
    );
  });

  it("abre o editor quando o servidor devolve o rascunho criado", () => {
    mutate.mockImplementation((_input, options) => options.onSuccess({ id: "flow-123" }));
    render(<ExampleFlowTemplates />);

    screen.getAllByRole("button", { name: "Use this example" })[0]!.click();
    expect(push).toHaveBeenCalledWith("/app/ai/followups/flow-123");
  });
});
