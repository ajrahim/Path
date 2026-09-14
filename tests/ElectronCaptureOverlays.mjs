import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { _electron as electron } from "playwright-core";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const desktopRequire = createRequire(new URL("../apps/desktop/package.json", import.meta.url));
const { PNG } = desktopRequire("pngjs");
const directory = await mkdtemp(join(tmpdir(), "path-overlays-"));
const entry = join(directory, "main.cjs");

// A known desktop color lets both capture paths distinguish transparency from black boxes.
const background = [32, 192, 96];
let application;

function assertColor(actual, expected, message) {
  // Native screenshot and video conversion can shift individual color channels slightly.
  assert.ok(
    actual.every((channel, index) => Math.abs(channel - expected[index]) <= 10),
    `${message}: expected ${expected}, received ${actual}`,
  );
}

async function capturePixel(point) {
  const capture = await application.evaluate(async ({ desktopCapturer, screen }) => {
    const display = screen.getPrimaryDisplay();
    const sources = await desktopCapturer.getSources({
      types: ["screen"],
      thumbnailSize: {
        width: Math.round(display.size.width * display.scaleFactor),
        height: Math.round(display.size.height * display.scaleFactor),
      },
    });

    const source = sources.find((candidate) => candidate.display_id === String(display.id));

    assertSource(source);
    function assertSource(candidate) {
      if (!candidate || candidate.thumbnail.isEmpty()) {
        throw new Error("Display capture unavailable");
      }
    }

    return { png: source.thumbnail.toPNG().toString("base64"), bounds: display.bounds };
  });

  // Test points use display coordinates; the captured bitmap may use a different pixel scale.
  const image = PNG.sync.read(Buffer.from(capture.png, "base64"));
  const column = Math.round((point.x * image.width) / capture.bounds.width);
  const row = Math.round((point.y * image.height) / capture.bounds.height);
  const offset = (row * image.width + column) * 4;

  return [...image.data.subarray(offset, offset + 3)];
}

async function paint(page) {
  // Give layout and the following paint a frame each before sampling the desktop.
  await page.evaluate(
    () =>
      new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
      }),
  );
}

try {
  // Exercise real overlay windows with a temporary profile and a controlled backdrop.
  await build({
    stdin: {
      contents: `
        import { app, BrowserWindow, screen } from 'electron';
        import { RegionSelector } from './apps/desktop/src/recording/RegionSelector';
        import { createRecordingToolbar, createRecorderPopover, createCaptureWorker } from './apps/desktop/src/windows/SupportWindows';
        app.setPath('userData', process.env.PATH_APP_OVERLAYS_DATA);
        app.whenReady().then(async () => {
          const target = { preloadPath: undefined, rendererDirectory: '', rendererUrl: process.env.PATH_APP_RENDERER_URL };
          const display = screen.getPrimaryDisplay();
          const backdrop = new BrowserWindow({ ...display.bounds, frame: false, show: false, backgroundColor: '#20c060' });
          await backdrop.loadURL('data:text/html,<body style="margin:0;background:rgb(32,192,96)"></body>');
          backdrop.setAlwaysOnTop(true, 'screen-saver');
          backdrop.show();
          globalThis.overlayTest = {
            backdrop,
            selector: new RegionSelector(target),
            createToolbar: () => createRecordingToolbar(target),
            createPopover: () => createRecorderPopover(target),
            worker: createCaptureWorker(target),
          };
        });
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
      PATH_APP_OVERLAYS_DATA: directory,
      PATH_APP_RENDERER_URL: process.env.PATH_APP_RENDERER_URL ?? "http://localhost:3000",
    },
  });
  const worker = await application.waitForEvent("window", {
    predicate: (page) => page.url().includes("/CapturePage/"),
  });

  // Subscribe before asking main to open the selector so a fast window cannot be missed.
  const regionPagePromise = application.waitForEvent("window", {
    predicate: (page) => page.url().includes("/RegionPage/"),
  });

  await application.evaluate(({ screen }) => {
    void globalThis.overlayTest.selector.select({
      sourceId: "native-test",
      displayId: String(screen.getPrimaryDisplay().id),
    });
  });
  const region = await regionPagePromise;

  await region.locator(".region-overlay").waitFor();

  // Transparent document roots are required for the native desktop to show through.
  const roots = await region.evaluate(() => [
    getComputedStyle(document.documentElement).backgroundColor,
    getComputedStyle(document.body).backgroundColor,
  ]);

  assert.deepEqual(roots, ["rgba(0, 0, 0, 0)", "rgba(0, 0, 0, 0)"]);

  await paint(region);

  // Match the overlay's 42% tint against the known backdrop before selecting a region.
  const dimmed = background.map((channel, index) =>
    Math.round(channel * 0.58 + [12, 14, 16][index] * 0.42),
  );

  assertColor(await capturePixel({ x: 250, y: 200 }), dimmed, "Desktop visible through dimming");

  // Drag a selection, then sample both sides of its edge to prove only its interior clears.
  await region.mouse.move(100, 100);
  await region.mouse.down();
  await region.mouse.move(500, 350, { steps: 8 });
  await region.mouse.up();
  await paint(region);

  assertColor(await capturePixel({ x: 250, y: 200 }), background, "Selection is undimmed");
  assertColor(await capturePixel({ x: 700, y: 200 }), dimmed, "Outside selection stays dimmed");

  await application.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows().find((candidate) =>
      candidate.webContents.getURL().includes("/RegionPage/"),
    );

    globalThis.overlayTest.selector.cancel(window.webContents.id);
  });

  console.log("Region picker: native transparency, clear selection, and outside dimming verified.");

  if (process.platform === "win32") {
    // Windows content protection must work for both desktop thumbnails and video frames.
    const source = await application.evaluate(async ({ desktopCapturer, screen }) => {
      const display = screen.getPrimaryDisplay();
      const sources = await desktopCapturer.getSources({
        types: ["screen"],
        thumbnailSize: { width: 0, height: 0 },
      });

      return {
        id: sources.find((candidate) => candidate.display_id === String(display.id)).id,
        bounds: display.bounds,
      };
    });

    for (const [factory, route] of [
      ["createToolbar", "/RecordingToolbarPage/"],
      ["createPopover", "/RecorderPage/"],
    ]) {
      const controlPromise = application.waitForEvent("window", {
        predicate: (page) => page.url().includes(route),
      });

      await application.evaluate(({ screen }, factoryName) => {
        const display = screen.getPrimaryDisplay();
        const control = globalThis.overlayTest[factoryName]();

        globalThis.overlayTest.control = control;
        control.setPosition(display.bounds.x + 200, display.bounds.y + 150);
        control.setAlwaysOnTop(true, "screen-saver");
        control.show();
      }, factory);
      const controlPage = await controlPromise;

      await controlPage.locator("main").waitFor();
      assert.equal(
        await application.evaluate(() => globalThis.overlayTest.control.isContentProtected()),
        true,
      );
      const point = { x: 320, y: 182 };

      // First prove the control is visible; otherwise exclusion could pass on the wrong pixel.
      for (const protectedValue of [false, true]) {
        await application.evaluate((_, value) => {
          globalThis.overlayTest.control.setContentProtection(value);
          globalThis.overlayTest.control.show();
          globalThis.overlayTest.control.moveTop();
        }, protectedValue);
        await paint(controlPage);

        const screenshotPixel = await capturePixel(point);
        const videoPixel = await worker.evaluate(
          async ({ source, point }) => {
            const stream = await navigator.mediaDevices.getUserMedia({
              audio: false,
              video: {
                mandatory: {
                  chromeMediaSource: "desktop",
                  chromeMediaSourceId: source.id,
                  maxFrameRate: 30,
                },
              },
            });

            const video = document.createElement("video");

            video.muted = true;
            video.srcObject = stream;

            try {
              await video.play();
              // Wait for decoded content rather than sampling an uninitialized video element.
              await new Promise((resolve) => video.requestVideoFrameCallback(resolve));

              const canvas = document.createElement("canvas");

              canvas.width = 1;
              canvas.height = 1;
              const context = canvas.getContext("2d");

              context.drawImage(
                video,
                (point.x * video.videoWidth) / source.bounds.width,
                (point.y * video.videoHeight) / source.bounds.height,
                1,
                1,
                0,
                0,
                1,
                1,
              );

              return [...context.getImageData(0, 0, 1, 1).data].slice(0, 3);
            } finally {
              stream.getTracks().forEach((track) => track.stop());
              video.srcObject = null;
            }
          },
          { source, point },
        );

        for (const [captureKind, pixel] of [
          ["screenshot", screenshotPixel],
          ["video", videoPixel],
        ]) {
          if (protectedValue) {
            assertColor(
              pixel,
              background,
              `${route} excluded from ${captureKind}, without a black box`,
            );
          } else {
            assert.ok(
              pixel.some((channel, index) => Math.abs(channel - background[index]) > 30),
              `${route} must be visible in ${captureKind} with protection disabled`,
            );
          }
        }
      }

      await application.evaluate(() => globalThis.overlayTest.control.destroy());
      console.log(
        `${route}: excluded from native screenshots and desktop video frames without a black box.`,
      );
    }
  } else {
    console.log("Capture exclusion pixel check is Windows-specific; skipped on this platform.");
  }
} finally {
  // Closing Electron releases native resources before removing its temporary profile.
  await application?.close();
  await rm(directory, { recursive: true, force: true });
}
