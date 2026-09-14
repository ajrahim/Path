import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Provider } from "react-redux";
import { getDesktopApi } from "@/lib/Desktop";
import { connectRecordingBridge } from "../state/RecordingBridge";
import { createRendererStore } from "../state/RendererStore";

export function RendererProvider({
  children,
  hasRecordingControls,
}: {
  children: ReactNode;
  hasRecordingControls: boolean;
}) {
  // Each window/server render owns a separate store; only Electron shares runtime state.
  const [store] = useState(createRendererStore);

  useEffect(() => {
    // Static route metadata keeps auxiliary windows disconnected even during initial hydration.
    if (!hasRecordingControls) return;

    return connectRecordingBridge(store, getDesktopApi());
  }, [hasRecordingControls, store]);

  return <Provider store={store}>{children}</Provider>;
}
