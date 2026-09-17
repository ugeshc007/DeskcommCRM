import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NodePalette } from "@/app/app/ai/followups/[id]/_components/NodePalette";
import { ActionForm } from "@/app/app/ai/followups/[id]/_components/forms/ActionForm";

vi.mock("@/hooks/i18n/useT", () => ({ useT: () => (text: string) => text }));
vi.mock("@/hooks/inbox/useMessageTemplates", () => ({
  useMessageTemplates: () => ({ data: [], isLoading: false, isError: false }),
}));
afterEach(cleanup);

describe("visual message library", () => {
  it("adds message blocks by click and publishes the same identifier on drag", () => {
    const onMessage = vi.fn();
    render(<NodePalette onAdd={vi.fn()} onMessage={onMessage} />);
    const block = screen.getByRole("button", { name: /Text message/ });
    fireEvent.click(block);
    expect(onMessage).toHaveBeenCalledWith("text");
    const setData = vi.fn();
    fireEvent.dragStart(block, { dataTransfer: { setData } });
    expect(setData).toHaveBeenCalledWith("application/x-followup-message-block", "text");
  });
  it("does not replace an existing flow with a starter", () => {
    const onStarter = vi.fn();
    render(<NodePalette onAdd={vi.fn()} onStarter={onStarter} canUseStarter={false} />);
    const starter = screen.getByRole("button", { name: /Welcome & enquiry/ });
    expect(starter).toBeDisabled();
    fireEvent.click(starter);
    expect(onStarter).not.toHaveBeenCalled();
  });
  it("creates a starter on an empty canvas", () => {
    const onStarter = vi.fn();
    render(<NodePalette onAdd={vi.fn()} onStarter={onStarter} canUseStarter />);
    fireEvent.click(screen.getByRole("button", { name: /Product enquiry/ }));
    expect(onStarter).toHaveBeenCalledWith("sales");
  });
  it("updates the customer preview as the operator edits text", () => {
    const onChange = vi.fn();
    render(<ActionForm config={{ mode: "text", body: "Welcome!" }} onChange={onChange} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "How can we help?" } });
    expect(screen.getByRole("region", { name: "Message preview" })).toHaveTextContent(
      "How can we help?",
    );
    expect(onChange).toHaveBeenLastCalledWith({ mode: "text", body: "How can we help?" });
  });
});
