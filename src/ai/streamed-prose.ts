/** Read only section titles/bodies from a partial JSON response. Never render
 * the wire JSON, citations, reasoning or structural metadata as answer text. */
export function streamedSectionProse(input: string): string {
  const fields = streamedFields(input, path => path.length === 3 && path[0] === "sections" && typeof path[1] === "number" && ["title", "body"].includes(String(path[2])));
  const sections = new Map<number, { title?: string; body?: string }>();
  for (const {path,text} of fields) {
    const index = path[1] as number, section = sections.get(index) ?? {};
    section[path[2] as "title" | "body"] = text; sections.set(index, section);
  }
  return [...sections.values()].filter(section => section.body).map(section => `${section.title ? `### ${section.title}\n\n` : ""}${section.body}`).join("\n\n");
}

/** Sidecar previews expose prose only; source IDs remain private until verified. */
export function streamedAnswerProse(input: string): string {
  return streamedFields(input, path => path.length === 3 && path[0] === "answer" && typeof path[1] === "number" && path[2] === "text").map(field => field.text).join("\n\n");
}

function streamedFields(input: string, allowed: (path: Array<string | number>) => boolean) {
  let at = 0;
  const fields: Array<{path:Array<string | number>;text:string}> = [];
  const whitespace = () => { while (/\s/u.test(input[at] ?? "") && at < input.length) at++; };
  const string = () => {
    at++; let text = "";
    while (at < input.length) {
      const char = input[at++];
      if (char === '"') return { text, complete: true };
      if (char !== "\\") { text += char; continue; }
      const escape = input[at++];
      if (escape === "u") { const hex = input.slice(at, at + 4); if (!/^[a-f\d]{4}$/iu.test(hex)) break; text += String.fromCharCode(parseInt(hex, 16)); at += 4; }
      else { const decoded: Record<string, string> = { n: "\n", r: "\r", t: "\t", b: "\b", f: "\f", '"': '"', "\\": "\\", "/": "/" }; if (!(escape in decoded)) break; text += decoded[escape]; }
    }
    return { text, complete: false };
  };
  const value = (path: Array<string | number>, depth = 0): boolean => {
    if (depth > 32) return false;
    whitespace(); const char = input[at];
    if (char === '"') {
      const parsed = string();
      if (allowed(path)) fields.push({path,text:parsed.text});
      return parsed.complete;
    }
    if (char === "{") {
      at++; whitespace(); if (input[at] === "}") { at++; return true; }
      while (at < input.length) {
        whitespace(); if (input[at] !== '"') return false;
        const key = string(); if (!key.complete) return false;
        whitespace(); if (input[at++] !== ":" || !value([...path, key.text], depth + 1)) return false;
        whitespace(); const next = input[at++]; if (next === "}") return true; if (next !== ",") return false;
      }
    } else if (char === "[") {
      at++; whitespace(); if (input[at] === "]") { at++; return true; }
      for (let index = 0; at < input.length; index++) {
        if (!value([...path, index], depth + 1)) return false;
        whitespace(); const next = input[at++]; if (next === "]") return true; if (next !== ",") return false;
      }
    } else { const token = input.slice(at).match(/^(?:true|false|null|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/u)?.[0]; if (token) { at += token.length; return true; } }
    return false;
  };
  value([]);
  return fields;
}
