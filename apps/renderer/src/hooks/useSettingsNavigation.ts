import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";

interface SettingsNavigation {
  contentRef: RefObject<HTMLDivElement | null>;
  activeSection: string;
  setActiveSection(sectionId: string): void;
}

/** Tracks the visible settings section across the window and panel scrolling layouts. */
export function useSettingsNavigation(isLoading: boolean): SettingsNavigation {
  const [activeSection, setActiveSection] = useState("general");
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isLoading) return;

    const content = contentRef.current;

    if (!content) return;

    const sections = Array.from(content.querySelectorAll<HTMLElement>(".settings-section"));
    let frame = 0;

    function updateActiveSection(): void {
      if (!content) return;

      const hasInnerScroll = getComputedStyle(content).overflowY === "auto";
      const scrollTop = hasInnerScroll ? content.scrollTop : window.scrollY;
      const isAtBottom = hasInnerScroll
        ? content.scrollTop + content.clientHeight >= content.scrollHeight - 2
        : window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2;

      const threshold = Math.max(52, content.getBoundingClientRect().top) + 48;
      // The last section may never cross the heading threshold on a short viewport.
      const current =
        scrollTop > 0 && isAtBottom
          ? sections.at(-1)
          : (sections
              .filter((section) => section.getBoundingClientRect().top <= threshold)
              .at(-1) ?? sections[0]);

      if (current) setActiveSection(current.id);
    }

    function scheduleUpdate(): void {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(updateActiveSection);
    }

    const observer = new ResizeObserver(scheduleUpdate);

    observer.observe(content);
    sections.forEach((section) => observer.observe(section));
    content.addEventListener("scroll", scheduleUpdate, { passive: true });
    window.addEventListener("scroll", scheduleUpdate, { passive: true });
    window.addEventListener("resize", scheduleUpdate);
    window.addEventListener("hashchange", scheduleUpdate);
    scheduleUpdate();

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      content.removeEventListener("scroll", scheduleUpdate);
      window.removeEventListener("scroll", scheduleUpdate);
      window.removeEventListener("resize", scheduleUpdate);
      window.removeEventListener("hashchange", scheduleUpdate);
    };
  }, [isLoading]);

  return { contentRef, activeSection, setActiveSection };
}
