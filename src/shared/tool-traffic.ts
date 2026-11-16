import { codeRanges } from "./markdown-code-ranges";

export const TOOL_PART_TYPES = new Set(["tool_call", "tool_calls", "tool_use", "tool_result", "function_call", "function_result", "execution_output"]);

/** Strict transport envelopes, not shell commands or ordinary technical examples. */
function toolEnvelope(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>, keys = Object.keys(item);
  if (TOOL_PART_TYPES.has(String(item.type)) && (item.name || item.tool_use_id || item.call_id)) return true;
  if (typeof item.path === "string" && /^\/(?:files|web|browser|terminal|shell|python|computer|search)\/[\w-]+$/u.test(item.path) && item.args && typeof item.args === "object" && keys.every(key => ["path", "args"].includes(key))) return true;
  if (typeof item.recipient_name === "string" && item.parameters && typeof item.parameters === "object" && keys.every(key => ["recipient_name", "parameters", "id", "type"].includes(key))) return true;
  return false;
}

/** Source offsets survive filtering, so references still locate the original paragraph. */
export function toolProtocolRanges(content: string): Array<{ start: number; end: number }> {
  if (!/"(?:path|recipient_name|tool_use_id|call_id)"\s*:/u.test(content)) return [];
  const protectedRanges = codeRanges(content), ranges: Array<{ start: number; end: number }> = [];
  for (const match of content.matchAll(/(?:^|\n)[ \t]*(?=\{)/gu)) {
    const start = match.index! + match[0].length;
    if (ranges.some(range => start < range.end) || protectedRanges.some(([from, to]) => start >= from && start < to)) continue;
    let depth = 0, quoted = false, escaped = false;
    for (let at = start; at < Math.min(content.length, start + 200_000); at++) {
      const character = content[at];
      if (quoted) { if (escaped) escaped = false; else if (character === "\\") escaped = true; else if (character === '"') quoted = false; continue; }
      if (character === '"') quoted = true;
      else if (character === "{") depth++;
      else if (character === "}" && --depth === 0) {
        try { if (toolEnvelope(JSON.parse(content.slice(start, at + 1)))) ranges.push({ start, end: at + 1 }); } catch { /* Unrecognized text remains visible. */ }
        break;
      }
    }
  }
  return ranges;
}

export function isToolTrafficMessage(message: { role: string; content: string; contentKind?: string }): boolean {
  if (message.role === "user") return false;
  if (message.contentKind === "tool") return true;
  const ranges = toolProtocolRanges(message.content);
  if (!ranges.length) return false;
  let rest = message.content;
  for (const range of ranges.reverse()) rest = rest.slice(0, range.start) + rest.slice(range.end);
  return !rest.trim();
}
