const OUTSIDE = 'aside, nav, form, [id^="atlas-"], [class*="atlas-"]';

/** The page's own conversation scroller (reported in locate diagnostics): the tallest scrollable area that fills much of the window. */
export function conversationScroller(): HTMLElement {
  const candidates = Array.from(document.querySelectorAll<HTMLElement>("main, main *, body > div, body > div *"))
    .filter(element => !element.closest(OUTSIDE) && element.clientHeight > window.innerHeight * .4 && element.scrollHeight > element.clientHeight + 40 && /(auto|scroll)/u.test(getComputedStyle(element).overflowY));
  return candidates.sort((a, b) => b.scrollHeight - a.scrollHeight)[0] ?? document.scrollingElement as HTMLElement ?? document.documentElement;
}
