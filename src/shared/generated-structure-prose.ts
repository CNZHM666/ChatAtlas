import { unified } from "unified";
import remarkParse from "remark-parse";
import { understandingRelationKinds } from "./understanding-relations";
import {withoutGeneratedClaims} from "./generated-claims-prose";
import {knowledgeArticlePresentation} from "./knowledge-article-presentation";

const parser = unified().use(remarkParse);

/** Compatibility for the exact appendix inserted by Wiki writing v3. This is
 * a presentation projection only; sources, claims and saved bodies survive. */
export function withoutGeneratedDiscussionAppendix(body:string,originalTexts:string[]=[]):string {
  if(!/^### (?:原文中的具体说明|Original details)$/mu.test(body))return body;
  const nodes=parser.parse(body).children,ranges:Array<{start:number;end:number}>=[];
  const roleLabel="(?:用户原句|AI 讨论原句|原文片段|User statement|AI discussion|Original excerpt)：";
  for(let index=0;index<nodes.length;index++){
    const heading=nodes[index];
    if(heading.type!=="heading"||heading.depth!==3||!/^### (?:原文中的具体说明|Original details)$/u.test(body.slice(heading.position!.start.offset!,heading.position!.end.offset!)))continue;
    let cursor=index+1,end:number|undefined;
    while(cursor+1<nodes.length){
      const label=nodes[cursor],quote=nodes[cursor+1];
      if(label.type!=="paragraph"||quote.type!=="blockquote"||!new RegExp(`^${roleLabel}$`,"u").test(body.slice(label.position!.start.offset!,label.position!.end.offset!)))break;
      end=quote.position!.end.offset!;cursor+=2;
      // Early v3 appended the next label without a blank line. Markdown parses
      // that label as lazy continuation of the preceding quote, then starts a
      // new unlabeled blockquote. Consume it only with this exact trailing label.
      let previous=quote;
      while(nodes[cursor]?.type==="blockquote"&&new RegExp(`\\n${roleLabel}$`,"u").test(body.slice(previous.position!.start.offset!,previous.position!.end.offset!))){
        previous=nodes[cursor] as typeof quote;end=previous.position!.end.offset!;cursor++;
      }
    }
    if(end!==undefined){const start=heading.position!.start.offset!;if(!originalTexts.some(text=>text.includes(body.slice(start,end))))ranges.push({start,end});}
  }
  for(const range of ranges.reverse())body=body.slice(0,range.start)+body.slice(range.end);
  return ranges.length?body.trim():body;
}
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const ids = (value: unknown) => Array.isArray(value) && value.length > 0 && value.every(id => typeof id === "string" && id.trim());
const hasProof = (value: Record<string, unknown>) => typeof value.quote === "string" && value.quote.trim() && ids(value.evidenceIds);
const example = /代码示例|JSON\s*示例|格式示例|接口示例|(?:配置|请求|响应|返回|数据)(?:格式|示例)|\bschema\b|\bexample\s+(?:response|payload|json|code)\b/iu;

/** Recognize only ChatAtlas's complete metadata shape, never arbitrary JSON or graph code. */
function isStructureData(text: string): boolean {
  let value: unknown;
  try { value = JSON.parse(text); } catch { return false; }
  if (!record(value) || Object.keys(value).some(key => key !== "nodes" && key !== "relations") || !Array.isArray(value.nodes) || !Array.isArray(value.relations) || !value.nodes.length || value.nodes.length > 80 || value.relations.length > 120) return false;
  return value.nodes.every(node => record(node) && ["key", "title", "description"].every(key => typeof node[key] === "string") && ["discussed", "proposal", "uncertain", "superseded"].includes(String(node.status)) && hasProof(node)) &&
    value.relations.every(edge => record(edge) && typeof edge.from === "string" && typeof edge.to === "string" && understandingRelationKinds.includes(edge.kind as typeof understandingRelationKinds[number]) && ["supported", "uncertain"].includes(String(edge.status)) && hasProof(edge));
}

function inventoryRecord(text:string):{text:string;quote:string;status:string}|undefined{
 let value:unknown;try{value=JSON.parse(text);}catch{return;}
 if(!record(value)||Object.keys(value).some(key=>!["kind","text","status","quote"].includes(key))||!["decisions","constraints","questions","progress","purpose","workflow"].includes(String(value.kind))||!["documented","proposal","uncertain","planned","superseded"].includes(String(value.status))||typeof value.text!=="string"||!value.text.trim()||typeof value.quote!=="string"||!value.quote.trim())return;
 return {text:value.text,quote:value.quote,status:String(value.status)};
}

/** Reading-only cleanup for old articles, also used before saving new generated prose.
 * Original code samples and explicitly introduced schema examples remain intact.
 * This does not convert metadata into verified facts or mutate the supplied article. */
export function generatedProse(body: string, originalTexts: string[] = []): { body: string; removedBlocks: number } {
  body=withoutGeneratedDiscussionAppendix(body,originalTexts);
  const claims=withoutGeneratedClaims(body,originalTexts);body=claims.body;
  const preserved = (value: string) => originalTexts.some(text => text.includes(value.trim()));
  if (isStructureData(body.trim()) && !preserved(body)) return { body: "", removedBlocks: 1+claims.removedBlocks };
  const tree = parser.parse(body), ranges: Array<{ start: number; end: number; replacement?:string }> = [];
  tree.children.forEach((node, index) => {
    const raw=node.position?body.slice(node.position.start.offset!,node.position.end.offset!):"";
    if(node.type==="paragraph"&&["依据本次材料解释机制、条件与限制。","Transition to next section."].includes(raw.trim())&&!preserved(raw)){ranges.push({start:node.position!.start.offset!,end:node.position!.end.offset!});return;}
    const metadata=node.type==="code"?node.value:node.type==="paragraph"?raw:undefined;
    if (metadata===undefined || node.type==="code"&&node.lang && !["json", "atlas-structure"].includes(node.lang.toLowerCase()) || !node.position || preserved(metadata)) return;
    const inventory=inventoryRecord(metadata);
    if(!isStructureData(metadata)&&!inventory)return;
    const previous = tree.children[index - 1];
    const introduction = previous?.position ? body.slice(previous.position.start.offset, previous.position.end.offset) : "";
    if (example.test(introduction)) return;
    // Keep the original qualification. "documented" never implies adoption.
    const zh=/\p{Script=Han}/u.test(body);
    const qualifier=inventory?.status==="superseded"?(zh?"历史讨论记录：":"Historical discussion: "):inventory?.status==="uncertain"?(zh?"尚未确定：":"Unresolved: "):inventory?.status==="proposal"||/建议|提议|suggest|recommend/iu.test(inventory?.quote??"")?(zh?"讨论建议：":"Suggested in discussion: "):inventory?.status==="planned"?(zh?"计划：":"Planned: "):(zh?"讨论记录：":"Discussion record: ");
    ranges.push({ start: node.position.start.offset!, end: node.position.end.offset!,...(inventory?{replacement:qualifier+inventory.text}:{} ) });
  });
  let cleaned = body;
  for (const range of ranges.reverse()) cleaned = cleaned.slice(0, range.start) + (range.replacement??"") + cleaned.slice(range.end);
  const article=ranges.length ? cleaned.trim() : body;
  return { body: knowledgeArticlePresentation(article,/\p{Script=Han}/u.test(article),originalTexts), removedBlocks: ranges.length+claims.removedBlocks };
}
