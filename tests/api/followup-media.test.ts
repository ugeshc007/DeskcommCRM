import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { File as NodeFile } from "node:buffer";
import { NextRequest } from "next/server";
import { GET, POST } from "@/app/api/v1/ai/followup-flows/[id]/media/route";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), admin: vi.fn(), support: vi.fn(), audit: vi.fn() }));
vi.mock("@/lib/auth/require-role", () => ({ requireRole: mocks.auth }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.admin }));
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: mocks.support }));
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));
const org = "11111111-1111-4111-8111-111111111111";
const flow = "22222222-2222-4222-8222-222222222222";
const other = "33333333-3333-4333-8333-333333333333";
const ctx = { params: Promise.resolve({ id: flow }) };
const base = `http://localhost/api/v1/ai/followup-flows/${flow}/media`;
let query: { select: ReturnType<typeof vi.fn>; eq: ReturnType<typeof vi.fn>; maybeSingle: ReturnType<typeof vi.fn> };
let bucket: { upload: ReturnType<typeof vi.fn>; createSignedUrl: ReturnType<typeof vi.fn> };
beforeEach(() => {
  vi.clearAllMocks(); mocks.support.mockResolvedValue(null);
  mocks.auth.mockResolvedValue({ ok: true, org: { orgId: org }, user: { id: other } });
  query = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), maybeSingle: vi.fn(async () => ({ data: { id: flow }, error: null })) };
  bucket = { upload: vi.fn(async () => ({ error: null })), createSignedUrl: vi.fn(async () => ({ data: { signedUrl: "https://storage.example/short-lived-preview" }, error: null })) };
  mocks.admin.mockReturnValue({ from: vi.fn(() => query), storage: { from: vi.fn(() => bucket) } });
});
afterEach(() => vi.unstubAllGlobals());
describe("flow media routes", () => {
  it("parses a real bounded multipart request before private storage", async () => {
    vi.stubGlobal("File", NodeFile);
    const head = new TextEncoder().encode('--test-boundary\r\nContent-Disposition: form-data; name="file"; filename="fixture.png"\r\nContent-Type: image/png\r\n\r\n');
    const png = new Uint8Array([137,80,78,71,13,10,26,10]);
    const tail = new TextEncoder().encode('\r\n--test-boundary--\r\n');
    const body = new Uint8Array([...head, ...png, ...tail]);
    const req = new NextRequest(base, { method: "POST", headers: { "content-type": "multipart/form-data; boundary=test-boundary" }, body });
    const response = await POST(req, ctx);
    expect(response.status).toBe(201);
    expect(bucket.upload).toHaveBeenCalledWith(expect.stringContaining(`${org}/flow-media/${flow}/`), png, { contentType: "image/png", upsert: false });
  });
  function uploadRequest(bytes: Uint8Array, type: string) {
    const file = new File([bytes as Uint8Array<ArrayBuffer>], "test.png", { type });
    Object.defineProperty(file, "arrayBuffer", { value: async () => bytes.buffer });
    const req = new NextRequest(base, { method: "POST" });
    vi.spyOn(req, "formData").mockResolvedValue({ get: () => file } as unknown as FormData);
    return req;
  }
  it("stores a verified file under the authenticated organization, with a safe audit event", async () => {
    const response = await POST(uploadRequest(new Uint8Array([137,80,78,71,13,10,26,10]), "image/png"), ctx);
    expect(response.status).toBe(201);
    const json = await response.json();
    expect(json.data.storage_path).toMatch(new RegExp(`^${org}/flow-media/${flow}/`));
    expect(bucket.upload).toHaveBeenCalledWith(json.data.storage_path, expect.any(Uint8Array), { contentType: "image/png", upsert: false });
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ organizationId: org, action: "followup_flow.media_uploaded" }));
    expect(JSON.stringify(mocks.audit.mock.calls)).not.toContain("test.png");
  });
  it("rejects mislabeled HTML before storage", async () => {
    const response = await POST(uploadRequest(new TextEncoder().encode("<html>unsafe</html>"), "image/png"), ctx);
    expect(response.status).toBe(415);
    expect(bucket.upload).not.toHaveBeenCalled();
  });
  it("rejects prototype names as MIME formats without throwing", async () => {
    for (const mime of ["constructor", "__proto__", "toString"]) {
      expect((await POST(uploadRequest(new Uint8Array([1]), mime), ctx)).status).toBe(415);
    }
    expect(bucket.upload).not.toHaveBeenCalled();
  });
  it("checks manager permission and support restrictions before upload", async () => {
    mocks.support.mockResolvedValue(new Response(null, { status: 403 }));
    expect((await POST(new NextRequest(base, { method: "POST" }), ctx)).status).toBe(403);
    expect(mocks.auth).not.toHaveBeenCalled();
    expect(bucket.upload).not.toHaveBeenCalled();
    mocks.support.mockResolvedValue(null);
    mocks.auth.mockResolvedValue({ ok: false, response: new Response(null, { status: 403 }) });
    expect((await POST(new NextRequest(base, { method: "POST" }), ctx)).status).toBe(403);
    expect(mocks.auth).toHaveBeenCalledWith("manager", expect.anything());
  });
  it("never signs a foreign organization or foreign flow file", async () => {
    for (const path of [`${other}/flow-media/${flow}/${other}.png`, `${org}/flow-media/${other}/${other}.png`]) {
      expect((await GET(new NextRequest(`${base}?path=${encodeURIComponent(path)}`), ctx)).status).toBe(404);
    }
    expect(bucket.createSignedUrl).not.toHaveBeenCalled();
  });
  it("requires flow membership even for a correctly prefixed path", async () => {
    query.maybeSingle.mockResolvedValue({ data: null, error: null });
    expect((await GET(new NextRequest(`${base}?path=${org}/flow-media/${flow}/${other}.png`), ctx)).status).toBe(404);
    expect(query.eq).toHaveBeenCalledWith("organization_id", org);
    expect(bucket.createSignedUrl).not.toHaveBeenCalled();
  });
  it("returns only a short-lived non-cacheable preview", async () => {
    const path = `${org}/flow-media/${flow}/${other}.png`;
    const response = await GET(new NextRequest(`${base}?path=${path}`), ctx);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(bucket.createSignedUrl).toHaveBeenCalledWith(path, 120);
  });
  it("refuses an oversized body without parsing or writing it", async () => {
    const req = new NextRequest(base, { method: "POST", headers: { "content-length": String(52 * 1024 * 1024) } });
    expect((await POST(req, ctx)).status).toBe(413);
    expect(bucket.upload).not.toHaveBeenCalled();
  });
  it("bounds streamed bodies even when Content-Length is absent", async () => {
    const cancelled = vi.fn();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array(52 * 1024 * 1024)); },
      cancel: cancelled,
    });
    const req = new NextRequest(base, { method: "POST" });
    Object.defineProperty(req, "body", { value: stream });
    expect((await POST(req, ctx)).status).toBe(413);
    expect(cancelled).toHaveBeenCalledOnce();
    expect(bucket.upload).not.toHaveBeenCalled();
  });
  it("does not expose raw storage errors", async () => {
    bucket.createSignedUrl.mockResolvedValue({ data: null, error: { message: "SECRET_PROVIDER_DIAGNOSTIC" } });
    const response = await GET(new NextRequest(`${base}?path=${org}/flow-media/${flow}/${other}.png`), ctx);
    expect(await response.text()).not.toContain("SECRET_PROVIDER_DIAGNOSTIC");
  });
});
