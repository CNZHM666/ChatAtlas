import type { Root, RootContent, TableCell } from "mdast";

const text = (node: { type: string; value?: string; children?: unknown[] }): string => node.type === "text" ? node.value ?? "" : (node.children ?? []).map(child => text(child as typeof node)).join("");
const normalize = (value: string) => value.normalize("NFKC").replace(/[\s\p{P}]/gu, "").toLowerCase();
const verdicts: Record<string, string> = { supported: "依据支持", unsupported: "依据不符", uncertain: "待核对", discussed: "讨论记录", proposal: "建议", superseded: "已替换" };
const concepts: Record<string, string> = { "physical validation": "实物验证", "procurement mvp": "采购最小方案" };
const setText = (cell: TableCell, value: string) => { cell.children = [{ type: "text", value }]; };
// Do not flatten a real link, code sample or formula into an apparently empty quote.
const plainCitation = (node: {type:string;children?:unknown[]}):boolean => ["blockquote","paragraph","text","strong","emphasis","delete","break"].includes(node.type) && (node.children??[]).every(child=>plainCitation(child as typeof node));
const emptyCitation = (node:RootContent) => node.type==="blockquote" && plainCitation(node) && /^(?:(?:引用来源|参考来源|证据来源|来源依据|原文依据|来源|引用|参考|证据|sources?|references?|citations?|evidence)\s*[:：]?)?[\s\p{P}\u200b-\u200d\ufeff]*$/iu.test(text(node).trim());

/** Presentation only. Personal articles, quotations, code and real comparison tables stay intact. */
export function readerKnowledgePresentation({ generated = false, zh = false }: { generated?: boolean; zh?: boolean } = {}) {
  return (tree: Root) => {
    if (!generated) return;
    const prose = normalize(tree.children.filter(node => node.type === "paragraph" || node.type === "heading" || node.type === "list").map(node => text(node)).join("\n"));
    tree.children = tree.children.flatMap((node): RootContent[] => {
      if(emptyCitation(node))return [];
      if (node.type !== "table" || node.children.length < 2) return [node];
      const headers = node.children[0].children.map(cell => text(cell).trim().toLowerCase());
      if (headers.length !== 3 || !/^(概念|结论|concept|claim)$/u.test(headers[0]) || !/^(状态|status|verification)$/u.test(headers[1]) || !/^(说明|解释|description|explanation)$/u.test(headers[2])) return [node];
      const rows = node.children.slice(1);
      if (rows.some(row => row.children.length !== 3 || !verdicts[text(row.children[1]).trim().toLowerCase()])) return [node];
      const allSupported = rows.every(row => text(row.children[1]).trim().toLowerCase() === "supported");
      if (allSupported && rows.every(row => normalize(text(row.children[2])).length >= 6 && prose.includes(normalize(text(row.children[2]))))) return [];
      if (zh) for (const row of rows) {
        const name = text(row.children[0]).trim().toLowerCase();
        if (concepts[name]) setText(row.children[0], concepts[name]);
        setText(row.children[1], verdicts[text(row.children[1]).trim().toLowerCase()]);
      }
      if (allSupported) {
        for (const row of node.children) row.children.splice(1, 1);
        node.align?.splice(1, 1);
      }
      node.data = { ...node.data, hProperties: { id: "atlas-knowledge-audit" } };
      return [node];
    });
  };
}
