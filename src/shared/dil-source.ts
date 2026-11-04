import { codeRanges } from "./conversation-text";

/** ChatGPT's interactive-component language ("DIL"): a `{@body …}` script, `{#if}`/`{#each}` blocks and a fixed set
 * of component tags. It is kept as source; Reader folds it into a readable card instead of printing code. */
const TAGS = ["grid", "grid-item", "AsyncImage", "box", "text", "row", "col", "icon", "segmented-control", "title", "badge", "button", "select", "pressable", "divider", "caption", "WritingBlock", "label", "spacer", "checkbox", "Cite", "Link", "textarea", "Entity", "input", "radio-group", "radio", "ContextBundle", "form", "CodeBlock", "list", "list-item", "slider"];
const TAG_NAME = new RegExp(`^<(/?)(${TAGS.join("|")})(?=[\\s/>])`, "u");
const START = new RegExp(`(^|\\n)[ \\t]*(?=\\{@body\\b|\\{#(?:if|each)\\b|<(?:${TAGS.join("|")})[\\s/>])`, "gu");
const ACTION_TAGS = new Set(["button", "pressable"]);

type Token =
  | { type: "body" | "open-block" | "else-block" | "close-block" | "expr"; start: number; end: number; text: string }
  | { type: "open-tag" | "close-tag" | "self-tag"; start: number; end: number; name: string; text: string }
  | { type: "text"; start: number; end: number; text: string };

/** The end of a balanced `{…}` starting at `start`, honouring quotes and template literals; -1 when unbalanced. */
function braceEnd(source: string, start: number): number {
  const stack: string[] = [];
  let quote = "";
  for (let index = start; index < source.length; index++) {
    const character = source[index], top = stack.at(-1);
    if (quote) { if (character === "\\") index++; else if (character === quote) quote = ""; continue; }
    if (top === "`") { if (character === "\\") index++; else if (character === "`") stack.pop(); else if (character === "$" && source[index + 1] === "{") { stack.push("{"); index++; } continue; }
    if (character === "\"" || character === "'") quote = character;
    else if (character === "`") stack.push("`");
    else if (character === "{") stack.push("{");
    else if (character === "}") { stack.pop(); if (!stack.length) return index + 1; }
  }
  return -1;
}

function tagEnd(source: string, start: number): number {
  for (let index = start; index < source.length; index++) {
    const character = source[index];
    if (character === "{") { const end = braceEnd(source, index); if (end < 0) return -1; index = end - 1; }
    else if (character === "\"" || character === "'") { const end = source.indexOf(character, index + 1); if (end < 0) return -1; index = end; }
    else if (character === ">") return index + 1;
  }
  return -1;
}

function token(source: string, at: number): Token | undefined {
  if (source[at] === "{") {
    const end = braceEnd(source, at);
    if (end < 0) return undefined;
    const text = source.slice(at, end);
    const type = text.startsWith("{@body") ? "body" : text.startsWith("{#") ? "open-block" : text.startsWith("{:") ? "else-block" : text.startsWith("{/") ? "close-block" : "expr";
    return { type, start: at, end, text };
  }
  const tag = TAG_NAME.exec(source.slice(at, at + 40));
  if (tag) {
    const end = tagEnd(source, at);
    if (end < 0) return undefined;
    const text = source.slice(at, end);
    return { type: tag[1] ? "close-tag" : /\/\s*>$/u.test(text) ? "self-tag" : "open-tag", start: at, end, name: tag[2], text };
  }
  let end = at + 1;
  while (end < source.length && source[end] !== "{" && !(source[end] === "<" && TAG_NAME.test(source.slice(end, end + 40)))) end++;
  return { type: "text", start: at, end, text: source.slice(at, end) };
}

/** Component source in a message: from a `{@body}`, block or component tag at a line start until every block and tag
 * it opened is closed and the next content is ordinary prose. Code fences are left alone. */
export function dilRanges(content: string): Array<{ start: number; end: number }> {
  if (!/\bDIL\.|\bGenUI\./u.test(content)) return [];
  const fenced = codeRanges(content), ranges: Array<{ start: number; end: number }> = [];
  START.lastIndex = 0;
  for (let match = START.exec(content); match; match = START.exec(content)) {
    const start = match.index + match[1].length + (/^[ \t]*/u.exec(content.slice(match.index + match[1].length))?.[0].length ?? 0);
    if (fenced.some(([from, to]) => start >= from && start < to) || ranges.some(range => start < range.end)) continue;
    let depth = 0, at = start, end = start, structural = 0, script = false;
    while (at < content.length) {
      let next = at;
      while (next < content.length && /\s/u.test(content[next])) next++;
      if (next >= content.length) break;
      const item = token(content, next);
      if (!item || depth === 0 && (item.type === "text" || item.type === "expr")) break;
      if (item.type === "open-block" || item.type === "open-tag") depth++;
      if (item.type === "close-block" || item.type === "close-tag") depth--;
      if (depth < 0) break;
      if (item.type === "body") script = true;
      if (item.type !== "text" && item.type !== "expr") structural++;
      end = at = item.end;
    }
    if (depth === 0 && structural >= 2 && (script || /\bDIL\.|\bGenUI\./u.test(content.slice(start, end)))) { ranges.push({ start, end }); START.lastIndex = end; }
  }
  return ranges;
}

export interface DILSummary { title?: string; items: string[]; actions: string[] }

/** What a reader can take from a component without running it: its title, the labelled options and data it lists,
 * and its actions. Expressions become "…", scripts are never executed. */
export function dilSummary(source: string): DILSummary {
  const items: string[] = [], actions: string[] = [], tags: string[] = [];
  let title: string | undefined, run: string[] = [];
  const clean = (value: string) => value.replace(/\s+/gu, " ").replace(/(?:…\s*){2,}/gu, "… ").trim();
  const meaningful = (value: string) => /[\p{L}\p{N}]/u.test(value.replace(/…/gu, ""));
  const add = (list: string[], value: string) => { const text = clean(value).slice(0, 140); if (meaningful(text) && !list.includes(text)) list.push(text); };
  const flush = () => {
    const text = clean(run.join(""));
    run = [];
    if (!meaningful(text)) return;
    if (tags.some(tag => ACTION_TAGS.has(tag))) add(actions, text);
    else if (tags.at(-1) === "title" && !title) title = text;
    else add(items, text);
  };
  for (let at = 0; at < source.length;) {
    const item = token(source, at);
    if (!item) break;
    if (item.type === "text") run.push(item.text);
    else if (item.type === "expr") run.push(" … ");
    else {
      flush();
      if (item.type === "body") {
        for (const data of item.text.matchAll(/\b(?:title|label|name)\s*:\s*"([^"\n]{1,80})"(?:\s*,\s*(?:detail|description|desc|subtitle|hint)\s*:\s*"([^"\n]{1,140})")?/gu)) add(items, data[2] ? `${data[1]} — ${data[2]}` : data[1]);
      } else if (item.type === "open-tag" || item.type === "self-tag") {
        for (const attribute of item.text.matchAll(/\b(?:title|label|placeholder|text|caption)="([^"\n]{1,80})"/gu)) add(ACTION_TAGS.has(item.name) ? actions : items, attribute[1]);
        if (item.type === "open-tag") tags.push(item.name);
      } else if (item.type === "close-tag") {
        const index = tags.lastIndexOf(item.name);
        if (index >= 0) tags.length = index;
      }
    }
    at = item.end;
  }
  flush();
  return { ...(title ? { title } : {}), items: items.slice(0, 12), actions: actions.slice(0, 6) };
}

/** Payload marker for a folded component segment, read back by the platform UI renderer. */
export const DIL_PAYLOAD = "atlas-dil";
export function dilPayload(raw: string): string | undefined {
  try { const value = JSON.parse(raw) as { type?: unknown; source?: unknown }; return value?.type === DIL_PAYLOAD && typeof value.source === "string" ? value.source : undefined; }
  catch { return undefined; }
}
