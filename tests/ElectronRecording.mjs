import { mkdtemp, rm, stat } from "node:fs/promises";
import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { _electron as electron } from "playwright-core";

const desktopRequire = createRequire(new URL("../apps/desktop/package.json", import.meta.url));
const electronPath = desktopRequire("electron");
const execFileAsync = promisify(execFile);
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const temporaryDirectory = await mkdtemp(join(tmpdir(), "path-recording-"));
let electronApp;

async function appWindow(pathname) {
  // Auxiliary windows navigate after creation, so match the loaded route with a bounded poll.
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const page = electronApp.windows().find((candidate) => {
      try {
        return new URL(candidate.url()).pathname === pathname;
      } catch {
        // A newly created window can still have an empty URL during navigation.
        return false;
      }
    });

    if (page) return page;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(`Electron route did not open: ${pathname}`);
}

async function finishedRecording(window, previousRecordingId = null) {
  // The main window minimizes during recording; use the supported runtime state
  // instead of a header selector that no longer represents capture progress.
  await window.waitForFunction(
    async (previousId) => {
      const state = await window.desktop?.recording.getState();

      return (
        state?.recordingId &&
        state.recordingId !== previousId &&
        ["preparing", "recording", "failed"].includes(state.status)
      );
    },
    previousRecordingId,
    // Animation frames may pause once the main window minimizes.
    { timeout: 15_000, polling: 100 },
  );
  const preparing = await window.evaluate(() => window.desktop?.recording.getState());

  if (!preparing?.recordingId) throw new Error("Preparing recording has no ID");
  const active = await waitForRecordingState(
    window,
    preparing.recordingId,
    ["recording", "failed"],
    20_000,
  );

  if (active.status !== "recording") {
    throw new Error(`Recording failed after preparation: ${JSON.stringify(active)}`);
  }

  // The minimum-duration guard must ignore an immediate stop without ending capture.
  const earlyStop = await window.evaluate(() => window.desktop?.recording.stop());

  if (earlyStop?.status !== "recording") {
    throw new Error(`Immediate stop request was not ignored: ${JSON.stringify(earlyStop)}`);
  }

  // A movable toolbar still needs a clickable, non-draggable stop button.
  const toolbar = await appWindow("/RecordingToolbarPage/");

  await toolbar.locator(".recording-toolbar").waitFor({ state: "visible", timeout: 10_000 });
  const dragRegion = await toolbar
    .locator(".recording-toolbar")
    .evaluate((element) => getComputedStyle(element).getPropertyValue("-webkit-app-region"));

  const stopRegion = await toolbar
    .locator(".recording-toolbar-stop")
    .evaluate((element) => getComputedStyle(element).getPropertyValue("-webkit-app-region"));

  if (dragRegion !== "drag" || stopRegion !== "no-drag") {
    throw new Error(`Invalid toolbar drag regions: ${dragRegion}/${stopRegion}`);
  }

  await assertRecordingWindowMode(true);

  // Leave enough time to collect one native click and usable media before stopping.
  await window.waitForTimeout(350);
  await nativeClick(window, active.recordingId);
  await window.waitForTimeout(2_150);
  await toolbar.locator(".recording-toolbar-stop").click();
  await waitForRecordingState(window, active.recordingId, ["processing", "failed"], 10_000);
  await assertRecordingWindowMode(false);

  const runtime = await waitForRecordingState(
    window,
    active.recordingId,
    ["ready", "failed"],
    20_000,
  );

  if (runtime?.status === "failed") {
    throw new Error(runtime.error ?? "Recording processing failed");
  }

  if (!runtime?.recordingId) {
    throw new Error("Recording completed without an ID");
  }

  return runtime;
}

async function assertRecordingWindowMode(recording) {
  // Check actual native visibility and placement, not only the renderer's state label.
  const state = await electronApp.evaluate(({ BrowserWindow, screen }) => {
    const windows = BrowserWindow.getAllWindows();
    const main = windows.find((candidate) => {
      try {
        return new URL(candidate.webContents.getURL()).pathname === "/";
      } catch {
        return false;
      }
    });

    const toolbar = windows.find((candidate) => {
      try {
        return new URL(candidate.webContents.getURL()).pathname === "/RecordingToolbarPage/";
      } catch {
        return false;
      }
    });

    if (!main || !toolbar) return null;
    const display = screen.getDisplayMatching(main.getBounds());

    return {
      platform: process.platform,
      mainMinimized: main.isMinimized(),
      mainVisible: main.isVisible(),
      toolbarVisible: toolbar.isVisible(),
      toolbarMovable: toolbar.isMovable(),
      toolbarBounds: toolbar.getBounds(),
      workArea: display.workArea,
    };
  });

  if (!state) throw new Error("Recording windows are unavailable");
  if (recording) {
    if (!state.mainMinimized || !state.toolbarVisible || !state.toolbarMovable) {
      throw new Error(`Invalid active recording windows: ${JSON.stringify(state)}`);
    }

    const rightGap =
      state.workArea.x + state.workArea.width - (state.toolbarBounds.x + state.toolbarBounds.width);

    const verticalGap =
      state.platform === "darwin"
        ? state.toolbarBounds.y - state.workArea.y
        : state.workArea.y +
          state.workArea.height -
          (state.toolbarBounds.y + state.toolbarBounds.height);

    if (Math.abs(rightGap - 16) > 2 || Math.abs(verticalGap - 16) > 2) {
      throw new Error(`Toolbar is incorrectly positioned: ${JSON.stringify(state)}`);
    }
  } else if (state.mainMinimized || !state.mainVisible || state.toolbarVisible) {
    throw new Error(`Invalid restored recording windows: ${JSON.stringify(state)}`);
  }
}

async function nativeClick(window, recordingId) {
  const recording = await window.evaluate(
    (id) => window.desktop?.recordings.get({ id }),
    recordingId,
  );

  const displayBounds = await electronApp.evaluate(({ screen }) => {
    return screen.getPrimaryDisplay().bounds;
  });

  // Target the captured area in global screen coordinates, including region offsets.
  const x = Math.round(
    recording?.captureRegion
      ? recording.captureRegion.x + recording.captureRegion.width / 2
      : displayBounds.x + displayBounds.width / 2,
  );

  const y = Math.round(
    recording?.captureRegion
      ? recording.captureRegion.y + recording.captureRegion.height / 2
      : displayBounds.y + displayBounds.height / 2,
  );

  // Browser-generated clicks do not exercise the global native input hook.
  const script = [
    'Add-Type -TypeDefinition \'using System; using System.Runtime.InteropServices; namespace PathTest { public static class NativeMouse { [DllImport("user32.dll")] public static extern bool SetCursorPos(int X,int Y); [DllImport("user32.dll")] public static extern void mouse_event(uint flags,uint dx,uint dy,uint data,UIntPtr extra); } }\';',
    `[PathTest.NativeMouse]::SetCursorPos(${x},${y}) | Out-Null;`,
    "[PathTest.NativeMouse]::mouse_event(2,0,0,0,[UIntPtr]::Zero);",
    "[PathTest.NativeMouse]::mouse_event(4,0,0,0,[UIntPtr]::Zero);",
  ].join(" ");

  await execFileAsync("powershell.exe", ["-NoProfile", "-Command", script]);
}

async function waitForRecordingState(window, recordingId, statuses, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  const observed = [];

  while (Date.now() < deadline) {
    const state = await window.evaluate(() => window.desktop?.recording.getState());

    if (state) {
      const signature = `${state.recordingId}:${state.status}`;

      // Keep transition history compact while retaining enough evidence to diagnose a timeout.
      if (observed.at(-1) !== signature) observed.push(signature);
      if (state.recordingId === recordingId && statuses.includes(state.status)) {
        return state;
      }
    }

    await window.waitForTimeout(100);
  }

  throw new Error(`Recording state timed out. Observed: ${observed.join(", ")}`);
}

async function verifyRecording(window, userData, runtime) {
  // Verify persisted history and media through the same controls used during review.
  const historyItem = window.locator(`.history-item[data-recording-id="${runtime.recordingId}"]`);

  await historyItem.waitFor({ state: "visible", timeout: 10_000 });
  await historyItem.locator(".history-item-main").click();
  const video = window.locator(`video[data-recording-id="${runtime.recordingId}"]`);

  await video.waitFor({ state: "visible", timeout: 10_000 });
  const videoPath = join(userData, "recordings", runtime.recordingId, "recording.mp4");
  const videoStats = await stat(videoPath);

  if (videoStats.size < 1_024) {
    throw new Error(`Recorded video is unexpectedly small: ${videoStats.size}`);
  }

  // A video element can exist before decoding starts; wait for metadata or a concrete failure.
  const mediaState = await video.evaluate(
    (element) =>
      new Promise((resolve) => {
        const snapshot = () => ({
          readyState: element.readyState,
          networkState: element.networkState,
          duration: element.duration,
          error: element.error
            ? { code: element.error.code, message: element.error.message }
            : null,
          currentSrc: element.currentSrc,
        });

        if (element.readyState >= HTMLMediaElement.HAVE_METADATA || element.error) {
          resolve(snapshot());

          return;
        }

        const finish = () => resolve(snapshot());

        element.addEventListener("loadedmetadata", finish, { once: true });
        element.addEventListener("error", finish, { once: true });
        setTimeout(finish, 10_000);
      }),
  );

  if (mediaState.readyState < 1) {
    // Separate range delivery failures from browser decoding failures in the diagnostic result.
    const responseProbe = await video.evaluate(async (element) => {
      const response = await fetch(element.src, { headers: { Range: "bytes=0-1023" } });
      const bytes = new Uint8Array(await response.arrayBuffer());

      return {
        status: response.status,
        contentType: response.headers.get("content-type"),
        contentRange: response.headers.get("content-range"),
        byteLength: bytes.byteLength,
        magic: [...bytes.slice(0, 8)],
      };
    });

    const blobProbe = await video.evaluate(async (element) => {
      const response = await fetch(element.src);
      const bytes = await response.arrayBuffer();
      const blobUrl = URL.createObjectURL(new Blob([bytes], { type: "video/mp4" }));
      const probe = document.createElement("video");

      probe.src = blobUrl;
      const result = await new Promise((resolve) => {
        const snapshot = () => ({
          readyState: probe.readyState,
          networkState: probe.networkState,
          duration: probe.duration,
          error: probe.error ? { code: probe.error.code, message: probe.error.message } : null,
          byteLength: bytes.byteLength,
        });

        probe.addEventListener("loadedmetadata", () => resolve(snapshot()), { once: true });
        probe.addEventListener("error", () => resolve(snapshot()), { once: true });
        setTimeout(() => resolve(snapshot()), 10_000);
      });

      URL.revokeObjectURL(blobUrl);

      return result;
    });

    throw new Error(
      `Recorded video did not load: ${JSON.stringify({ ...mediaState, responseProbe, blobProbe, videoBytes: videoStats.size })}`,
    );
  }

  // Native input is only useful if its click records and screenshot assets survive capture.
  const clicks = await window.evaluate(
    (recordingId) => window.desktop?.recordings.listClicks({ id: recordingId }),
    runtime.recordingId,
  );

  if (!clicks || clicks.length === 0) {
    throw new Error("No global mouse clicks were persisted");
  }

  const screenshotClick = clicks.find((click) => click.screenshotPath);

  if (!screenshotClick) {
    throw new Error("No click screenshot was persisted");
  }

  const screenshotUrl = await window.evaluate(
    (input) => window.desktop?.recordings.screenshotUrl(input),
    { recordingId: runtime.recordingId, clickId: screenshotClick.id },
  );

  if (!screenshotUrl) throw new Error("Click screenshot URL is unavailable");
  const screenshotProbe = await window.evaluate(async (url) => {
    const response = await fetch(url);
    const bytes = new Uint8Array(await response.arrayBuffer());

    return {
      status: response.status,
      contentType: response.headers.get("content-type"),
      byteLength: bytes.byteLength,
      magic: [...bytes.slice(0, 8)],
    };
  }, screenshotUrl);

  // Validate the PNG signature as well as its response headers and nonempty body.
  if (
    screenshotProbe.status !== 200 ||
    screenshotProbe.contentType !== "image/png" ||
    screenshotProbe.byteLength < 128 ||
    screenshotProbe.magic.join(",") !== "137,80,78,71,13,10,26,10"
  ) {
    throw new Error(`Invalid click screenshot: ${JSON.stringify(screenshotProbe)}`);
  }

  await window
    .locator(".timeline-click-markers button")
    .first()
    .waitFor({ state: "visible", timeout: 10_000 });
  await window.locator(".activity-entry").first().waitFor({ state: "visible", timeout: 10_000 });

  return {
    recordingId: runtime.recordingId,
    elapsedMs: runtime.elapsedMs,
    videoPath,
    videoBytes: videoStats.size,
    clickCount: clicks.length,
    screenshotBytes: screenshotProbe.byteLength,
  };
}

try {
  // Never run a capture test against the user's recordings, keys or preferences.
  electronApp = await electron.launch({
    executablePath: electronPath,
    args: [join(root, "apps/desktop")],
    cwd: root,
    env: {
      ...process.env,
      PATH_APP_USER_DATA: temporaryDirectory,
      PATH_APP_RENDERER_URL: process.env.PATH_APP_RENDERER_URL ?? "http://127.0.0.1:3000",
    },
  });
  await electronApp.firstWindow();
  const window = await appWindow("/");

  await window.waitForFunction(() => Boolean(window.desktop));
  const initialRuntime = await window.evaluate(() => window.desktop?.recording.getState());

  if (initialRuntime?.status !== "idle" || initialRuntime.recordingId !== null) {
    throw new Error(
      `Fresh application did not clear recording state: ${JSON.stringify(initialRuntime)}`,
    );
  }

  const userData = await electronApp.evaluate(({ app }) => app.getPath("userData"));

  if (resolve(userData) !== resolve(temporaryDirectory)) {
    throw new Error("Native recording test did not use its isolated profile");
  }

  // First exercise full-display capture with microphone input explicitly disabled.
  await window.getByRole("button", { name: "New recording" }).last().click();
  const source = window.locator(".source-tile").first();

  await source.waitFor({ state: "visible", timeout: 15_000 });
  await source.click();
  await window.getByRole("checkbox", { name: "Include microphone" }).uncheck();
  await window.getByRole("button", { name: "Start recording", exact: true }).click();
  const displayRuntime = await finishedRecording(window);
  const displayRecording = await verifyRecording(window, userData, displayRuntime);

  // Repeat through the region picker, requiring a distinct recording ID and persisted assets.
  await window.getByRole("button", { name: "New recording" }).last().click();
  await window.getByRole("button", { name: "Custom region" }).click();
  await window.locator(".source-tile").first().click();
  await window.getByRole("checkbox", { name: "Include microphone" }).uncheck();
  await window.getByRole("button", { name: "Start recording", exact: true }).click();
  const regionWindow = await appWindow("/RegionPage/");

  await regionWindow.mouse.move(100, 100);
  await regionWindow.mouse.down();
  await regionWindow.mouse.move(700, 500, { steps: 8 });
  await regionWindow.mouse.up();
  await regionWindow.getByRole("button", { name: "Use this region" }).click();
  const regionRuntime = await finishedRecording(window, displayRuntime.recordingId);
  const regionRecording = await verifyRecording(window, userData, regionRuntime);

  console.log(JSON.stringify({ displayRecording, regionRecording }, null, 2));
} finally {
  try {
    await electronApp?.close();
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true, maxRetries: 3 });
  }
}
