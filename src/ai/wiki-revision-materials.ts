import {unified} from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import { GFM_OPTIONS } from "../shared/markdown-gfm";
import type {FocusSection,FocusSession} from "../shared/focus-session";
import type {ConversationMessage} from "../shared/types";
import {sourceMessageSignature} from "../shared/source-signature";
import {wikiQuoteRange} from "../shared/wiki-claims";
import {wikiRewriteSources} from "./wiki-section-rewrite";

const parser=unified().use(remarkParse).use(remarkGfm, GFM_OPTIONS);
export interface RevisionUnit {
  id:string;kind:"draft"|"source";topic:string;path:string[];text:string;start:number;end:number;literal?:true;
  conversationId?:string;messageId?:string;role?:string;messageIndex?:number;sourceCreatedAt?:number;evidenceIds:string[];
}
/** Complete Markdown blocks: lead-ins stay with their code/list/table/quote.
 * No sentence slicing, sampled originals or truncated code. Offsets are exact. */
export function revisionMarkdownUnits(body:string,prefix:string,kind:RevisionUnit["kind"],defaultTopic:string):RevisionUnit[]{
  const nodes=parser.parse(body).children;
  const boundaries=[0,...nodes.flatMap((node,index)=>{
    const previous=nodes[index-1];
    if(!previous)return [];
    if(previous.type==="heading")return [];
    if(["code","list","table","blockquote"].includes(node.type)&&previous.type==="paragraph")return [];
    return [node.position!.start.offset!];
  }).filter(at=>at>0),body.length];
  const result:RevisionUnit[]=[],path:Array<{depth:number;title:string}>=[];
  for(let i=0;i<boundaries.length-1;i++){
    const start=boundaries[i],end=boundaries[i+1],text=body.slice(start,end);
    for(const heading of nodes.filter(node=>node.type==="heading"&&node.position!.start.offset!>=start&&node.position!.start.offset!<end)){
      if(heading.type!=="heading")continue;
      while(path.length&&path.at(-1)!.depth>=heading.depth)path.pop();
      path.push({depth:heading.depth,title:body.slice(heading.position!.start.offset!,heading.position!.end.offset!).replace(/^#{1,6}\s+/u,"").trim()});
    }
    if(!text.trim())continue;
    const literal=nodes.some(node=>["code","table"].includes(node.type)&&node.position!.start.offset!>=start&&node.position!.start.offset!<end);
    result.push({id:`${prefix}:${start}:${end}:${sourceMessageSignature(text)}`,kind,topic:path.find(item=>item.depth<=2)?.title??defaultTopic,path:path.map(item=>item.title),text,start,end,evidenceIds:[],...(literal?{literal:true}:{})});
  }
  return result;
}

export function wikiRevisionMaterials(session:FocusSession,section:FocusSection,originals:ConversationMessage[]){
  const {refs,messages}=wikiRewriteSources(session,section,originals),zh=session.locale!=="en";
  if(!messages.length||refs.some(ref=>!messages.some(message=>message.id===ref.messageId&&message.conversationId===ref.conversationId)))throw new Error(zh?"部分章节来源缺失或不在确认范围内，原稿已保留。":"Some chapter sources are missing or outside the confirmed scope. Original retained.");
  const draft=revisionMarkdownUnits(section.body,`draft:${section.id}`,"draft",section.title);
  const sources=messages.flatMap(message=>revisionMarkdownUnits(message.content,`source:${sourceMessageSignature(JSON.stringify([message.conversationId,message.id,message.role,message.sourceCreatedAt]))}`,"source",section.title).map(unit=>({...unit,conversationId:message.conversationId,messageId:message.id,role:message.role,messageIndex:message.messageIndex,sourceCreatedAt:message.sourceCreatedAt,evidenceIds:refs.filter(ref=>ref.conversationId===message.conversationId&&ref.messageId===message.id).map(ref=>ref.id)})));
  // Existing grounded claims route evidence to its current topic; this is
  // navigation, not permission to discard unmatched source paragraphs.
  for(const unit of sources){
    const claims=section.claims?.filter(claim=>claim.evidenceIds.some(id=>unit.evidenceIds.includes(id))&&wikiQuoteRange(unit.text,claim.quote))??[];
    const owner=draft.find(item=>claims.some(claim=>[claim.text,...claim.formulations??[]].some(text=>wikiQuoteRange(item.text,text))));
    unit.topic=owner?.topic??section.title;
  }
  const topics=[...new Set(draft.map(unit=>unit.topic))];if(!topics.length)topics.push(section.title);
  // One draft unit is reviewed exactly once. Source-only batches can add
  // supported detail or explicitly leave unrelated material in the sources.
  const units=[...draft,...sources];
  const signature=sourceMessageSignature(JSON.stringify([section.body,section.claims,session.scope,messages.map(message=>[message.conversationId,message.id,message.role,message.sourceCreatedAt,message.content])]));
  return {units,draft,sources,topics,signature,refs,messages};
}
