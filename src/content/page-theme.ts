/** Whether an AI website is showing its light or dark theme, so the ChatAtlas side panel can match it. Sites say it
 * differently: `data-theme="dark"` (ChatGPT), a `dark` / `dark-theme` class (Claude, Gemini, DeepSeek), `data-mode`,
 * `color-scheme`, or only a dark background. A theme the site declares outranks its colours. */
export type PageTheme = "light" | "dark";

const DARK_CLASS = /(?:^|[\s_-])dark(?:[\s_-]|$)|dark-?(?:theme|mode)|theme-?dark/iu;
const LIGHT_CLASS = /(?:^|[\s_-])light(?:[\s_-]|$)|light-?(?:theme|mode)|theme-?light/iu;

function darkBackground(element: Element | null | undefined): boolean {
  if (!element) return false;
  const match = getComputedStyle(element).backgroundColor.match(/rgba?\((\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,/\s]+([\d.]+))?\)/u);
  if (!match || Number(match[4] ?? 1) === 0) return false;
  const [r, g, b] = match.slice(1, 4).map(Number); return r * .2126 + g * .7152 + b * .0722 < 128;
}

/** The theme an element declares, if it declares one. */
function declared(element: Element | null | undefined): PageTheme | undefined {
  if (!element) return undefined;
  for (const name of ["data-theme", "data-mode", "data-color-mode", "data-color-scheme"]) {
    const value = element.getAttribute(name)?.toLowerCase();
    if (value === "dark" || value === "light") return value;
  }
  const classes = element.getAttribute("class") ?? "";
  if (DARK_CLASS.test(classes)) return "dark";
  if (LIGHT_CLASS.test(classes)) return "light";
  const scheme = (element as HTMLElement).style?.colorScheme?.trim();
  return scheme === "dark" || scheme === "light" ? scheme : undefined;
}

export function pageTheme(doc: Document = document): PageTheme {
  const said = declared(doc.documentElement) ?? declared(doc.body);
  if (said) return said;
  return darkBackground(doc.body) || darkBackground(doc.documentElement) || darkBackground(doc.querySelector("main")) ? "dark" : "light";
}

/** Calls back with the page's theme whenever it changes; returns a function that stops watching. */
export function watchPageTheme(onChange: (theme: PageTheme) => void, doc: Document = document): () => void {
  let last = pageTheme(doc), frame: number | undefined;
  const check = () => { frame = undefined; const next = pageTheme(doc); if (next !== last) { last = next; onChange(next); } };
  const schedule = () => { if (frame === undefined) frame = requestAnimationFrame(check); };
  const observer = new MutationObserver(schedule);
  const attributeFilter = ["class", "style", "data-theme", "data-mode", "data-color-mode", "data-color-scheme"];
  observer.observe(doc.documentElement, { attributes: true, attributeFilter });
  if (doc.body) observer.observe(doc.body, { attributes: true, attributeFilter });
  const media = window.matchMedia?.("(prefers-color-scheme: dark)");
  media?.addEventListener?.("change", schedule);
  return () => { observer.disconnect(); media?.removeEventListener?.("change", schedule); if (frame !== undefined) cancelAnimationFrame(frame); };
}
