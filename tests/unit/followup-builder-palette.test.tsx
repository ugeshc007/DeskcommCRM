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
  it("keeps multiline cards auto-sized at desktop widths with decorative icons", () => {
    render(<NodePalette onAdd={vi.fn()} onMessage={vi.fn()} onStarter={vi.fn()} canUseStarter />);
    for (const name of [/Text message/, /AI reply/, /Saved message/, /Welcome & enquiry/, /Product enquiry/, /Payment assistance/]) {
      const card = screen.getByRole("button", { name });
      expect(card).toHaveClass("h-auto", "lg:h-auto", "shrink-0");
      expect(card).not.toHaveClass("lg:h-9");
      expect(card.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    }
    expect(screen.getByRole("button", { name: "Repeat" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Action" })).toBeVisible();
  });
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
