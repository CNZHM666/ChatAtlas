import {ReaderSourceSupplement} from "./components/ReaderSourceSupplement";
import type { Root, RootContent, Blockquote } from "mdast";
import type { Components } from "react-markdown";
import { WIKI_SUPPLEMENT } from "../shared/wiki-block-presentation";

/** Only the application's exact marker becomes a disclosure. Other HTML remains disabled. */
export function readerWikiSupplements() {
  return (tree: Root) => {
    const result: RootContent[] = [];
    for (let at = 0; at < tree.children.length; at++) {
      const node = tree.children[at];
      const match = node.type === "html" ? new RegExp(`^<details data-atlas="${WIKI_SUPPLEMENT}">\\s*<summary>([^<>\\n]{1,300})</summary>\\s*$`, "u").exec(node.value) : undefined;
      if (!match) { result.push(node); continue; }
      let end = at + 1;
      while (end < tree.children.length && !(tree.children[end].type === "html" && /^<\/details>\s*$/u.test((tree.children[end] as { value: string }).value))) end++;
      if (end === tree.children.length) { result.push(node); continue; }
      result.push({ type: "blockquote", data: { hName: "atlas-supplement" }, children: [{ type: "paragraph", children: [{ type: "text", value: match[1] }] }, ...tree.children.slice(at + 1, end) as Blockquote["children"]] });
      at = end;
    }
    tree.children = result;
  };
}

export const readerSupplementComponents = {
  "atlas-supplement": ReaderSourceSupplement,
} as unknown as Components;
