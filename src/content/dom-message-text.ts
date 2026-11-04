import { normalizeMessageText } from "./message-identity";

const OMIT = 'button,[role="button"],svg,script,style,nav,aside,textarea,input,[contenteditable="true"],[hidden],[aria-hidden="true"],[data-testid*="thinking"],.ds-think-content,.toolcall-container';
/** Extract saved discussion prose; never operate the page or execute supplied HTML. */
export function domMessageText(element: HTMLElement): string {
  const render = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
    if (!(node instanceof Element) || node.matches(OMIT)) return "";
    const tag = node.tagName.toLowerCase(), children = () => [...node.childNodes].map(render).join("");
    if (tag === "br") return "\n";
    if (tag === "pre") {
      const copy = node.cloneNode(true) as Element; copy.querySelectorAll(OMIT).forEach(child => child.remove());
      const code = copy.querySelector("code") ?? copy, text = code.textContent ?? "";
      const fence = "`".repeat(Math.max(2, ...Array.from(text.matchAll(/`+/gu), match => match[0].length)) + 1);
      const language = code.className.match(/language-([\w-]+)/u)?.[1] ?? "text";
      return `\n\n${fence}${language}\n${text}\n${fence}\n\n`;
    }
    if (tag === "code") { const text = children(), ticks = "`".repeat(Math.max(0, ...Array.from(text.matchAll(/`+/gu), match => match[0].length)) + 1); return `${ticks} ${text} ${ticks}`; }
    if (tag === "table") {
      const rows = [...node.querySelectorAll("tr")].map(row => [...row.children].filter(cell => /^(TH|TD)$/u.test(cell.tagName)).map(cell => render(cell).trim().replace(/\|/gu, "\\|").replace(/\n+/gu, "<br>")));
      if (!rows.length) return "";
      const width = Math.max(...rows.map(row => row.length)), line = (row: string[]) => `| ${Array.from({length: width}, (_, i) => row[i] ?? "").join(" | ")} |`;
      return `\n\n${[line(rows[0]), line(Array(width).fill("---")), ...rows.slice(1).map(line)].join("\n")}\n\n`;
    }
    const text = children();
    if (/^h[1-6]$/u.test(tag)) return `\n\n${"#".repeat(Number(tag[1]))} ${text.trim()}\n\n`;
    if (tag === "li") return `\n- ${text.trim()}`;
    if (tag === "a") { const href = node.getAttribute("href") ?? ""; return /^(https?:|mailto:)/iu.test(href) && text.trim() ? `[${text.trim()}](${href.replace(/\)/gu, "%29")})` : text; }
    if (tag === "blockquote") return `\n\n${text.trim().split("\n").map(line => `> ${line}`).join("\n")}\n\n`;
    if (/^(p|div|section|article|ul|ol)$/u.test(tag)) return `\n${text}\n`;
    return text;
  };
  return normalizeMessageText(render(element));
}
