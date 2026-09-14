import { net, protocol } from "electron";
import { isAbsolute, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const RENDERER_SCHEME = "path";

export const RENDERER_ORIGIN = `${RENDERER_SCHEME}://renderer`;

export function registerRendererScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: RENDERER_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true },
    },
  ]);
}

export function handleRendererScheme(rendererDirectory: string): void {
  const root = resolve(rendererDirectory);

  protocol.handle(RENDERER_SCHEME, (request) => {
    const url = new URL(request.url);

    if (url.hostname !== "renderer") {
      return new Response("Not found", { status: 404 });
    }

    let pathname: string;

    try {
      pathname = decodeURIComponent(url.pathname) || "/";
    } catch {
      return new Response("Invalid path", { status: 400 });
    }

    // Nested exported routes still load shared Next assets from the renderer root.
    const assetsIndex = pathname.indexOf("/_next/");

    if (assetsIndex >= 0) pathname = pathname.slice(assetsIndex);
    if (pathname.endsWith("/")) pathname += "index.html";

    const filePath = resolve(root, pathname.replace(/^[/\\]+/, ""));
    const pathFromRoot = relative(root, filePath);

    // Check the decoded, resolved path so encoded traversal cannot escape the export directory.
    if (pathFromRoot.startsWith("..") || isAbsolute(pathFromRoot) || pathFromRoot === "") {
      return new Response("Not found", { status: 404 });
    }

    return net.fetch(pathToFileURL(filePath).toString());
  });
}
