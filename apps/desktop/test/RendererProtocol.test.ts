import { beforeEach, describe, expect, it, vi } from "vitest";
import { net, protocol } from "electron";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { handleRendererScheme, RENDERER_ORIGIN } from "../src/windows/RendererProtocol";

vi.mock("electron", () => ({
  net: { fetch: vi.fn(() => new Response("renderer")) },
  protocol: { handle: vi.fn() },
}));

beforeEach(() => vi.clearAllMocks());

function request(url: string): Response | Promise<Response> {
  const handler = vi.mocked(protocol.handle).mock.calls[0]?.[1];

  if (!handler) throw new Error("Renderer handler was not registered");

  return handler(new Request(url));
}

describe("renderer protocol", () => {
  it("maps application routes to exported index pages", async () => {
    const directory = resolve("renderer");

    handleRendererScheme(directory);
    await request(`${RENDERER_ORIGIN}/SettingsPage/`);
    expect(net.fetch).toHaveBeenCalledWith(
      pathToFileURL(resolve(directory, "SettingsPage/index.html")).toString(),
    );
  });

  it("rejects malformed URL escapes without throwing", async () => {
    handleRendererScheme(resolve("renderer"));
    expect((await request(`${RENDERER_ORIGIN}/%E0%A4%A`)).status).toBe(400);
    expect(net.fetch).not.toHaveBeenCalled();
  });

  it("rejects encoded traversal outside the renderer directory", async () => {
    handleRendererScheme(resolve("renderer"));

    // Encoding the separator avoids URL's automatic normalization of literal dot segments.
    expect((await request(`${RENDERER_ORIGIN}/..%2Fprivate.txt`)).status).toBe(404);
    expect(net.fetch).not.toHaveBeenCalled();
  });

  it("rejects hosts outside the renderer origin", async () => {
    handleRendererScheme(resolve("renderer"));
    expect((await request("path://other/index.html")).status).toBe(404);
    expect(net.fetch).not.toHaveBeenCalled();
  });
});
