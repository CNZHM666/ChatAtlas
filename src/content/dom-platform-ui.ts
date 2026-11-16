import type { ParsedChatMessage } from "./capture-adapter";
import { domMessageText } from "./dom-message-text";
import { DOM_TOOL_TRAFFIC } from "./dom-tool-traffic";
import { domUISnapshot } from "./dom-ui-snapshot";

const COMPONENTS = '[data-testid*="genui"],[data-testid*="widget"],[data-component-type="interactive"],[data-artifact-content],iframe,svg[role="img"]';
/** Capture visible component content across sites, without following iframe/artifact URLs or running scripts. */
export function domMessagePresentation(element: HTMLElement): { text: string; uiParts?: ParsedChatMessage["uiParts"] } {
  const components = [...element.querySelectorAll<HTMLElement>(COMPONENTS)].filter(node => !node.closest(`pre,code,[hidden],[aria-hidden="true"],${DOM_TOOL_TRAFFIC}`) && !node.parentElement?.closest(COMPONENTS));
  if (!components.length) return { text: domMessageText(element) };
  const copy = element.cloneNode(true) as HTMLElement;
  const originals = [...element.querySelectorAll("*")], clones = [...copy.querySelectorAll("*")];
  const uiParts: NonNullable<ParsedChatMessage["uiParts"]> = [];
  const nonce = `ATLAS_COMPONENT_${crypto.randomUUID()}_`;
  let retained = 0;
  for (const component of components.slice(0, 32)) {
    const clone = clones[originals.indexOf(component)]; if (!clone) continue;
    const snapshot = component.tagName === "IFRAME" ? { html: "", truncated: false } : domUISnapshot(component);
    const fallbackText = domMessageText(component);
    const raw = component.tagName === "IFRAME" ? JSON.stringify({ type: "interactive", title: component.title }) : JSON.stringify({ type: "html", text: snapshot.html });
    const truncated = snapshot.truncated || raw.length + retained > 200_000;
    const marker = document.createElement("span"); marker.textContent = `${nonce}${uiParts.length}_END\n${fallbackText}\n`;
    clone.replaceWith(marker);
    uiParts.push({ ordinal: 0, raw: truncated ? "" : raw, fallbackText, ...(truncated ? { truncated: true } : {}) });
    retained += truncated ? 0 : raw.length;
  }
  let text = domMessageText(copy);
  uiParts.forEach((part, index) => {
    const marker = `${nonce}${index}_END`, at = text.indexOf(marker);
    part.ordinal = text.slice(0, at).split("【原平台交互内容】").length - 1;
    text = text.replace(marker, "【原平台交互内容】");
  });
  return { text, uiParts };
}
