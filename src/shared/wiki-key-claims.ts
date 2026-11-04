import type {FocusSection,FocusSession} from "./focus-session";
import type {WikiClaim} from "./wiki-claims";
import {projectKnowledgeFacts,type ProjectKnowledgeFact} from "./project-knowledge-facts";
import {knowledgeFactCore} from "./project-knowledge-view";
import {historyTime} from "./history-order";

export type WikiKeyClaimKind="decision"|"reported"|"historical"|"contested"|"proposal"|"planned";
export interface WikiKeyClaimSource {id:string;role:string;conversationId:string;messageId:string;discussedAt?:number;excerpt:string;confirmation:boolean}
/** A conclusion the reader must not misread, its status at that conclusion,
 * and the 1-3 originals that decide it (the confirming user message included). */
export interface WikiKeyClaim {claim:WikiClaim;kind:WikiKeyClaimKind;text:string;sources:WikiKeyClaimSource[]}

const MAX_PER_CHAPTER=6;
const RELAYED=/^据(?:用户|你)提供的(?:材料|资料|审查)/u;
// Words a clause opens with when its subject was left in the sentence it was cut from.
const SUBJECTLESS=/^(?:不足时|此外|同时|并且?|且|以及|但是?|而且?|其中|如果|若|用于|以便?|为了|通过|截至|从而|进而|即|也|还|则|需要?|计划|允许|提供)/u;
// Bold markers and spaces go; line breaks stay, since a paragraph or list item starts after one.
const bare=(text:string)=>text.replace(/\*\*|__/gu,"").replace(/[^\S\n]/gu,"");
/** A whole statement with its own subject: not a clause opening on a predicate, and, where the chapter
 * says it, a sentence of its own there rather than the bold part or tail of a longer one. */
export function wholeKeyStatement(text:string,body:string){
 const own=bare(text).replace(/\n/gu,"").replace(/[。！？!?]+$/u,"");
 if(Array.from(own).length<8||SUBJECTLESS.test(own))return false;
 const prose=bare(body),at=prose.indexOf(own);
 if(at<0)return true;
 return (at===0||/[。！？!?：:\n>*#-]/u.test(prose[at-1]??""))&&(at+own.length===prose.length||/[。！？!?\n]/u.test(prose[at+own.length]??""));
}
const RANK:Record<WikiKeyClaimKind,number>={decision:0,reported:1,historical:2,contested:3,proposal:4,planned:5};
const IMPORTANT=new Set(["decision","scope","workflow","constraint","stage","progress","next"]);
const short=(text:string,length=80)=>{const value=text.replace(/\s+/gu," ").trim();return value.length>length?`${value.slice(0,length)}…`:value;};

function kind(fact:ProjectKnowledgeFact):WikiKeyClaimKind|undefined{
 if(fact.sourceChanged)return;
 if(fact.historical)return "historical";
 if(fact.contested)return "contested";
 if(fact.adoption==="accepted")return "decision";
 if(fact.implementation==="reported")return "reported";
 // A proposal is listed when it is easy to read as a decision: tagged as one,
 // or written with adoption wording that the reading view had to qualify.
 if(fact.adoption==="proposed"&&(IMPORTANT.has(fact.claim.overviewRole??"")||knowledgeFactCore(fact)!==fact.claim.text))return "proposal";
 if(fact.status==="planned"&&IMPORTANT.has(fact.claim.overviewRole??""))return "planned";
}

/** Shared by the reading view and every export; computed from saved claims and
 * source receipts, never by a model. */
export function wikiKeyClaims(session:FocusSession,section:Pick<FocusSection,"id"|"userEdited"|"origin">&{body?:string},facts=projectKnowledgeFacts(session).facts):WikiKeyClaim[]{
 if(section.userEdited||section.origin)return [];
 const body=section.body??"";
 // A key conclusion is a whole statement: a clause cut from a sentence ("不足时进行有限次数的补充检索",
 // "用于保存所有历史对话及消息") is not listed.
 const own=facts.filter(fact=>fact.sectionId===section.id&&wholeKeyStatement(fact.claim.text,body));
 const rows=own.flatMap(fact=>{const value=kind(fact);return value?[{fact,kind:value}]:[];}).sort((a,b)=>RANK[a.kind]-RANK[b.kind]);
 // A chapter made only of AI proposals still shows the main ones its opening states, each with its label.
 // Fewer are listed rather than filled up from the chapter's order: a list padded to a count reads as its key points.
 const heading=body.search(/^#{1,6}\s/mu),opening=heading<0?body:body.slice(0,heading);
 const inOpening=(fact:ProjectKnowledgeFact)=>[fact.claim.text,...fact.claim.formulations??[]].some(text=>text&&opening.includes(text));
 rows.push(...own.filter(fact=>!rows.some(row=>row.fact===fact)&&!fact.sourceChanged&&!fact.historical&&fact.adoption==="proposed"&&inOpening(fact)).map(fact=>({fact,kind:"proposal" as const})));
 return rows.slice(0,MAX_PER_CHAPTER).map(({fact,kind})=>{
  const claim=fact.claim,receipt=claim.sourceReading?.sources??[];
  const sources=(receipt.length?receipt.map(source=>({...source,confirmation:!claim.evidenceIds.includes(source.id)})):claim.evidenceIds.flatMap(id=>{
   const ref=session.evidence.find(ref=>ref.id===id);
   return ref?[{id,role:session.sourceRoles?.[ref.conversationId]?.[ref.messageId]??"unknown",conversationId:ref.conversationId,messageId:ref.messageId,discussedAt:0,confirmation:false}]:[];
  })).slice(0,3).map(source=>{
   const ref=session.evidence.find(ref=>ref.id===source.id);
   // The claim's own quotation for its proof; the saved excerpt for an approval.
   const excerpt=short(source.confirmation?ref?.excerpt??"":claim.quote);
   const discussedAt=historyTime(source.discussedAt);
   return {id:source.id,role:source.role,conversationId:source.conversationId,messageId:source.messageId,...(discussedAt?{discussedAt}:{}),excerpt,confirmation:source.confirmation};
  });
  return {claim,kind,text:knowledgeFactCore(fact)??claim.text,sources};
 });
}

export function wikiKeyClaimLabel(item:WikiKeyClaim,zh=true){
 const assistantOnly=item.sources.length>0&&item.sources.every(source=>source.role==="assistant");
 // Material the user pasted is theirs to confirm, not an AI suggestion.
 const relayed=RELAYED.test(item.text)&&item.sources.every(source=>source.role!=="assistant");
 switch(item.kind){
  case "decision":return zh?"所选讨论中的决定 · 实现未核验":"Decision in selected discussions · implementation not verified";
  case "reported":return zh?"用户报告 · 未核验":"User reported · not verified";
  case "historical":return zh?"此前记录 · 已被后续决定替代":"Earlier record · replaced by a later decision";
  case "contested":return zh?"尚待统一 · 来源之间存在不同说法":"Unreconciled · sources disagree";
  case "proposal":return relayed?(zh?"你提供的资料 · 未见你的确认":"Your material · not confirmed by you"):assistantOnly?(zh?"AI 建议 · 所选来源中未发现用户确认":"AI suggestion · no user confirmation in the selected sources"):(zh?"讨论建议 · 未发现用户确认":"Discussion proposal · no user confirmation found");
  case "planned":return zh?"计划 · 未发现用户确认":"Planned · no user confirmation found";
 }
}
