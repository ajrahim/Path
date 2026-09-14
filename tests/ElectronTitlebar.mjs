import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { _electron as electron } from "playwright-core";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const desktopRequire = createRequire(new URL("../apps/desktop/package.json", import.meta.url));
const { PNG } = desktopRequire("pngjs");
const temporaryDirectory = await mkdtemp(join(tmpdir(), "path-titlebar-"));
const entry = join(temporaryDirectory, "main.cjs");
let application;

try {
  // Build only the window factory so this appearance check uses a disposable Electron profile.
  await build({
    stdin: {
      contents: `
        import { app } from 'electron';
        import { createMainWindow } from './apps/desktop/src/windows/MainWindow';
        app.setPath('userData', process.env.PATH_APP_APPEARANCE_DATA);
        app.whenReady().then(() => createMainWindow({
          preloadPath: undefined,
          rendererDirectory: '',
          rendererUrl: process.env.PATH_APP_RENDERER_URL,
        }));
        app.on('window-all-closed', () => app.quit());
      `,
      resolveDir: root,
      loader: "ts",
    },
    bundle: true,
    platform: "node",
    format: "cjs",
    external: ["electron"],
    outfile: entry,
  });

  application = await electron.launch({
    executablePath: desktopRequire("electron"),
    args: [entry],
    env: {
      ...process.env,
      PATH_APP_APPEARANCE_DATA: temporaryDirectory,
      PATH_APP_RENDERER_URL: process.env.PATH_APP_RENDERER_URL ?? "http://localhost:3001",
    },
  });
  const page = await application.firstWindow();

  await page.locator(".app-header").waitFor();

  // Check the renderer header before inspecting the separate native caption controls.
  const header = await page.locator(".app-header").evaluate((element) => ({
    background: getComputedStyle(element).backgroundColor,
    height: element.getBoundingClientRect().height,
  }));

  assert.equal(header.background, "rgb(24, 90, 189)");
  assert.equal(header.height, 52);

  if (process.platform === "win32") {
    // A browser screenshot omits native controls; capture the real window through Electron.
    const capture = await application.evaluate(async ({ BrowserWindow, desktopCapturer }) => {
      const window = BrowserWindow.getAllWindows()[0];

      window.focus();
      const [width, height] = window.getSize();
      const sources = await desktopCapturer.getSources({
        types: ["window"],
        thumbnailSize: { width, height },
      });

      const source = sources.find((candidate) => candidate.id === window.getMediaSourceId());

      if (!source || source.thumbnail.isEmpty()) {
        throw new Error("Native window capture is unavailable");
      }

      return { image: source.thumbnail.toPNG().toString("base64"), width };
    });

    const image = PNG.sync.read(Buffer.from(capture.image, "base64"));
    const scale = image.width / capture.width;
    let samples = 0;
    let blueSamples = 0;

    // Scale the caption-button sample area for display DPI and tolerate glyph-colored pixels.
    for (let row = Math.ceil(14 * scale); row < Math.floor(38 * scale); row++) {
      for (
        let column = Math.ceil(image.width - 128 * scale);
        column < image.width - 16 * scale;
        column++
      ) {
        const offset = (row * image.width + column) * 4;

        if (
          image.data[offset] < 80 &&
          image.data[offset + 1] < 140 &&
          image.data[offset + 2] > 140
        ) {
          blueSamples++;
        }

        samples++;
      }
    }

    assert.ok(
      samples > 0 && blueSamples / samples > 0.8,
      "Native caption control background must be Word blue",
    );

    // Save visual evidence only when the caller supplied an explicit output path.
    if (process.env.PATH_APP_APPEARANCE_SCREENSHOT) {
      await writeFile(
        process.env.PATH_APP_APPEARANCE_SCREENSHOT,
        Buffer.from(capture.image, "base64"),
      );
    }

    console.log(
      `Native caption background: ${((blueSamples / samples) * 100).toFixed(1)}% blue pixels.`,
    );
  }

  console.log("Title-bar appearance verified in an isolated Electron window.");
} finally {
  await application?.close();
  await rm(temporaryDirectory, { recursive: true, force: true });
}
