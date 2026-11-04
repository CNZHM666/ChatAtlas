import { expect, it } from "vitest";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import { GFM_OPTIONS } from "./markdown-gfm";

const kinds = (markdown: string) => { const found: string[] = []; const walk = (node: { type: string; children?: unknown[] }) => { found.push(node.type); (node.children as typeof node[] | undefined)?.forEach(walk); }; walk(unified().use(remarkParse).use(remarkGfm, GFM_OPTIONS).parse(markdown) as never); return found; };

it("reads a range written with single tildes as text, and ~~two~~ as strikethrough", () => {
  expect(kinds("max-width 760~800px，min-height 110~130px，border-radius 20~26px。")).not.toContain("delete");
  expect(kinds("已改为 ~~旧方案~~ 新方案。")).toContain("delete");
});
