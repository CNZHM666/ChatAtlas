/** Locate an embedded JSON object without executing it or consuming following prose. */
function widgetJsonEnd(value: string, start: number): number | undefined {
  const stack: string[] = [];
  let quoted = false, escaped = false;
  for (let index = start; index < value.length; index++) {
    const character = value[index];
    if (quoted) { if (escaped) escaped = false; else if (character === "\\") escaped = true; else if (character === '"') quoted = false; continue; }
    if (character === '"') quoted = true;
    else if (character === "{" || character === "[") stack.push(character);
    else if (character === "}" || character === "]") {
      if (stack.pop() !== (character === "}" ? "{" : "[")) return undefined;
      if (!stack.length) return index + 1;
    }
  }
  return undefined;
}

export function codeRanges(value: string): Array<[number, number]> {
  const protectedRanges: Array<[number, number]> = [];
  let offset = 0, fence: { character: string; length: number; start: number } | undefined;
  for (const line of value.split(/(?<=\n)/u)) {
    const delimiter = /^ {0,3}(`{3,}|~{3,})/u.exec(line)?.[1];
    if (delimiter) {
      if (!fence) fence = { character: delimiter[0], length: delimiter.length, start: offset };
      else if (delimiter[0] === fence.character && delimiter.length >= fence.length) { protectedRanges.push([fence.start, offset + line.length]); fence = undefined; }
    } else if (!fence) {
      if (/^(?: {4}|\t)/u.test(line)) protectedRanges.push([offset, offset + line.length]);
      else for (const match of line.matchAll(/(`+)[^\n]*?\1/gu)) protectedRanges.push([offset + match.index!, offset + match.index! + match[0].length]);
    }
    offset += line.length;
  }
  if (fence) protectedRanges.push([fence.start, value.length]);
  return protectedRanges;
}

/** Platform citation IDs are not usable ChatAtlas references. Preserve literal code examples. */
export function withoutPlatformCitations(value: string): string {
  if (!/\uE200(?:filecite|cite|memcite|url)|(?:<|&lt;)Cite\b/u.test(value)) return value;
  const protectedRanges = codeRanges(value);
  const protectedAt = (offset: number) => protectedRanges.some(([from, to]) => offset >= from && offset < to);
  const pattern = /\uE200url\uE202([^\uE200\uE201]*)\uE201|\uE200(?:filecite|cite|memcite)(?:(?:\uE202[^\uE200\uE201]*)?\uE201|(?:\uE202[\w:.-]*)*(?=\s|$|[^\w:.\-\uE202\uE201]))|\\?(?:<|&lt;)Cite\s+refs=\{\[(?:\s*"turn[\w:.-]+"\s*,?)+\]\}\s*\/(?:>|&gt;)/gu;
  return value.replace(pattern, (token: string, urlPayload: string | undefined, offset: number) => {
    if (protectedAt(offset)) return token;
    // A platform source ID is not a URL. Keep the visible label without inventing a link.
    return urlPayload?.split("\uE202").filter(part => !/^turn[\w:.-]+$/u.test(part)).join(" · ") ?? "";
  });
}

export function platformWidgetRanges(value: string): Array<{ start: number; end: number; kind: string; payload: string }> {
  if (!value.includes("\uE200finance\uE202") && !value.includes("\uE200genui\uE202")) return [];
  const protectedRanges = codeRanges(value);
  const tokens = /\uE200(finance|genui)\uE202/gu;
  const ranges: ReturnType<typeof platformWidgetRanges> = [];
  let copied = 0;
  for (const match of value.matchAll(tokens)) {
    const start = match.index!;
    if (start < copied || protectedRanges.some(([from, to]) => start >= from && start < to)) continue;
    const payload = start + match[0].length;
    const jsonStart = payload + (value.slice(payload).match(/^\s*/u)?.[0].length ?? 0);
    const markerEnd = value.indexOf("\uE201", payload), nextMarker = value.indexOf("\uE200", payload);
    const boundedMarker = markerEnd >= 0 && (nextMarker < 0 || markerEnd < nextMarker);
    let end: number;
    if (match[1] === "genui" && ["{", "["].includes(value[jsonStart])) {
      const jsonEnd = widgetJsonEnd(value, jsonStart);
      end = jsonEnd !== undefined ? jsonEnd + (value[jsonEnd] === "\uE201" ? 1 : 0) : boundedMarker ? markerEnd + 1 : nextMarker >= 0 ? nextMarker : value.length;
    } else end = boundedMarker ? markerEnd + 1 : payload + (value.slice(payload).match(/^[\w-]+/u)?.[0].length ?? 0);
    ranges.push({ start, end, kind: match[1], payload: value.slice(payload, end).replace(/\uE201$/u, "") });
    copied = end;
  }
  return ranges;
}

function readableWidgets(value: string): string {
  let output = "", copied = 0;
  for (const range of platformWidgetRanges(value)) {
    output += value.slice(copied, range.start) + (range.kind === "finance" ? "【原平台行情图表】" : "【原平台交互内容】");
    copied = range.end;
  }
  return output + value.slice(copied);
}

/** Unsupported platform widgets have a readable placeholder; raw stored sources stay intact. */
export function readableConversationText(value: string, literalWidgets = false): string {
  return withoutPlatformCitations(literalWidgets ? unescapedPaste(value) : readablePlatformMarkup(readablePlatformLinks(readableWidgets(value))));
}

/** A pasted export the platform stored with escaped Markdown (`\#`, `\>`, `\*\*`, a trailing `\` per line) reads as
 * its Markdown again. Only clearly escaped text changes; ordinary messages with a stray backslash are left alone. */
function unescapedPaste(value: string): string {
  const escapes = value.match(/\\[#>*_`[\]-]|\\$/gmu)?.length ?? 0;
  if (escapes < 3) return value;
  return value.replace(/\\\r?\n/gu, "\n").replace(/\\$/gmu, "").replace(/\\([\\`*_{}[\]()#+\-.!>|~<])/gu, "$1");
}

/** Layout markup some ChatGPT exports keep in a reply: <box>, <row> and <text …> wrappers, and <Entity … value="…"/>
 * for a named thing. The words stay, the markup goes, and lines indented only by the wrappers lose the indent that
 * would show them as a code block. Fenced and inline code are left as they are; citations are removed elsewhere. */
const LAYOUT_TAG = /(?:<|&lt;)\/?(?:box|row|col|column|stack|text|card)\b[^<>\n]*?\/?(?:>|&gt;)/giu;
const ENTITY_TAG = /(?:<|&lt;)Entity\b[^<>\n]*?\bvalue\s*=\s*(?:"([^"]*)"|'([^']*)'|&quot;(.*?)&quot;)[^<>\n]*?\/?(?:>|&gt;)/gu;
export function readablePlatformMarkup(value: string): string {
  if (!/(?:<|&lt;)(?:\/?(?:box|row|col|column|stack|text|card)\b|Entity\b)/iu.test(value)) return value;
  const wrapped = new RegExp(LAYOUT_TAG.source, "iu").test(value);
  let fenced = false;
  return value.split("\n").map(line => {
    if (/^\s*(?:`{3,}|~{3,})/u.test(line)) { fenced = !fenced; return line; }
    if (fenced) return line;
    // Inline code spans (odd pieces between backticks) keep their text.
    const cleaned = line.split(/(`[^`]*`)/u).map((piece, index) => index % 2 ? piece : piece.replace(ENTITY_TAG, (_raw: string, a?: string, b?: string, c?: string) => a ?? b ?? c ?? "").replace(LAYOUT_TAG, "")).join("");
    return wrapped ? cleaned.replace(/^[ \t]{4,}/u, "") : cleaned;
  }).join("\n").replace(/\n{3,}/gu, "\n\n");
}

/** Render exported platform links without a DOM dependency or executable HTML. */
function readablePlatformLinks(value: string): string {
  if (!/(?:<|&lt;)Link\b/u.test(value)) return value;
  const protectedRanges = codeRanges(value);
  const decode = (text: string) => text.replace(/&(?:amp|quot|apos|lt|gt);|&#(?:34|39);/gu, entity => ({ "&amp;": "&", "&quot;": '"', "&apos;": "'", "&lt;": "<", "&gt;": ">", "&#34;": '"', "&#39;": "'" }[entity] ?? entity));
  return value.replace(/(?:<|&lt;)Link\b[^\n]*?\/(?:>|&gt;)/gu, (raw: string, offset: number) => {
    if (protectedRanges.some(([start, end]) => offset >= start && offset < end)) return raw;
    const attrs = new Map([...raw.matchAll(/([a-z]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|&quot;(.*?)&quot;)/giu)].map(match => [match[1].toLowerCase(), decode(match[2] ?? match[3] ?? match[4] ?? "")]));
    const url = attrs.get("url") ?? attrs.get("href") ?? "", label = attrs.get("title") ?? attrs.get("label") ?? url;
    const safeLabel = label.replace(/[\\[\]]/gu, "\\$&");
    if (!/^https?:\/\//iu.test(url) || Array.from(url).some(character => character.charCodeAt(0) < 32)) return safeLabel;
    try { new URL(url); } catch { return safeLabel; }
    return `[${safeLabel}](${url.replace(/[()\s<>]/gu, character => encodeURIComponent(character))})`;
  });
}

/** Some ChatGPT exports include an assistant search request as a JSON turn. It is not a reply. */
export function isInternalSearchQueryMessage(message: { role: string; content: string }): boolean {
  if (message.role === "user") return false;
  const content = message.content.trim().replace(/^```(?:json)?\s*\n?/u, "").replace(/\n?```$/u, "").trim();
  if (!content.startsWith("{")) return false;
  try {
    const value: unknown = JSON.parse(content);
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const record = value as Record<string, unknown>;
    return typeof record.query === "string" && Object.keys(record).every((key) => ["query", "response_length", "recency"].includes(key));
  } catch { return false; }
}

export function hasReadableMessageGap(messages: Array<{ messageIndex: number; role: string; content: string }>, previousIndex: number, nextIndex: number): boolean {
  const missing = nextIndex - previousIndex - 1;
  if (missing <= 0) return false;
  const skipped = messages.filter((message) => message.messageIndex > previousIndex && message.messageIndex < nextIndex);
  return skipped.length < missing || skipped.some((message) => !isInternalSearchQueryMessage(message));
}

/** Chat exports sometimes lose the backslashes around display-math brackets. */
export function renderableConversationText(value: string, literalWidgets = false): string {
  const lines = readableConversationText(value, literalWidgets).split(/(?<=\n)/u);
  let fence: { marker: string; length: number } | null = null;
  let prose = "";
  let result = "";
  const flush = () => {
    const replaceMath = (pattern: RegExp, format: (formula: string) => string) => {
      const protectedRanges = codeRanges(prose);
      prose = prose.replace(pattern, (match, formula: string, offset: number) => protectedRanges.some(([from, to]) => offset >= from && offset < to) ? match : format(formula));
    };
    replaceMath(/\\\[([\s\S]*?)\\\]/gu, formula => `\n\n$$\n${formula.trim()}\n$$\n\n`);
    replaceMath(/\\\(([^\n]+?)\\\)/gu, formula => `$${formula.trim()}$`);
    // Exporters and models often put both display delimiters on one line.
    // remark-math treats that as inline math unless each delimiter has its own line.
    replaceMath(/^[ \t]*\$\$([^\n]+?)\$\$[ \t]*$/gmu, formula => `$$\n${formula.trim()}\n$$`);
    replaceMath(/^\s*\[\s*([^\]\n]*\\[A-Za-z]+[^\]\n]*)\s*\]\s*$/gmu, formula => `\n$$\n${formula.trim()}\n$$\n`);
    result += prose;
    prose = "";
  };
  for (const line of lines) {
    const marker = /^\s*(`{3,}|~{3,})/u.exec(line)?.[1];
    if (marker) {
      if (!fence || fence.marker === marker[0] && marker.length >= fence.length) {
        flush();
        fence = fence ? null : { marker: marker[0], length: marker.length };
      }
    }
    if (fence || marker) result += line;
    else prose += line;
  }
  flush();
  return result;
}
