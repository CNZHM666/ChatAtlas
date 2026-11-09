// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { pageTheme, watchPageTheme } from "./page-theme";

afterEach(() => { for (const element of [document.documentElement, document.body]) { element.removeAttribute("class"); element.removeAttribute("style"); element.removeAttribute("data-theme"); element.removeAttribute("data-mode"); } });

it("reads the theme each AI site declares, its declaration before its colours", () => {
  expect(pageTheme()).toBe("light");
  document.documentElement.dataset.theme = "dark"; expect(pageTheme()).toBe("dark");
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.className = "dark"; expect(pageTheme()).toBe("dark");
  document.documentElement.className = "";
  document.body.className = "app dark-theme"; expect(pageTheme()).toBe("dark");
  document.body.className = "";
  document.documentElement.dataset.mode = "dark"; expect(pageTheme()).toBe("dark");
  document.documentElement.removeAttribute("data-mode");
  document.body.style.backgroundColor = "rgb(33, 33, 33)"; expect(pageTheme()).toBe("dark");
  document.documentElement.dataset.theme = "light"; expect(pageTheme()).toBe("light");
  // A class that merely contains the letters is no theme.
  document.documentElement.removeAttribute("data-theme"); document.body.removeAttribute("style");
  document.body.className = "darkened-overlay-hidden"; expect(pageTheme()).toBe("light");
});

it("calls back once the page switches theme", async () => {
  const seen: string[] = [];
  const stop = watchPageTheme(theme => seen.push(theme));
  document.documentElement.className = "dark";
  await new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
  expect(seen).toEqual(["dark"]);
  stop();
});
