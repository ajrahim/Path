import { spawn } from "node:child_process";

const children = new Set();
let isShuttingDown = false;

async function rendererStatus() {
  // Reuse only a Path renderer; another application's open port is not a successful startup.
  try {
    const response = await fetch("http://127.0.0.1:3000", { signal: AbortSignal.timeout(1_500) });
    const body = await response.text();

    return response.ok && body.includes("<title>Path</title>") ? "path" : "occupied";
  } catch {
    return "available";
  }
}

function runWorkspace(workspace) {
  const child = spawn(`npm run dev -w ${workspace}`, {
    stdio: "inherit",
    shell: true,
    windowsHide: true,
  });

  children.add(child);

  // Treat either development process failing as a failure of the combined session.
  child.on("exit", (code) => {
    children.delete(child);
    if (!isShuttingDown && code !== 0) shutdown(code ?? 1);
  });

  return child;
}

function shutdown(exitCode = 0) {
  // Both a child exit and a terminal signal may request cleanup in the same session.
  if (isShuttingDown) return;
  isShuttingDown = true;
  for (const child of children) {
    child.kill("SIGTERM");
  }

  process.exitCode = exitCode;
}

const status = await rendererStatus();

if (status === "occupied") {
  console.error("Port 3000 is already used by another application. Stop it before starting Path.");
  process.exitCode = 1;
} else {
  if (status === "path") {
    console.log("Reusing the existing Path renderer at http://127.0.0.1:3000");
  } else {
    runWorkspace("@path/renderer");
  }

  runWorkspace("@path/desktop");

  process.on("SIGINT", () => shutdown(0));
  process.on("SIGTERM", () => shutdown(0));
}
