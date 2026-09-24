import { useEffect, useRef, useSyncExternalStore } from "react";
import type { RefObject } from "react";

type SettingsSection = "general" | "storage" | "keys" | "prompts";

interface SettingsNavigation {
  contentRef: RefObject<HTMLDivElement | null>;
  activeSection: SettingsSection;
  setActiveSection(sectionId: SettingsSection): void;
}

function readSection(): SettingsSection {
  const section = window.location.hash.slice(1);

  return section === "storage" || section === "keys" || section === "prompts" ? section : "general";
}

function subscribe(listener: () => void): () => void {
  window.addEventListener("hashchange", listener);

  return () => window.removeEventListener("hashchange", listener);
}

/** Keeps section pages addressable from the sidebar, browser history, and native shortcuts. */
export function useSettingsNavigation(isLoading: boolean): SettingsNavigation {
  const activeSection = useSyncExternalStore(subscribe, readSection, () => "general" as const);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (contentRef.current) contentRef.current.scrollTop = 0;
  }, [activeSection, isLoading]);

  function setActiveSection(sectionId: SettingsSection): void {
    window.location.hash = sectionId;
  }

  return { contentRef, activeSection, setActiveSection };
}
