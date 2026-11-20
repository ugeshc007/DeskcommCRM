import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CanvasDeleteControl } from "@/app/app/ai/followups/[id]/_components/CanvasDeleteControl";

vi.mock("@/hooks/i18n/useT", () => ({ useT: () => (text: string) => text }));
vi.mock("sonner", () => ({ toast: { success: vi.fn() } }));
afterEach(cleanup);

describe("canvas delete control", () => {
  it("opens confirmation without deleting and lets the user cancel", () => {
    const onDelete = vi.fn();
    render(<CanvasDeleteControl kind="block" label="Welcome" onDelete={onDelete} />);
    fireEvent.click(screen.getByRole("button", { name: "Delete selected block" }));
    expect(screen.getByRole("alertdialog")).toHaveTextContent("attached connections");
    expect(onDelete).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });
  it.each(["block", "connection"] as const)("removes only the selected %s after confirmation", kind => {
    const onDelete = vi.fn();
    render(<CanvasDeleteControl kind={kind} label="Welcome" onDelete={onDelete} />);
    fireEvent.click(screen.getByRole("button", { name: `Delete selected ${kind}` }));
    expect(screen.getByRole("alertdialog")).toHaveTextContent("not saved or published automatically");
    if (kind === "connection") expect(screen.getByRole("alertdialog")).toHaveTextContent("Both blocks will remain");
    fireEvent.click(screen.getByRole("button", { name: /^Delete$/ }));
    expect(onDelete).toHaveBeenCalledTimes(1);
  });
});
