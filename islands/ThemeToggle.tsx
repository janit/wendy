import { useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";

export default function ThemeToggle() {
  const isDark = useSignal(true);

  useEffect(() => {
    const saved = localStorage.getItem("wendy-theme");
    if (saved) {
      isDark.value = saved === "dark";
    } else {
      isDark.value = !window.matchMedia("(prefers-color-scheme: light)").matches;
    }
    applyTheme(isDark.value);
  }, []);

  function toggle() {
    isDark.value = !isDark.value;
    localStorage.setItem("wendy-theme", isDark.value ? "dark" : "light");
    applyTheme(isDark.value);
  }

  function applyTheme(dark: boolean) {
    document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
  }

  return (
    <button class="theme-toggle" onClick={toggle} aria-label="Toggle theme">
      <span class="theme-toggle-knob" />
    </button>
  );
}
