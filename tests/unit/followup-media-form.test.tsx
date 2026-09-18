import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MediaForm } from "@/app/app/ai/followups/[id]/_components/forms/MediaForm";
import type { FlowMediaAsset, FlowMediaConfig } from "@/lib/messaging/media/flow-media";

const flow = "22222222-2222-4222-8222-222222222222";
const asset = (id: number): FlowMediaAsset => ({
  storage_path: `11111111-1111-4111-8111-111111111111/flow-media/${flow}/33333333-3333-4333-8333-${String(id).padStart(12, "0")}.png`,
  kind: "image", mime: "image/png", size_bytes: 8, caption: `Picture ${id}`,
});
let responses: Array<{ status: number; data?: FlowMediaAsset }>;
const requests: MockUpload[] = [];
class MockUpload {
  upload: { onprogress?: (event: { lengthComputable: boolean; loaded: number; total: number }) => void } = {};
  onload?: () => void;
  onerror?: () => void;
  onabort?: () => void;
  status = 0;
  responseText = "";
  open = vi.fn();
  abort = vi.fn(() => this.onabort?.());
  send = vi.fn(() => {
    requests.push(this);
    queueMicrotask(() => {
      this.upload.onprogress?.({ lengthComputable: true, loaded: 8, total: 8 });
      const response = responses.shift() ?? { status: 500 };
      this.status = response.status;
      this.responseText = JSON.stringify({ data: response.data });
      this.onload?.();
    });
  });
}
beforeEach(() => {
  requests.length = 0;
  responses = [];
  vi.stubGlobal("XMLHttpRequest", MockUpload);
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ data: { url: "https://storage.example/preview" } }) })));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function Harness({ initial, onChange = vi.fn() }: { initial: FlowMediaConfig; onChange?: (value: FlowMediaConfig) => void }) {
  const [config, setConfig] = useState(initial);
  return <MediaForm flowId={flow} config={config} onChange={(next) => { setConfig(next); onChange(next); }} />;
}
const images = (assets: FlowMediaAsset[] = []): FlowMediaConfig => ({ mode: "media", media_kind: "image", multiple: true, assets });
const file = () => new File([new Uint8Array([137,80,78,71,13,10,26,10])], "picture.png", { type: "image/png" });

describe("media block editor", () => {
  it("offers a real multiple-image picker and stores successful uploads in order", async () => {
    const changed = vi.fn(); responses = [{ status: 201, data: asset(1) }, { status: 201, data: asset(2) }];
    render(<Harness initial={images()} onChange={changed} />);
    const input = screen.getByLabelText("Upload images");
    expect(input).toHaveAttribute("multiple");
    expect(input).toHaveAttribute("accept", "image/jpeg,image/png");
    fireEvent.change(input, { target: { files: [file(), file()] } });
    await waitFor(() => expect(changed).toHaveBeenLastCalledWith(images([asset(1), asset(2)])));
    expect(requests[0]!.open).toHaveBeenCalledWith("POST", `/api/v1/ai/followup-flows/${flow}/media`);
    expect(screen.getByLabelText("Move file 1 up")).toBeDisabled();
    expect(screen.getByLabelText("Move file 2 down")).toBeDisabled();
  });
  it("preserves successful files when a later upload fails", async () => {
    const changed = vi.fn(); responses = [{ status: 201, data: asset(1) }, { status: 500 }];
    render(<Harness initial={images()} onChange={changed} />);
    fireEvent.change(screen.getByLabelText("Upload images"), { target: { files: [file(), file()] } });
    expect(await screen.findByRole("alert")).toHaveTextContent("Upload failed");
    expect(changed).toHaveBeenLastCalledWith(images([asset(1)]));
    expect(screen.getByLabelText("Upload images")).not.toBeDisabled();
  });
  it("reorders and removes draft references without a server delete", async () => {
    const changed = vi.fn(); render(<Harness initial={images([asset(1), asset(2)])} onChange={changed} />);
    fireEvent.click(screen.getByLabelText("Move file 2 up"));
    expect(changed).toHaveBeenLastCalledWith(images([asset(2), asset(1)]));
    fireEvent.click(screen.getByLabelText("Remove file 1 from draft"));
    expect(changed).toHaveBeenLastCalledWith(images([asset(1)]));
    expect(requests).toHaveLength(0);
    await waitFor(() => expect(screen.queryByText("Loading preview…")).toBeNull());
  });
  it("rejects excess files before making any upload request", () => {
    render(<Harness initial={{ ...images(), multiple: false }} />);
    fireEvent.change(screen.getByLabelText("Upload image file"), { target: { files: [file(), file()] } });
    expect(screen.getByRole("alert")).toHaveTextContent("accepts 1 file");
    expect(requests).toHaveLength(0);
  });
  it("shows format and codec requirements for video and audio", () => {
    const { rerender } = render(<MediaForm flowId={flow} config={{ mode: "media", media_kind: "video", multiple: false, assets: [] }} onChange={vi.fn()} />);
    expect(screen.getByLabelText("Upload video file")).toHaveAttribute("accept", "video/mp4");
    expect(screen.getByText(/H.264/)).toBeVisible();
    rerender(<MediaForm flowId={flow} config={{ mode: "media", media_kind: "audio", multiple: false, assets: [] }} onChange={vi.fn()} />);
    expect(screen.getByLabelText("Upload audio file")).toHaveAttribute("accept", "audio/mpeg,audio/ogg");
    expect(screen.getByText(/sent separately/)).toBeVisible();
  });
});
