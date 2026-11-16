import { dilToken } from "./dil-source";
import { dilValue } from "./dil-values";

export interface DILNode { kind: "text" | "expression" | "element" | "each" | "if"; value: string; attributes?: Record<string, { value: string; expression: boolean }>; children: DILNode[]; alternate?: DILNode[] }
export interface DILDocument { nodes: DILNode[]; scope: Record<string, unknown>; setters: Record<string, string>; supported: boolean }

export function dilDocument(source: string): DILDocument {
  const result: DILDocument = { nodes: [], scope: Object.create(null), setters: Object.create(null), supported: true };
  const stack: Array<{ node: DILNode; list: DILNode[] }> = [];
  let list = result.nodes;
  if (source.length > 100_000) return { ...result, supported: false };
  for (let at = 0, count = 0; at < source.length;) {
    if (++count > 3000 || stack.length > 64) return { ...result, supported: false };
    const token = dilToken(source, at); if (!token) return { ...result, supported: false };
    at = token.end;
    if (token.type === "body") {
      const code = token.text.slice(6, -1).trim().replace(/;$/u, "");
      const state = /^const\s+\[\s*([\w$]+)\s*,\s*([\w$]+)\s*\]\s*=\s*(?:DIL|GenUI)\.useState\(([\s\S]*)\)$/u.exec(code);
      const constant = /^const\s+([\w$]+)\s*=\s*([\s\S]+)$/u.exec(code);
      if (state) { const value = dilValue(state[3], result.scope); if (value !== undefined) { result.scope[state[1]] = value; result.setters[state[2]] = state[1]; } }
      else if (constant) { const value = dilValue(constant[2], result.scope); if (value !== undefined) result.scope[constant[1]] = value; }
      continue;
    }
    if (token.type === "close-tag" || token.type === "close-block") {
      const parent = stack.pop(); if (!parent) return { ...result, supported: false };
      const name = token.type === "close-tag" ? token.name : token.text.slice(2, -1).trim();
      if (parent.node.value !== name && parent.node.kind !== name) return { ...result, supported: false };
      list = parent.list; continue;
    }
    if (token.type === "else-block") { const parent = stack.at(-1); if (parent?.node.kind !== "if" || token.text !== "{:else}") return { ...result, supported: false }; list = parent.node.alternate = []; continue; }
    if (token.type === "open-block") {
      const kind = token.text.startsWith("{#each") ? "each" : token.text.startsWith("{#if") ? "if" : undefined;
      if (!kind) return { ...result, supported: false };
      const node: DILNode = { kind, value: token.text.slice(kind === "each" ? 6 : 4, -1).trim(), children: [] };
      list.push(node); stack.push({ node, list }); list = node.children; continue;
    }
    if (token.type === "text" || token.type === "expr") { list.push({ kind: token.type === "text" ? "text" : "expression", value: token.type === "expr" ? token.text.slice(1, -1) : token.text, children: [] }); continue; }
    if (token.type === "open-tag" || token.type === "self-tag") {
      const attributes: NonNullable<DILNode["attributes"]> = Object.create(null);
      const raw = token.text.slice(token.name.length + 1).replace(/\/?\s*>$/u, "");
      let offset = 0;
      while (offset < raw.length) {
        const match = /^\s*([\w-]+)(?:\s*=\s*)?/u.exec(raw.slice(offset)); if (!match) break;
        offset += match[0].length; const name = match[1];
        if (!match[0].trimEnd().endsWith("=")) { attributes[name] = { value: "true", expression: true }; continue; }
        const value = dilToken(raw, offset);
        if (raw[offset] === "{" && value?.type === "expr") { attributes[name] = { value: value.text.slice(1, -1), expression: true }; offset = value.end; }
        else {
          const quoted = /^(?:"([^"\n]*)"|'([^'\n]*)')/u.exec(raw.slice(offset)); if (!quoted) break;
          attributes[name] = { value: quoted[1] ?? quoted[2], expression: false }; offset += quoted[0].length;
        }
      }
      const node: DILNode = { kind: "element", value: token.name, attributes, children: [] };
      list.push(node); if (token.type === "open-tag") { stack.push({ node, list }); list = node.children; }
    }
  }
  result.supported = stack.length === 0;
  return result;
}
