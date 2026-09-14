import { useEffect } from "react";
import { getDesktopApi } from "@/lib/Desktop";
import { CaptureEngine } from "../lib/CaptureEngine";

/** The hidden capture route owns the engine and its IPC listeners for this window's lifetime. */
export default function CapturePage() {
  useEffect(() => {
    const desktop = getDesktopApi();

    if (!desktop) return;

    const engine = new CaptureEngine();
    const removeStartListener = desktop.capture.onStartRequested((input) => {
      void engine.start(input);
    });

    const removeStopListener = desktop.capture.onStopRequested(() => engine.stop());

    return () => {
      removeStartListener();
      removeStopListener();
      engine.stop();
    };
  }, []);

  return null;
}
