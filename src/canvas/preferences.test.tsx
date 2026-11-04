import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PreferencesProvider, usePreferences } from "./preferences";

function CurrentPreferences() {
  const { locale, theme } = usePreferences();
  return <span>{locale} / {theme}</span>;
}

afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.removeItem("atlas-locale"); localStorage.removeItem("atlas-theme"); });

describe("ChatAtlas preferences", () => {
  it("starts in English and light mode on a new install", () => {
    localStorage.removeItem("atlas-locale"); localStorage.removeItem("atlas-theme");
    render(<PreferencesProvider><CurrentPreferences /></PreferencesProvider>);
    expect(screen.getByText("en / light")).toBeVisible();
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("respects a user's saved language and theme", () => {
    localStorage.setItem("atlas-locale", "zh-CN"); localStorage.setItem("atlas-theme", "light");
    render(<PreferencesProvider><CurrentPreferences /></PreferencesProvider>);
    expect(screen.getByText("zh-CN / light")).toBeVisible();
  });
  it("starts in English even on a Chinese browser, preserving explicit choices", () => {
    vi.spyOn(navigator, "language", "get").mockReturnValue("zh-CN");
    localStorage.removeItem("atlas-locale");
    const { unmount } = render(<PreferencesProvider><CurrentPreferences /></PreferencesProvider>);
    expect(screen.getByText("en / light")).toBeVisible();
    unmount();
    localStorage.setItem("atlas-locale", "en");
    render(<PreferencesProvider><CurrentPreferences /></PreferencesProvider>);
    expect(screen.getByText("en / light")).toBeVisible();
  });
});
