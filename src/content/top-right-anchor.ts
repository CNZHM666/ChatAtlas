/** Shared top-right toolbar anchoring guards for ChatGPT and multi-AI web chat hosts. */
export const EXCLUDED_TOOLBAR_ANCESTORS = [
  "nav",
  "aside",
  "article",
  "form",
  "[hidden]",
  '[aria-hidden="true"]',
  '[role="dialog"]',
  '[role="menu"]',
  '[role="tablist"]',
  '[role="radiogroup"]',
  "#stage-sidebar",
  "#stage-slideover-sidebar",
  '[data-testid="sidebar"]',
  "[data-message-author-role]",
  '[data-testid^="conversation-turn-"]',
  '[data-testid$="-message"]',
].join(", ");

export const EXCLUDED_TOOLBAR_CONTROLS = [
  ".atlas-navigator-trigger",
  '[role="tab"]',
  '[role="radio"]',
  '[role="switch"]',
  "[aria-selected]",
  "[aria-checked]",
  '[data-testid="model-switcher-dropdown-button"]',
  "#model-switcher-dropdown-button",
].join(", ");

/** Computes the minimum x-coordinate for a true top-right action, accounting for an open left sidebar shifting <main> right. */
export function topRightMinLeft(minLeftRatio = 0.62): number {
  const viewportMin = window.innerWidth * minLeftRatio;
  const main = document.querySelector<HTMLElement>("main");
  if (!main) return viewportMin;
  const rect = main.getBoundingClientRect();
  if (rect.width < 320 || rect.right <= rect.left) return viewportMin;
  const mainCenter = (rect.left + rect.right) / 2;
  return Math.max(viewportMin, mainCenter + Math.min(120, rect.width * 0.18));
}

/** True when a candidate lies inside the rightmost top-bar action cluster rather than a centered switcher. */
export function isInRightCluster(rect: DOMRect, maxRight: number, clusterSpan = 240): boolean {
  if (!rect.width || maxRight <= 0) return true;
  return maxRight - rect.right <= clusterSpan;
}

export function isHorizontalRow(element: HTMLElement): boolean {
  const style = getComputedStyle(element);
  if (/flex/u.test(style.display) && !/column|reverse/u.test(style.flexDirection)) return true;
  if (/grid/u.test(style.display) && style.gridAutoFlow.includes("column")) return true;
  return false;
}

/** Walks past single-child tooltip/popover wrappers so the trigger inserts into the real horizontal toolbar row. */
export function toolbarRowSibling(action: HTMLElement): HTMLElement | undefined {
  let node: HTMLElement | null = action;
  for (let depth = 0; depth < 3 && node?.parentElement; depth++) {
    const parent: HTMLElement = node.parentElement;
    if (parent === document.body || parent === document.documentElement) return undefined;
    if (isHorizontalRow(parent)) return node;
    const siblingElements = Array.from(parent.children).filter(child => !child.classList.contains("atlas-navigator-trigger"));
    if (siblingElements.length > 1) return undefined;
    node = parent;
  }
  return undefined;
}

/** Ensures an in-flow toolbar trigger stayed on the same horizontal row as its anchor rather than wrapping to a second line. */
export function isVerticallyAligned(buttonRect: DOMRect, anchorRect: DOMRect): boolean {
  if (!buttonRect.width || !buttonRect.height || !anchorRect.width || !anchorRect.height) return true;
  const buttonMid = buttonRect.top + buttonRect.height / 2;
  const anchorMid = anchorRect.top + anchorRect.height / 2;
  return Math.abs(buttonMid - anchorMid) <= 14;
}
