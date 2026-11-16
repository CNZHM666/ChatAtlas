const properties = "display flex-direction flex-wrap align-items justify-content gap grid-template-columns padding margin border border-radius background-color color font-family font-size font-weight line-height text-align white-space box-shadow".split(" ");

/** Site-neutral visual state, bounded before computing styles. No host event handlers or network reads. */
export function domUISnapshot(source: HTMLElement): { html: string; truncated: boolean } {
  const original = [source, ...source.querySelectorAll<HTMLElement>("*")];
  if (original.length > 500) return { html: "", truncated: true };
  const copy = source.cloneNode(true) as HTMLElement, copies = [copy, ...copy.querySelectorAll<HTMLElement>("*")];
  original.forEach((node, index) => {
    const target = copies[index], styles = getComputedStyle(node);
    target.setAttribute("style", properties.map(property => {
      const value = styles.getPropertyValue(property);
      const columns = property === "grid-template-columns" && /^(?:[\d.]+px\s*)+$/u.test(value) ? value.trim().split(/\s+/u) : undefined;
      return `${property}:${columns?.length && columns.length <= 6 ? columns.map(column => `minmax(0,${Math.max(1, parseFloat(column))}fr)`).join(" ") : value}`;
    }).join(";") + ";min-width:0;max-width:100%");
    if (node instanceof HTMLInputElement) {
      target.setAttribute("value", node.type === "password" || node.type === "file" ? "" : node.value);
      target.toggleAttribute("checked", node.checked);
    } else if (node instanceof HTMLTextAreaElement) target.textContent = node.value;
    else if (node instanceof HTMLOptionElement) target.toggleAttribute("selected", node.selected);
    else if (node instanceof HTMLImageElement && node.currentSrc) target.setAttribute("src", node.currentSrc);
  });
  copy.querySelectorAll("script,iframe,object,embed").forEach(node => node.remove());
  return { html: copy.outerHTML, truncated: false };
}
