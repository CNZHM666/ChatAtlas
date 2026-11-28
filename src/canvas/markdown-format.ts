export type MarkdownFormat = "heading" | "bold" | "italic" | "strike" | "link" | "image" | "bullet" | "ordered" | "task" | "quote" | "code" | "fence" | "table" | "rule";

interface FormattedMarkdown {
  body: string;
  selection: [number, number];
}

const inline = { bold: "**", italic: "*", strike: "~~", code: "`" };
const prefixes = { heading: "## ", bullet: "- ", ordered: "1. ", task: "- [ ] ", quote: "> " };
const lineMarker = /^(?:#{1,6}[ \t]+|>[ \t]+|[-*+][ \t]+(?:\[[ xX]\][ \t]+)?|\d+[.)][ \t]+)/u;

export function formatMarkdown(body: string, start: number, end: number, format: MarkdownFormat, zh: boolean): FormattedMarkdown {
  const selected = body.slice(start, end);
  const replace = (from: number, to: number, text: string, first: number, last = first): FormattedMarkdown => ({
    body: body.slice(0, from) + text + body.slice(to), selection: [from + first, from + last],
  });

  if (format === "bold" || format === "italic" || format === "strike" || format === "code") {
    const mark = inline[format];
    if (selected.length >= mark.length * 2 && selected.startsWith(mark) && selected.endsWith(mark)) {
      const unwrapped = selected.slice(mark.length, -mark.length);
      return replace(start, end, unwrapped, 0, unwrapped.length);
    }
    if (start >= mark.length && body.slice(start - mark.length, start) === mark && body.slice(end, end + mark.length) === mark) {
      return replace(start - mark.length, end + mark.length, selected, 0, selected.length);
    }
    return replace(start, end, mark + selected + mark, mark.length, mark.length + selected.length);
  }

  if (format === "link" || format === "image") {
    const label = selected || (format === "image" ? (zh ? "图片描述" : "Image description") : (zh ? "链接文字" : "Link text"));
    const prefix = format === "image" ? "![" : "[";
    const beforeUrl = prefix + label + "](";
    const url = "https://";
    return replace(start, end, beforeUrl + url + ")", beforeUrl.length, beforeUrl.length + url.length);
  }

  if (format === "heading" || format === "bullet" || format === "ordered" || format === "task" || format === "quote") {
    const from = start === 0 ? 0 : body.lastIndexOf("\n", start - 1) + 1;
    const next = body.indexOf("\n", Math.max(start, end - 1));
    const to = next === -1 ? body.length : next;
    const lines = body.slice(from, to).split("\n");
    const prefix = prefixes[format];
    const hasPrefix = (line: string) => {
      const trimmed = line.trimStart();
      if (format === "ordered") return /^\d+\.[ \t]/u.test(trimmed);
      if (format === "task") return /^-[ \t]+\[[ xX]\][ \t]/u.test(trimmed);
      return trimmed.match(lineMarker)?.[0] === prefix;
    };
    const remove = lines.every(line => !line.trim() || hasPrefix(line)) && lines.some(hasPrefix);
    let number = 1;
    const text = lines.map(line => {
      if (lines.length > 1 && !line.trim()) return line;
      const indent = line.match(/^[ \t]*/u)?.[0] ?? "";
      const content = line.slice(indent.length).replace(lineMarker, "");
      return indent + (remove ? "" : format === "ordered" ? `${number++}. ` : prefix) + content;
    }).join("\n");
    return replace(from, to, text, start === end ? text.length : 0, text.length);
  }

  const paddingBefore = start === 0 || body.slice(0, start).endsWith("\n\n") ? "" : body[start - 1] === "\n" ? "\n" : "\n\n";
  const paddingAfter = end === body.length || body.slice(end).startsWith("\n\n") ? "" : body[end] === "\n" ? "\n" : "\n\n";
  if (format === "fence") {
    const ticks = "`".repeat(Math.max(3, ...(selected.match(/`+/gu) ?? []).map(run => run.length + 1)));
    const contentStart = paddingBefore.length + ticks.length + 1;
    return replace(start, end, paddingBefore + ticks + "\n" + selected + "\n" + ticks + paddingAfter, contentStart, contentStart + selected.length);
  }
  if (format === "table") {
    const first = zh ? "列一" : "Column 1", second = zh ? "列二" : "Column 2";
    const table = `| ${first} | ${second} |\n| --- | --- |\n|     |     |`;
    const offset = paddingBefore.length + (selected ? selected.length + 2 : 0) + 2;
    return replace(start, end, paddingBefore + (selected ? selected + "\n\n" : "") + table + paddingAfter, offset, offset + first.length);
  }
  const rule = paddingBefore + (selected ? selected + "\n\n" : "") + "---" + (paddingAfter || "\n\n");
  return replace(start, end, rule, rule.length);
}
