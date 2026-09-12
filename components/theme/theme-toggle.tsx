"use client";

import { useTheme } from "@/lib/theme";
import { useHotkeys } from "react-hotkeys-hook";
import { Sun, Moon, MonitorPlay } from "@/lib/ui/icons";
import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n/IdiomaProvider";

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const t = useT();

  const cycle = () => {
    setTheme(theme === "light" ? "dark" : theme === "dark" ? "system" : "light");
  };

  useHotkeys("mod+shift+l", cycle, { preventDefault: true }, [theme]);

  const Icon = theme === "dark" ? Moon : theme === "system" ? MonitorPlay : Sun;

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={cycle}
      aria-label={`${t("Tema")}: ${t(theme === "light" ? "claro" : theme === "dark" ? "escuro" : "sistema")}. ${t("Cmd+Shift+L para alternar.")}`}
    >
      <Icon size={16} aria-hidden />
    </Button>
  );
}
