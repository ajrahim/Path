import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Captions, Check, ChevronDown, ListFilter, MousePointer2 } from "lucide-react";
import { useTranslations } from "next-intl";

type ActivityType = "all" | "clicks" | "speech";

export function ActivityTypeSelect({
  value,
  counts,
  onChange,
}: {
  value: ActivityType;
  counts: Record<ActivityType, number>;
  onChange(value: ActivityType): void;
}) {
  const t = useTranslations("recording");
  const id = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const initialFocus = useRef<"selected" | "last">("selected");
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const options = [
    { value: "all", label: t("filterAll"), Icon: ListFilter },
    { value: "clicks", label: t("filterClicks"), Icon: MousePointer2 },
    { value: "speech", label: t("filterSpeech"), Icon: Captions },
  ] as const;

  const selected = options.find((option) => option.value === value)!;
  const Icon = selected.Icon;

  function open() {
    const rect = triggerRef.current?.getBoundingClientRect();

    if (!rect) return;
    const menuHeight = options.length * 36 + 12;

    setPosition({
      top:
        rect.bottom + menuHeight + 12 <= window.innerHeight
          ? rect.bottom + 4
          : Math.max(8, rect.top - menuHeight - 4),
      left: Math.max(8, Math.min(rect.right - 184, window.innerWidth - 192)),
    });
  }

  function close() {
    setPosition(null);
    triggerRef.current?.focus();
  }

  useEffect(() => {
    if (!position) return;
    const items = menuRef.current?.querySelectorAll<HTMLButtonElement>("[role='menuitemradio']");
    const checked = menuRef.current?.querySelector<HTMLButtonElement>("[aria-checked='true']");

    (initialFocus.current === "last" ? items?.[items.length - 1] : checked)?.focus({
      preventScroll: true,
    });
    function dismiss(event: PointerEvent) {
      if (
        !menuRef.current?.contains(event.target as Node) &&
        !triggerRef.current?.contains(event.target as Node)
      ) {
        setPosition(null);
      }
    }

    function onMove(event: Event) {
      if (!(event.target instanceof Node) || !menuRef.current?.contains(event.target)) {
        setPosition(null);
      }
    }

    document.addEventListener("pointerdown", dismiss);
    window.addEventListener("resize", onMove);
    window.addEventListener("scroll", onMove, true);

    return () => {
      document.removeEventListener("pointerdown", dismiss);
      window.removeEventListener("resize", onMove);
      window.removeEventListener("scroll", onMove, true);
    };
  }, [position]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="activity-type-trigger"
        aria-label={t("filterActivity")}
        title={t("filterActivity")}
        aria-haspopup="menu"
        aria-expanded={Boolean(position)}
        aria-controls={position ? id : undefined}
        onClick={() => {
          initialFocus.current = "selected";
          if (position) setPosition(null);
          else open();
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            initialFocus.current = event.key === "ArrowUp" ? "last" : "selected";
            open();
          }
        }}
      >
        <Icon className="activity-filter-icon" size={16} aria-hidden="true" />
        <span>
          {selected.label} ({counts[value]})
        </span>
        <ChevronDown className="activity-filter-chevron" size={14} aria-hidden="true" />
      </button>
      {position &&
        createPortal(
          <div
            ref={menuRef}
            id={id}
            className="activity-type-menu"
            role="menu"
            aria-label={t("filterActivity")}
            style={position}
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget)) setPosition(null);
            }}
            onKeyDown={(event) => {
              const items = [
                ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
                  "[role='menuitemradio']",
                ),
              ];

              const index = items.indexOf(document.activeElement as HTMLButtonElement);
              let next = index;

              if (event.key === "ArrowDown") {
                next = (index + 1) % items.length;
              } else if (event.key === "ArrowUp") {
                next = (index - 1 + items.length) % items.length;
              } else if (event.key === "Home") {
                next = 0;
              } else if (event.key === "End") {
                next = items.length - 1;
              } else if (event.key === "Escape" || event.key === "Tab") {
                if (event.key === "Escape") event.preventDefault();
                event.stopPropagation();
                close();

                return;
              } else if (
                event.key.length === 1 &&
                event.key !== " " &&
                !event.ctrlKey &&
                !event.metaKey &&
                !event.altKey
              ) {
                const matching = [...items.slice(index + 1), ...items.slice(0, index + 1)].find(
                  (item) =>
                    item.textContent?.trim().toLowerCase().startsWith(event.key.toLowerCase()),
                );

                if (!matching) return;
                next = items.indexOf(matching);
              } else {
                return;
              }

              event.preventDefault();
              items[next]?.focus();
            }}
          >
            {options.map(({ value: optionValue, label, Icon: OptionIcon }) => (
              <button
                key={optionValue}
                type="button"
                role="menuitemradio"
                aria-checked={optionValue === value}
                tabIndex={-1}
                onClick={() => {
                  close();
                  onChange(optionValue);
                }}
              >
                <OptionIcon size={16} aria-hidden="true" />
                <span>
                  {label} ({counts[optionValue]})
                </span>
                {optionValue === value && (
                  <Check className="activity-filter-check" size={15} aria-hidden="true" />
                )}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
