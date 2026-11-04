import type {Root,RootContent} from "mdast";
import type {VFile} from "vfile";
import {unified} from "unified";
import remarkParse from "remark-parse";

const parser=unified().use(remarkParse);
const plainFlow=/^[\s↓↑→←↔↕⬇⬆➜➝➞⟶⟵]+$/u;

/** Four-space export indentation can turn ordinary Markdown into code. Repair
 * only unmistakable prose/standalone arrows; explicit fences and program text
 * stay literal. Reparsed nodes don't claim offsets into the original message. */
export function readerIndentedProse(){
 return (tree:Root,file:VFile)=>{
  const source=String(file.value);
  const clearPosition=(node:RootContent)=>{delete node.position;if("children" in node)node.children.forEach(child=>clearPosition(child as RootContent));};
  const visit=(parent:{children:RootContent[]})=>{
   parent.children=parent.children.flatMap(node=>{
    if(node.type!=="code"){if("children" in node)visit(node as unknown as {children:RootContent[]});return [node];}
    if(node.lang||node.meta||node.position?.start.offset===undefined)return [node];
    const raw=source.slice(node.position.start.offset,node.position.end?.offset);
    if(/^ {0,3}(?:`{3,}|~{3,})/u.test(raw))return [node];
    const value=node.value.trim();
    const flow=plainFlow.test(value);
    // Require several complete prose lines, including Chinese text and an
    // explicit Markdown heading/quote; punctuation used by code vetoes repair.
    const prose=value.split("\n").filter(line=>line.trim()).length>=3&&/^\p{Script=Han}/u.test(value)&&/(?:^|\n)\s*(?:#{1,6}\s|>\s)/u.test(value)
     &&!/[{};`]|(?:^|\n)\s*(?:\/\/|\/\*|#!|import\b|from\b|def\b|class\b|const\b|let\b|var\b|return\b|if\b|for\b|while\b)|(?:=>|:=|==|\w\s*=\s*\S)/u.test(value);
    if(!flow&&!prose)return [node];
    const nodes=parser.parse(node.value).children;nodes.forEach(clearPosition);return nodes;
   });
  };
  visit(tree);
 };
}
