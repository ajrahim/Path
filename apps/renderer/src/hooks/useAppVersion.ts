import { useEffect, useState } from "react";
import { getDesktopApi } from "../lib/Desktop";

export function useAppVersion(): string {
  const [version, setVersion] = useState("");

  useEffect(() => {
    let isMounted = true;
    const desktop = getDesktopApi();

    if (!desktop?.app?.getInfo) return;

    void desktop.app
      .getInfo()
      .then((info) => {
        if (isMounted && info?.version) {
          setVersion(info.version);
        }
      })
      .catch(() => {
        // Tolerates missing bridge or test harnesses without IPC stubs.
      });

    return () => {
      isMounted = false;
    };
  }, []);

  return version;
}
