import { useCallback, useEffect, useRef, useState } from "react";
import type { CliSelection, CliState, CliToolId } from "@path/shared";
import { getDesktopApi } from "../lib/Desktop";

export function useCliTools() {
  const [state, setState] = useState<CliState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true),
    pending = useRef(false);

  const apply = useCallback((snapshot: CliState) => {
    if (mounted.current) {
      setState((current) =>
        !current || snapshot.revision >= current.revision ? snapshot : current,
      );
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    const api = getDesktopApi()?.cli;

    if (!api) return;
    const unsubscribe = api.onChanged(apply);

    void api
      .get()
      .then(apply)
      .catch(() => {
        if (mounted.current) setError("CLI connection unavailable");
      });

    return () => {
      mounted.current = false;
      unsubscribe();
    };
  }, [apply]);
  const run = useCallback(
    async (action: () => Promise<CliState>): Promise<boolean> => {
      if (pending.current) return false;
      pending.current = true;
      setBusy(true);
      setError(null);
      try {
        apply(await action());

        return true;
      } catch (error) {
        if (mounted.current) setError(error instanceof Error ? error.message : String(error));

        return false;
      } finally {
        pending.current = false;
        if (mounted.current) setBusy(false);
      }
    },
    [apply],
  );

  const refresh = useCallback(
    async (tool?: CliToolId, model?: string) => {
      const api = getDesktopApi()?.cli;

      return api ? run(() => api.refresh(tool ? { tool, model } : undefined)) : false;
    },
    [run],
  );

  async function connect(tool: CliToolId, connected: boolean) {
    const api = getDesktopApi()?.cli;

    return api ? run(() => api.connect({ tool, connected })) : false;
  }

  async function select(selection: CliSelection) {
    const api = getDesktopApi()?.cli;

    return api ? run(() => api.select(selection)) : false;
  }

  async function setMode(mode: "model" | "cli") {
    const api = getDesktopApi()?.cli;

    return api ? run(() => api.setMode({ mode })) : false;
  }

  async function openSettings() {
    await getDesktopApi()?.app.openSettings({ section: "cli" });
  }

  return { state, busy, error, refresh, connect, select, setMode, openSettings };
}
