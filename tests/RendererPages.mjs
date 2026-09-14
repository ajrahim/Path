import assert from "node:assert/strict";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, isAbsolute, relative, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const rendererDirectory = fileURLToPath(new URL("../apps/renderer/out/", import.meta.url));
const contentTypes = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".json": "application/json",
  ".css": "text/css",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
};

// Match Electron's nested-asset resolution while exercising the actual exported HTML and scripts.
async function serveFile(request, response) {
  try {
    let pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    const assetsIndex = pathname.indexOf("/_next/");

    if (assetsIndex >= 0) pathname = pathname.slice(assetsIndex);
    if (pathname.endsWith("/")) pathname += "index.html";

    const file = resolve(rendererDirectory, pathname.replace(/^[/\\]+/, ""));
    const fromRoot = relative(rendererDirectory, file);

    if (fromRoot.startsWith("..") || isAbsolute(fromRoot) || !fromRoot) {
      response.writeHead(404).end();

      return;
    }

    const metadata = await stat(file);

    if (!metadata.isFile()) {
      response.writeHead(404).end();

      return;
    }

    response.writeHead(200, {
      "Content-Type": contentTypes[extname(file)] ?? "application/octet-stream",
      "Content-Length": metadata.size,
    });

    // HEAD responses share the file's headers but never stream its body.
    if (request.method === "HEAD") {
      response.end();

      return;
    }

    await pipeline(createReadStream(file), response);
  } catch {
    // Missing paths are expected for a favicon or unknown route; asset failures are checked below.
    if (!response.headersSent) response.writeHead(404).end();
    else response.destroy();
  }
}

const server = createServer((request, response) => void serveFile(request, response));
let browser;

try {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();

  assert.ok(address && typeof address !== "string");

  const origin = `http://127.0.0.1:${address.port}`;

  browser = await chromium.launch({
    headless: true,
    ...(process.env.PATH_APP_BROWSER_EXECUTABLE
      ? { executablePath: process.env.PATH_APP_BROWSER_EXECUTABLE }
      : { channel: "chrome" }),
  });

  const page = await browser.newPage();
  const errors = [];
  const completedHeadRequests = new Set();

  await page.addInitScript(() => {
    if (localStorage.getItem("path.theme") === null) {
      localStorage.setItem("path.theme", "dark");
    }
  });

  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    // Missing-resource responses are checked below; this also ignores an optional favicon.
    if (message.type() === "error" && !message.text().startsWith("Failed to load resource:")) {
      errors.push(message.text());
    }
  });
  page.on("response", (response) => {
    if (response.request().method() === "HEAD" && response.ok()) {
      completedHeadRequests.add(response.request());
    }

    if (response.url().includes("/_next/") && response.status() >= 400) {
      errors.push(`Exported asset failed: ${response.status()} ${response.url()}`);
    }
  });
  page.on("requestfailed", (request) => {
    // Chromium can mark a bodyless HEAD probe aborted after its successful response.
    if (completedHeadRequests.has(request) && request.failure()?.errorText === "net::ERR_ABORTED") {
      return;
    }

    if (request.url().includes("/_next/")) {
      errors.push(
        `Exported asset request failed: ${request.method()} ${request.failure()?.errorText} ${request.url()}`,
      );
    }
  });

  // A fresh load of each native window URL must hydrate its own page, including the hidden worker.
  for (const [route, selector] of [
    ["/", ".app-frame"],
    ["/WorkspacePage/", ".app-frame"],
    ["/CapturePage/", null],
    ["/RecorderPage/", ".recorder-popover"],
    ["/RecordingToolbarPage/", ".recording-toolbar"],
    ["/RegionPage/", ".region-overlay"],
    ["/SettingsPage/", ".settings-window"],
  ]) {
    const response = await page.goto(`${origin}${route}`, { waitUntil: "networkidle" });

    assert.equal(response.status(), 200, `Exported page is available at ${route}`);
    assert.equal(await page.title(), "Path");
    assert.equal(await page.locator("html").getAttribute("data-theme"), "dark");

    const monoFont = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue("--font-mono"),
    );

    assert.ok(monoFont.trim(), "The document shell supplies the monospace font");

    if (selector) await page.locator(selector).waitFor({ state: "visible" });
    if (selector !== ".app-frame") assert.equal(await page.locator(".app-frame").count(), 0);

    if (route === "/RegionPage/") {
      const backgrounds = await page.evaluate(() =>
        [document.documentElement, document.body].map(
          (element) => getComputedStyle(element).backgroundColor,
        ),
      );

      assert.deepEqual(backgrounds, ["rgba(0, 0, 0, 0)", "rgba(0, 0, 0, 0)"]);
    }
  }

  // This transition uses Next's client router and page chunks, not a full reload.
  await page.goto(origin, { waitUntil: "networkidle" });
  await page.evaluate(() => {
    window.rendererNavigationMarker = true;
  });
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.waitForURL(`${origin}/SettingsPage/`);
  await page.locator(".settings-window").waitFor({ state: "visible" });

  assert.equal(await page.evaluate(() => window.rendererNavigationMarker), true);

  await page.goBack({ waitUntil: "networkidle" });
  await page.locator(".app-frame").waitFor({ state: "visible" });

  assert.deepEqual(
    errors,
    [],
    "Exported routes hydrate and navigate without runtime or asset errors",
  );
  console.log(
    "All six direct pages and the home entry hydrate; theme, fonts, region transparency, Settings navigation, and browser history pass.",
  );
} finally {
  await browser?.close();
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}
