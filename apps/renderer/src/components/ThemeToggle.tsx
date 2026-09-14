import { useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useTranslations } from "next-intl";
import { Button } from "@/components/Button";

const subscribe = () => () => {};

export function ThemeToggle() {
  const t = useTranslations("navigation");
  const { resolvedTheme, setTheme } = useTheme();

  // Local storage is unavailable during static rendering; keep hydration stable.
  const mounted = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );

  const dark = mounted && resolvedTheme === "dark";
  const label = t(dark ? "switchToLight" : "switchToDark");

  return (
    <Button
      className="header-settings header-theme-toggle"
      variant="ghost"
      size="icon"
      role="switch"
      aria-label={t("darkMode")}
      aria-checked={dark}
      title={label}
      disabled={!mounted}
      onClick={() => setTheme(dark ? "light" : "dark")}
    >
      {dark ? <Sun aria-hidden="true" size={16} /> : <Moon aria-hidden="true" size={16} />}
    </Button>
  );
}
