/** A local visual snapshot, not the provider's application runtime. */
export const UI_PREVIEW_CSP = "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src 'none'; connect-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'; object-src 'none'";
const tags = new Set("div span p br hr section article header footer main aside nav h1 h2 h3 h4 h5 h6 ul ol li dl dt dd strong b em i u s small sub sup blockquote pre code table thead tbody tfoot tr th td caption colgroup col figure figcaption details summary label input select option optgroup textarea button progress meter style svg g path rect circle ellipse line polyline polygon text tspan defs symbol use lineargradient radialgradient stop clippath mask title desc".split(" "));
const attributes = new Set("id class style title role aria-label aria-hidden viewbox width height x y x1 x2 y1 y2 cx cy r rx ry d points fill fill-rule fill-opacity stroke stroke-width stroke-linecap stroke-linejoin stroke-dasharray stroke-opacity opacity transform xmlns preserveaspectratio text-anchor dominant-baseline font-size font-family offset stop-color stop-opacity gradientunits gradienttransform clip-path mask colspan rowspan scope span open type min max step value checked selected disabled placeholder multiple rows cols for tabindex".split(" "));

export function uiPreviewDocument(source: string, language: string): string | undefined {
  if (!source.trim() || source.length > 100_000 || !["html", "svg", "xml"].includes(language)) return undefined;
  if (language !== "html" && !/^\s*(?:<\?xml[^>]*>\s*)?<svg\b/iu.test(source)) return undefined;
  // Template contents are inert, including images/iframes: even parsing must not
  // contact a source-supplied URL before the restrictive preview CSP takes effect.
  const template = document.createElement("template");
  template.innerHTML = source;
  const root = template.content;
  if (root.querySelectorAll("*").length > 2500) return undefined;
  for (const element of [...root.querySelectorAll("*")]) {
    const tag = element.tagName.toLocaleLowerCase();
    if (!tags.has(tag)) {
      if (["script", "iframe", "object", "embed", "template", "foreignobject", "meta", "link", "base", "audio", "video"].includes(tag)) element.remove();
      else element.replaceWith(...element.childNodes);
      continue;
    }
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLocaleLowerCase();
      // SVG references may address local geometry only; never load external images or documents.
      if ((name === "href" || name === "xlink:href") && tag === "use" && /^#[\w.-]+$/u.test(attribute.value)) continue;
      if (!attributes.has(name) || name.startsWith("on")) element.removeAttribute(attribute.name);
    }
    if (tag === "button") { element.setAttribute("type", "button"); element.setAttribute("disabled", ""); }
    if (["input", "select", "textarea"].includes(tag)) element.setAttribute("disabled", "");
  }
  if (!root.querySelector("div, section, article, p, h1, h2, h3, table, svg, ul, ol, details")) return undefined;
  const container = document.createElement("div");
  container.append(root);
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${UI_PREVIEW_CSP}"><meta name="referrer" content="no-referrer"><style>html{color-scheme:light dark}body{margin:0;padding:20px;font:15px/1.6 system-ui,sans-serif;overflow-wrap:anywhere}*{box-sizing:border-box;max-width:100%}svg{height:auto}pre{overflow:auto}button,input,select,textarea{font:inherit}details>summary{cursor:pointer}</style></head><body>${container.innerHTML}</body></html>`;
}
