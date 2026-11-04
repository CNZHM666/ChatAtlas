import type { Root, RootContent } from "mdast";

function label(node: RootContent): string {
  if ("value" in node) return typeof node.value === "string" ? node.value : "";
  return "children" in node ? node.children.map(child => label(child as RootContent)).join("") : "";
}

const STAGE_LABEL = 16, LABELLED_ITEM = 140;
// Layers and levels ("第一层", "一级") read as stages too: "浏览—详情—编辑" told as three layers.
const STAGE_NAME = /阶段|步骤\s*\d|第[一二三四五六七八\d]+[步版期层级]|[一二三四五\d]级|\bv\d+(?:\.\d+)*\b|\bP\d\b|\bM\d\b|里程碑|\b(?:stage|phase|step|milestone)\b/iu;
const paragraphOf = (item: RootContent) => (item as { children: Array<{ children: RootContent[] }> }).children[0].children;
/** Only explicit, short stage lists change layout. Source text/order remain intact. */
export function readerStagePresentation() {
  return (tree: Root) => {
    tree.children.forEach((node, index) => {
      const heading = tree.children[index - 1];
      if (node.type !== "list" || !node.ordered || node.children.length < 2 || node.children.length > 20) return;
      if (node.children.some(item => item.checked != null || item.children.length !== 1 || item.children[0].type !== "paragraph" || !label(item).trim())) return;
      // Every item opening on a short bold stage label ("**第一阶段**：…") is a plan's stages, whatever precedes it.
      const labelled = node.children.every(item => { const first = paragraphOf(item)[0]; return first?.type === "strong" && label(first).trim().length <= STAGE_LABEL && STAGE_NAME.test(label(first)); });
      if (labelled) { if (node.children.some(item => label(item).trim().length > LABELLED_ITEM)) return; }
      else {
        if (node.children.length < 3 || !heading || !["heading", "paragraph"].includes(heading.type)) return;
        const title = label(heading).trim();
        if (title.length > 100 || !/(?:阶段|流程|步骤|旅程|路线|层级|分层|三层|两层|\b(?:stages?|steps?|workflow|process|journey|layers?)\b)/iu.test(title)) return;
        if (node.children.some(item => label(item).trim().length > 80)) return;
      }
      // A labelled card shows its label as a title: the "：" joining it to the text goes.
      if (labelled) for (const item of node.children) { const next = paragraphOf(item)[1]; if (next?.type === "text") next.value = next.value.replace(/^\s*[：:]\s*/u, ""); }
      // The id carries the kind: sanitizing keeps ids and drops data attributes.
      node.data = { ...node.data, hProperties: { ...node.data?.hProperties, id: labelled ? "atlas-stage-flow-labelled" : "atlas-stage-flow" } };
    });
  };
}
