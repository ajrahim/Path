import { useState, useSyncExternalStore } from "react";

const ONBOARDING_STORAGE_KEY = "path.onboarding";
const ONBOARDING_COMPLETE = "complete";

interface Onboarding {
  isOpen: boolean;
  complete(): void;
}

function subscribeToStorage(listener: () => void): () => void {
  window.addEventListener("storage", listener);

  return () => window.removeEventListener("storage", listener);
}

function readIsComplete(): boolean {
  return window.localStorage.getItem(ONBOARDING_STORAGE_KEY) === ONBOARDING_COMPLETE;
}

// The static export renders without storage; treat it as complete so no dialog is pre-rendered.
function readServerIsComplete(): boolean {
  return true;
}

/**
 * First-run carousel visibility. Completion lives in renderer storage, which the app data reset
 * clears, so a fresh installation and a reset both show the carousel again.
 */
export function useOnboarding(): Onboarding {
  const isComplete = useSyncExternalStore(subscribeToStorage, readIsComplete, readServerIsComplete);

  // Dismissal also closes the carousel for this session when storage refuses the write.
  const [isDismissed, setIsDismissed] = useState(false);

  function complete(): void {
    setIsDismissed(true);

    try {
      window.localStorage.setItem(ONBOARDING_STORAGE_KEY, ONBOARDING_COMPLETE);
    } catch (error) {
      console.error("Failed to store onboarding completion", error);
    }
  }

  return { isOpen: !isComplete && !isDismissed, complete };
}
