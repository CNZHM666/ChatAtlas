import {unified} from "unified";
import remarkParse from "remark-parse";
import type {RootContent} from "mdast";
import type {FocusSection} from "../shared/focus-session";
import type {CoverageMaterial} from "./focus-coverage";
import {sourceMessageSignature} from "../shared/source-signature";

const parser=unified().use(remarkParse);
const text=(node:RootContent):string=>"value" in node?node.value:"children" in node?node.children.map(child=>text(child as RootContent)).join(""):"";

/** Editorial hints, never fact verification or a reason for a paid retry. A
 * concise fact/list can be correct. Only flag thin prose when rich input exists. */
export function wikiWritingQuality(section:FocusSection,batch:CoverageMaterial[],options:{completeChapter?:boolean}={}):FocusSection {
 const own=batch.filter(item=>item.wikiOwnerId===section.wikiOwnerId),issues:NonNullable<FocusSection["writingQuality"]>["issues"]=[];
 const rich=own.some(item=>{
  const at=item.text.indexOf("SOURCE DETAIL INVENTORY");if(at<0)return false;
  try{return (JSON.parse(item.text.slice(item.text.indexOf("\n",at)+1)).details?.length??0)>=4;}catch{return false;}
 });
 const nodes=parser.parse(section.body).children;
 if(options.completeChapter){
  // A small chapter, or one with a single subtopic, deliberately has no opening.
  const small=nodes.filter(node=>node.type==="heading"&&node.depth===2).length<=1||nodes.filter(node=>node.type!=="heading").map(text).join("").replace(/\s+/gu,"").length<600;
  if(nodes[0]?.type!=="paragraph"&&!small)issues.push({code:"missing_overview",title:""});
  const headings=new Set<string>(),paragraphs=new Set<string>();
  const nested=nodes.filter(node=>node.type==="heading"&&node.depth>=3);
  if(nested.length>=8)issues.push({code:"dense_outline",title:""});
  for(const node of nodes){
   if(node.type!=="heading"&&node.type!=="paragraph")continue;
   const value=text(node).trim(),key=value.replace(/\s+/gu,"").toLocaleLowerCase();
   if(node.type==="heading"){
    if(headings.has(key))issues.push({code:"duplicate_heading",title:value});
    headings.add(key);
   }else{
    if(value.length>=60&&paragraphs.has(key))issues.push({code:"repeated_explanation",title:""});
    paragraphs.add(key);
    if(/(?:本批次|当前(?:提供的)?(?:源)?材料|this batch|supplied source material)/iu.test(value)&&/(?:未涉及|未提供|无法(?:描述|展开|判断)|待补充|主要聚焦|主要关注|does not (?:include|cover)|not provided|mainly (?:focus|cover))/iu.test(value))issues.push({code:"batch_commentary",title:""});
    // A hint, not a global [] deletion: literal arrays may be legitimate.
    if(node.children.some(child=>child.type==="text"&&/[^\s][ \t]+\[[ \t]*\](?=[。.!！?？])/u.test(child.value)))issues.push({code:"empty_citation",title:""});
   }
  }
 }
 if(rich){
  for(const [index,node] of nodes.entries()){
   if(node.type!=="heading")continue;
   const end=nodes.findIndex((next,at)=>at>index&&next.type==="heading"&&next.depth<=node.depth);
   const children=nodes.slice(index+1,end<0?undefined:end);
   if(children.some(child=>child.type==="heading"||child.type==="list"||child.type==="code"||child.type==="blockquote"))continue;
   const prose=children.map(text).join(" ").trim();
   if(prose&&!prose.includes("|")&&prose.length<100)issues.push({code:"thin_subtopic",title:text(node)});
  }
 }
 const checkTable=/\|[^\n]*(?:是否通过|测试结果|验证结果|test result|passed)[^\n]*\|/iu.test(section.body)&&/\|[^\n]*✅[^\n]*\|/u.test(section.body);
 if(checkTable)issues.push({code:"result_checklist",title:""});
 return {...section,...(issues.length?{writingQuality:{signature:sourceMessageSignature(section.body),issues}}:{writingQuality:undefined})};
}
