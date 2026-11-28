type MdNode = {
  type?: string;
  value?: string;
  align?: Array<string | null>;
  children?: MdNode[];
  data?: { hName?: string };
};

const INLINE_STATUS_RE =
  /(?:[ \t]*)(?:〔\s*(?:AI\s*建议|建议|已定|未定|此前)(?:\s*[·•]\s*[^〕]{1,24})?\s*〕|\[\s*(?:Proposal|AI\s+suggestion|Decided|Open|Earlier)\s*\])(?=$|[\s。；;，,）)])/giu;

const META_STATUS_HEADER_RE = /^(?:状态|来源状态|当前状态|status|state)$/iu;
const META_STATUS_CELL_RE =
  /^(?:分析报告|开放计划|提案|建议|AI\s*建议|讨论中|讨论记录|发起人提出|待回答|待确认|待定|未定|暂未定|已替换|草案|analysis\s*report|open\s*plan|proposal|proposed|ai\s*suggestion|discussed|author\s*proposal|open\s*question|pending|tbd|draft|superseded)$/iu;

const SKIP_CONTAINER_TYPES = new Set([
  "code",
  "inlineCode",
  "blockquote",
  "link",
  "heading",
  "atlas-wiki-flow",
  "atlas-table-heading",
]);

function plainTextOf(node: MdNode | undefined): string {
  if (!node) return "";
  if (typeof node.value === "string") return node.value;
  return (node.children ?? []).map(plainTextOf).join("");
}

function stripMetaStatusColumn(table: MdNode) {
  const rows = table.children;
  if (!Array.isArray(rows) || rows.length < 2) return;
  const headers = rows[0]?.children ?? [];
  if (headers.length < 3) return;
  const lastIdx = headers.length - 1;
  if (!META_STATUS_HEADER_RE.test(plainTextOf(headers[lastIdx]).trim())) return;
  let nonEmpty = 0;
  for (let r = 1; r < rows.length; r++) {
    const cell = rows[r]?.children?.[lastIdx];
    const value = plainTextOf(cell).trim();
    if (!value) continue;
    nonEmpty += 1;
    if (!META_STATUS_CELL_RE.test(value)) return;
  }
  if (!nonEmpty) return;
  for (const row of rows) {
    if (Array.isArray(row.children) && row.children.length > lastIdx) {
      row.children.splice(lastIdx, 1);
    }
  }
  if (Array.isArray(table.align) && table.align.length > lastIdx) {
    table.align.splice(lastIdx, 1);
  }
}

/**
 * Presentation cleanup for generated prose:
 * 1. Hides residual raw trailing status annotations like `〔建议〕` or `[Proposal]`.
 * 2. Hides redundant trailing meta-provenance `状态`/`Status` columns (e.g. `分析报告`, `开放计划`, `提案`)
 *    from previously generated comparison tables while preserving real business status columns.
 */
export function readerInlineStatusPresentation({ enabled }: { zh?: boolean; enabled: boolean }) {
  return (tree: MdNode) => {
    if (!enabled) return;
    const visit = (node: MdNode) => {
      if (node.type && SKIP_CONTAINER_TYPES.has(node.type)) return;
      if (node.data?.hName && SKIP_CONTAINER_TYPES.has(node.data.hName)) return;
      if (node.type === "table") stripMetaStatusColumn(node);
      if (!Array.isArray(node.children)) return;
      for (const child of node.children) {
        if (child.type === "text" && typeof child.value === "string") {
          INLINE_STATUS_RE.lastIndex = 0;
          if (INLINE_STATUS_RE.test(child.value)) {
            child.value = child.value.replace(INLINE_STATUS_RE, "");
          }
        } else {
          visit(child);
        }
      }
    };
    visit(tree);
  };
}
