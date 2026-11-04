import type { Root, RootContent } from "mdast";
import type { VFile } from "vfile";
import { unified } from "unified";
import remarkParse from "remark-parse";

const parser = unified().use(remarkParse);

/** Repair quoted CJK emphasis within adjacent text / emphasis runs. Code,
 * math, links and escapes stay untouched. Temporary parser flanking markers
 * are removed from the AST before rendering; the saved source is unchanged. */
export function readerEmphasis() {
  return (tree: Root, file: VFile) => {
    const source = String(file.value);
    const removeMarkers = (node: RootContent) => {
      // Reparsed offsets are relative to the repaired run, not the stored source.
      delete node.position;
      if (node.type === "text") node.value = node.value.replace(/\uE000(?=[“《「『（])/gu, "").replace(/(?<=[”》」』）])\uE001/gu, "");
      if ("children" in node) node.children.forEach(child => removeMarkers(child as RootContent));
    };
    const visit = (parent: { children: RootContent[] }) => {
      const result: RootContent[] = [];
      for (let index = 0; index < parent.children.length; index++) {
        const node = parent.children[index];
        if (node.type !== "text" && node.type !== "strong") {
          if ("children" in node) visit(node as unknown as { children: RootContent[] });
          result.push(node);
          continue;
        }
        const start = index;
        while (["text", "strong"].includes(parent.children[index + 1]?.type)) index++;
        const run = parent.children.slice(start, index + 1);
        if (run[0].position?.start.offset === undefined || run.at(-1)?.position?.end.offset === undefined) { result.push(...run); continue; }
        const raw = source.slice(run[0].position?.start.offset, run.at(-1)?.position?.end.offset);
        const repaired = raw.replace(/\*\*([^*\n]+)\*\*/gu, (match, text: string) => text.trim() ? `**${text.trim()}**` : match)
          .replace(/\*\*([“《「『（][^*\n]+?[”》」』）])\*\*/gu, "**\uE000$1\uE001**");
        if (repaired === raw || raw.includes("\\*")) { result.push(...run); continue; }
        const block = parser.parse(repaired).children[0];
        if (block?.type !== "paragraph") { result.push(...run); continue; }
        block.children.forEach(child => removeMarkers(child));
        result.push(...block.children);
      }
      parent.children = result;
    };
    visit(tree);
  };
}
