import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PreferencesProvider, usePreferences } from "./preferences";

function CurrentPreferences() {
  const { locale, theme } = usePreferences();
  return <span>{locale} / {theme}</span>;
}

afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.removeItem("atlas-locale"); localStorage.removeItem("atlas-theme"); });

describe("ChatAtlas preferences", () => {
  it("starts in Simplified Chinese and light mode on a new install", () => {
    localStorage.removeItem("atlas-locale"); localStorage.removeItem("atlas-theme");
    render(<PreferencesProvider><CurrentPreferences /></PreferencesProvider>);
    expect(screen.getByText("zh-CN / light")).toBeVisible();
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("respects a user's saved language and theme", () => {
    localStorage.setItem("atlas-locale", "en"); localStorage.setItem("atlas-theme", "dark");
    render(<PreferencesProvider><CurrentPreferences /></PreferencesProvider>);
    expect(screen.getByText("en / dark")).toBeVisible();
  });

  it("starts in Simplified Chinese regardless of browser language while preserving explicit English choice", () => {
    vi.spyOn(navigator, "language", "get").mockReturnValue("en-US");
    localStorage.removeItem("atlas-locale");
    const { unmount } = render(<PreferencesProvider><CurrentPreferences /></PreferencesProvider>);
    expect(screen.getByText("zh-CN / light")).toBeVisible();
    unmount();
    localStorage.setItem("atlas-locale", "en");
    render(<PreferencesProvider><CurrentPreferences /></PreferencesProvider>);
    expect(screen.getByText("en / light")).toBeVisible();
  });
});
