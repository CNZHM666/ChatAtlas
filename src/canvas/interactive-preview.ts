import { rasterDataUrl } from "../shared/conversation-images";

export const INTERACTIVE_PREVIEW_CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; font-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'; object-src 'none'";

/** Complete HTML artifacts operate only in the manifest sandbox, without network or extension APIs. */
export function interactivePreviewDocument(source: string, language: string): string | undefined {
  if (language !== "html" || !source.trim() || source.length > 200_000) return;
  const template = document.createElement("template"); template.innerHTML = source;
  if (template.content.querySelectorAll("*").length > 2500 || !template.content.querySelector("div,section,article,p,table,svg,details,button,input,select,textarea")) return;
  template.content.querySelectorAll("iframe,object,embed,base,meta,link,template").forEach(node => node.remove());
  template.content.querySelectorAll("script").forEach(script => { if (script.hasAttribute("src") || script.type && !["text/javascript", "application/javascript", "module"].includes(script.type)) script.remove(); });
  const hasLocalScript = [...template.content.querySelectorAll("script")].some(script => script.textContent?.trim());
  for (const button of template.content.querySelectorAll("button")) {
    const target = button.getAttribute("aria-controls");
    const panel = target && template.content.getElementById(target);
    if (panel && (button.getAttribute("role") === "tab" || button.hasAttribute("aria-expanded"))) button.setAttribute("data-atlas-local-target", target!);
    else if (!hasLocalScript && !button.hasAttribute("onclick") && !(button.type === "reset" && button.closest("form"))) {
      button.disabled = true;
      button.title = "原平台操作未保存 / Original action unavailable";
    }
  }
  template.content.querySelectorAll("img").forEach(image => { if (!rasterDataUrl(image.getAttribute("src") ?? "")) image.removeAttribute("src"); image.removeAttribute("srcset"); });
  template.content.querySelectorAll("a,form").forEach(element => { element.removeAttribute("target"); if (element.tagName === "FORM") element.removeAttribute("action"); else if (!/^#[\w.-]*$/u.test(element.getAttribute("href") ?? "")) element.removeAttribute("href"); });
  const wrapper = document.createElement("div"); wrapper.append(template.content);
  const controls = `<script>document.addEventListener("click",function(event){const button=event.target.closest("[data-atlas-local-target]");if(!button)return;const panel=document.getElementById(button.dataset.atlasLocalTarget);if(!panel)return;event.preventDefault();if(button.getAttribute("role")==="tab"){const group=button.closest('[role="tablist"]');if(!group)return;group.querySelectorAll('[role="tab"][data-atlas-local-target]').forEach(function(tab){const active=tab===button;tab.setAttribute("aria-selected",String(active));const target=document.getElementById(tab.dataset.atlasLocalTarget);if(target)target.hidden=!active;});}else{const open=button.getAttribute("aria-expanded")!=="true";button.setAttribute("aria-expanded",String(open));panel.hidden=!open;}});</script>`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${INTERACTIVE_PREVIEW_CSP}"><meta name="referrer" content="no-referrer"><style>html{color-scheme:light dark}body{margin:0;padding:20px;font:15px/1.6 system-ui,sans-serif;overflow-wrap:anywhere}*{box-sizing:border-box;max-width:100%}svg,img{height:auto}pre{overflow:auto}button,input,select,textarea{font:inherit}button,summary{cursor:pointer}button:disabled{cursor:default;opacity:.55}</style></head><body>${wrapper.innerHTML}${controls}</body></html>`;
}
