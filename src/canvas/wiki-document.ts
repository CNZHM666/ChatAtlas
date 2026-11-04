import type { RootContent } from "mdast";
import { unified } from "unified";
import remarkParse from "remark-parse";
import {generatedProse} from "../shared/generated-structure-prose";
import {wikiReadingLayout} from "../shared/wiki-reading-layout";
import {readingEmphasisMarkdown} from "../shared/reading-emphasis";

const parser = unified().use(remarkParse);
const nodeText = (node: RootContent): string => "value" in node ? node.value : "children" in node ? node.children.map(child => nodeText(child as RootContent)).join("") : "";

export interface WikiHeading {
  title: string;
  depth: number;
  headingIndex: number;
}
export interface WikiOutlineItem extends WikiHeading { children: WikiOutlineItem[] }
export interface WikiChapterOverview { blocks:Array<{text:string;context?:string}>; readingBody:string; kind:"opening"|"excerpt" }

/** Only a chapter's own opening is an overview. Missing legacy openings stay
 * absent; paragraphs sampled from child topics do not summarize the chapter. */
function chapterOverview(body:string,nodes:RootContent[]):WikiChapterOverview|undefined {
 const usable=(node:RootContent)=>node.type==="paragraph"&&Boolean(node.position)&&nodeText(node).trim().length>0&&!(node.children.every(child=>child.type==="strong"||child.type==="emphasis"||child.type==="text"&&!child.value.trim())&&!/[。.!?！？]/u.test(nodeText(node)))&&body.slice(node.position!.start.offset!,node.position!.end.offset!).length<=360&&!/[：:]\s*$/u.test(nodeText(node))&&!/(?:如下|以下|包括|as follows|including)\s*[：:]?$/iu.test(nodeText(node));
 const opening:WikiChapterOverview["blocks"]=[];let end=0;
 for(const [index,node] of nodes.entries()){
  if(!usable(node)||opening.length>=2)break;
  if(nodes[index+1]&&["list","table","code","blockquote","html"].includes(nodes[index+1].type))break;
  const text=body.slice(node.position!.start.offset!,node.position!.end.offset!);
  if(opening.reduce((sum,item)=>sum+item.text.length,0)+text.length>480)break;
  opening.push({text});end=node.position!.end.offset!;
 }
 if(opening.length)return {blocks:opening,readingBody:body.slice(end).trimStart(),kind:"opening"};
 return undefined;
}

/** Nest by the actual Markdown hierarchy, including skipped heading levels. */
export function wikiOutline(headings: WikiHeading[]): WikiOutlineItem[] {
  const roots: WikiOutlineItem[] = [], stack: WikiOutlineItem[] = [];
  for (const heading of headings) {
    const item = { ...heading, children: [] };
    while (stack.length && stack[stack.length - 1].depth >= item.depth) stack.pop();
    (stack.at(-1)?.children ?? roots).push(item);
    stack.push(item);
  }
  return roots;
}

/** Keep the Markdown intact: opening paragraphs can introduce a list or table. */
export function wikiDocument(body: string,generated=false,originalTexts:string[]=[],phrases:string[]=[]) {
  if(generated)body=wikiReadingLayout(generatedProse(body,originalTexts).body,originalTexts);
  if(generated)body=readingEmphasisMarkdown(body,{sectioned:true,phrases});
  const tree = parser.parse(body);
  return { body, overview:chapterOverview(body,tree.children), headings: tree.children.flatMap((node, index) => node.type === "heading" ? [{ title: nodeText(node), depth: node.depth, headingIndex: tree.children.slice(0, index).filter(item => item.type === "heading").length }] : []) };
}
