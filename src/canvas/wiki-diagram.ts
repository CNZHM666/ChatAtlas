import { unified } from "unified";
import remarkParse from "remark-parse";
import type { RootContent } from "mdast";
import type { FocusSection, FocusSession } from "../shared/focus-session";
import { chapterConceptSteps, chapterSteps } from "./chapter-understanding";
import { structureIsCurrent } from "../shared/structure-signature";
import { understandingEdges } from "./understanding-model";
import { hasUsefulUnderstandingDiagram } from "./understanding-presentation";
const parser=unified().use(remarkParse);
const text=(node:RootContent):string=>"value" in node?node.value:"children" in node?node.children.map(child=>text(child as RootContent)).join(""):"";
export function wikiDiagramHeadings(body:string){return parser.parse(body).children.filter(node=>node.type==="heading").map(node=>text(node));}
export function suggestedDiagramHeading(section:FocusSection){
  const heading=wikiDiagramHeadings(section.body).find(title=>/架构|模块|数据流|执行流程|处理流程|architecture|modules|data flow|execution|pipeline|workflow/iu.test(title));
  if(heading)return heading;
  if(/架构|数据流|流程|architecture|data flow|workflow|pipeline/iu.test(section.title)&&section.body.trim())return "";
}
export function hasChapterDiagram(section:FocusSection,session:FocusSession){if(!section.semanticStructure&&!section.understandingPath?.length||section.semanticStructure&&!structureIsCurrent(section,session))return false;const steps=chapterSteps(section,session);return hasUsefulUnderstandingDiagram(chapterConceptSteps(steps),understandingEdges(steps));}
/** Split only at Markdown block boundaries, never through code, tables or list items. */
export function wikiDiagramParts(body:string,heading?:string){
  const nodes=parser.parse(body).children;
  const index=heading?nodes.findIndex(node=>node.type==="heading"&&text(node)===heading):-1;
  const next=index>=0?nodes.slice(index+1).find(node=>node.type==="heading"&&node.depth<=(nodes[index] as {depth:number}).depth):undefined;
  const first=nodes.findIndex(node=>node.type!=="heading"),opening=first>=0&&nodes[first].type==="paragraph"&&/[:：]$/.test(text(nodes[first]).trim())&&nodes[first+1]?.type==="list"?nodes[first+1]:nodes[first];
  const end=index>=0?(next?.position?.start.offset??body.length):(opening?.position?.end.offset??0);
  return [body.slice(0,end),body.slice(end)] as const;
}
