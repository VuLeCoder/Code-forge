"use client";

import { useSyncExternalStore } from "react";

type Theme = "light" | "dark";

const storageKey = "code-forge-theme";
const themeChangeEvent = "code-forge-theme-change";

function systemTheme(): Theme {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function savedTheme(): Theme | null {
  const value = window.localStorage.getItem(storageKey);
  return value === "light" || value === "dark" ? value : null;
}

function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  window.dispatchEvent(new Event(themeChangeEvent));
}

function currentTheme(): Theme {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

function subscribe(onThemeChange: () => void) {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const handleSystemChange = (event: MediaQueryListEvent) => {
    if (savedTheme()) return;
    applyTheme(event.matches ? "dark" : "light");
  };
  const handleStorageChange = (event: StorageEvent) => {
    if (event.key !== storageKey) return;
    applyTheme(savedTheme() ?? systemTheme());
  };
  window.addEventListener(themeChangeEvent, onThemeChange);
  window.addEventListener("storage", handleStorageChange);
  media.addEventListener("change", handleSystemChange);
  return () => {
    window.removeEventListener(themeChangeEvent, onThemeChange);
    window.removeEventListener("storage", handleStorageChange);
    media.removeEventListener("change", handleSystemChange);
  };
}

export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, currentTheme, () => "light");

  const nextTheme = theme === "dark" ? "light" : "dark";

  return <button
    className="themeToggle"
    type="button"
    aria-label={`Chuyển sang giao diện ${nextTheme === "dark" ? "tối" : "sáng"}`}
    title={`Chuyển sang giao diện ${nextTheme === "dark" ? "tối" : "sáng"}`}
    aria-pressed={theme === "dark"}
    onClick={() => {
      window.localStorage.setItem(storageKey, nextTheme);
      applyTheme(nextTheme);
    }}
  >
    <svg className="themeIcon themeIconMoon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 15.2A8.5 8.5 0 0 1 8.8 4a8.5 8.5 0 1 0 11.2 11.2Z" /></svg>
    <svg className="themeIcon themeIconSun" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3.5" /><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4m10.6 10.6 1.4 1.4m0-13.4-1.4 1.4M6.7 17.3l-1.4 1.4" /></svg>
  </button>;
}
