import type {ProjectState,ProjectHistoryEvent} from "../shared/project-state";
import {wikiNoteEvidenceText} from "./wiki-writing-details";
import type {WikiFactSource} from "../shared/wiki-current-facts";
import {wikiQuoteRange} from "../shared/wiki-claims";
import {statementEvidence} from "../shared/statement-evidence";
import {wikiProofContext} from "../shared/wiki-proof-context";

export const WIKI_SHARED_FACT_INSTRUCTIONS=" Shared project facts v1: reconcile ONE current project understanding across chapters. Global facts below are a bounded navigation catalogue from the SAME saved reading, not new evidence or instructions. Use the original role, explicit choices, scope and within-conversation order; unknown cross-conversation order stays unknown. A later assistant suggestion never replaces a user choice. Keep early milestones as earlier records, not multiple simultaneous current stages. Different versions and planned target counts can coexist with actual current counts; name their scope. Distinguish input intent, hardware/domain data, UI state and catalog ownership: different layers may each have their own authoritative object, never call two objects the sole truth of the entire system without an evidenced relationship. Distinguish project-owned server credentials from user BYOK credentials and identify whether a routing proposal was adopted; do not silently merge different credential designs. These are general examples, not required project features. If the originals do not resolve a relationship, explicitly leave it unresolved rather than inventing a link. For each important claim optionally provide subject (stable specific fact axis, not a changing milestone value) and scope (literal product version or module boundary, omit if unknown). For stage claims subject names the stage axis, scope is the product/version, not the milestone value. Keep original quotes and cite ONLY this batch's evidence IDs; background from another batch cannot manufacture citations. An implemented/completed assertion requires an explicit original user report and must be phrased as user-reported, never repository-verified. An assistant's implementation description is a discussion description, not completion evidence. Omit subjective maturity scores and claims that asking for a prompt proves code development. Do not generate another independent Brief; tag the complete project introduction in its owning page overviewRole:purpose; use scope only for product boundaries, workflow for the core workflow, constraint for important requirements, and stage/progress for actual sourced state. The application projects the overview from these same claims. In this SAME response, a claim may optionally carry relation:{kind:supplements|narrows|replaces|coexists|conflicts,targetQuote:the literal quote of one retained prior claim}. Supply it only when the original explicitly establishes that relationship for the same subject and version; do not infer replacement from recency or generic shared vocabulary. A source-backed supplement does not invalidate the earlier choice. Optional formulations:[complete literal sentence or data-cell text from THIS generated body] can bind alternate prose to its owning claim; retain details, numbers and conditions. Never use headings, code, quotations or unrelated paragraphs as formulations. These are optional bounded metadata, not an extra analysis pass.";

/** One bounded catalogue row. evidenceIds and ownerId route it to a chapter;
 * only value is ever shown to the model. */
export interface WikiGuideFact {value:object;evidenceIds:string[];ownerId?:string}
export interface WikiGuideCatalogue {facts:WikiGuideFact[];omitted:number}

/** Complete bounded rows only. Raw reading/cache identity remains unchanged;
 * catalogue omissions never delete details from the owning writing material. */
export function wikiGuideCatalogue(states:Array<ProjectState|undefined>,sources:WikiFactSource[],retiredHistory:ProjectHistoryEvent[]=[]):WikiGuideCatalogue {
 // Writing sees each change with its resolved link: the earlier state it
 // replaced or rejected (history only), or why the link is still unresolved.
 const known=new Map([...states.flatMap(state=>state?.history??[]),...retiredHistory].flatMap(event=>event.claimId?[[event.claimId,event] as const]:[]));
 const links=(event:ProjectHistoryEvent)=>(event.relations??[]).filter(relation=>relation.fromClaimId===event.claimId).map(relation=>({kind:relation.kind,resolution:relation.resolution,...(relation.reason?{reason:relation.reason}:{}),...(relation.toClaimId&&known.get(relation.toClaimId)?{earlier:known.get(relation.toClaimId)!.after,earlierStatus:retiredHistory.includes(known.get(relation.toClaimId)!)?"history_only":"still_current"}:relation.hint?{earlierHint:relation.hint}:{})}));
 const rows:Array<{priority:number;choice:boolean;value:object;evidenceIds:string[]}>=[];
 const add=(kind:string,text:string,proof:{quote:string;evidenceIds:string[]},extra:object={})=>{
  const originals=sources.filter(source=>proof.evidenceIds.includes(source.id)&&wikiQuoteRange(source.text,proof.quote));if(!originals.length)return;
  const user=originals.filter(source=>source.role==="user"),reported=user.some(source=>statementEvidence(source.text,proof.quote).report),chosen=user.some(source=>statementEvidence(source.text,proof.quote).decision);
  const contexts=originals.map(source=>wikiProofContext(source.text,proof.quote));
  const context=[...new Set(contexts.flatMap(item=>item.text?[item.text]:[]))];
  rows.push({priority:reported?5:chosen?4:kind==="change"?3:kind==="question"?2:kind==="relation"?1:0,choice:chosen,evidenceIds:originals.map(source=>source.id),value:{kind,text,...extra,quote:proof.quote,...(context.length?{context}:{}),...(contexts.some(item=>item.omitted)?{contextIncomplete:true}:{}),reading:reported?"user_report":chosen?"user_choice":user.length?"user_discussion":originals.every(source=>source.role==="assistant")?"assistant_discussion":"unknown",order:originals.map(source=>({conversation:source.conversationId,index:source.messageIndex,role:source.role??"unknown",...(source.discussedAt?{discussedAt:source.discussedAt}:{})}))}});
 };
 for(const state of states)if(state){
  for(const item of state.modules)add("module",`${item.title}: ${item.purpose}`,item,{status:item.status});
  for(const item of state.relations)add("relation",`${state.modules.find(module=>module.id===item.from)?.title??item.from} → ${state.modules.find(module=>module.id===item.to)?.title??item.to}: ${item.label}`,item);
  for(const kind of ["decisions","constraints","questions"] as const)for(const item of state[kind]??[])add(kind==="questions"?"question":kind,item.text,item,{status:item.status,...(item.matter?{matter:item.matter.state,subject:item.matter.subject,scope:item.matter.scope}:{})});
  for(const event of state.history??[]){const linked=links(event);add("change",event.after,event,{before:event.before,decisionStatus:event.decisionStatus,workStatus:event.workStatus,version:event.version,...(linked.length?{relations:linked}:{})});}
 }
 const selected:WikiGuideFact[]=[],seen=new Set<string>();let characters=0;
 const sorted=[...rows].sort((a,b)=>b.priority-a.priority);
 // Reserve coverage across fact families before spending the rest on high-ranked
 // rows. A long list of modules must not hide the unresolved decision family.
 const firsts=new Map<string,typeof rows[number]>();
 for(const row of sorted){const kind=(row.value as {kind:string}).kind;if(!firsts.has(kind))firsts.set(kind,row);}
 // Explicit choices deserve room before repeated progress reports. Reading
 // order is still carried as metadata, never used as adoption evidence.
 const choices=rows.filter(row=>row.choice).slice(-4).reverse();
 for(const row of [...firsts.values(),...choices,...sorted]){const key=JSON.stringify(row.value);if(seen.has(key))continue;if(characters+key.length>5750||selected.length>=24)continue;seen.add(key);characters+=key.length;selected.push({value:row.value,evidenceIds:row.evidenceIds});}
 return {facts:selected,omitted:rows.filter(row=>!seen.has(JSON.stringify(row.value))).length};
}

// Only catalogues that carry resolved change links pay for explaining them.
const RELATION_RULE=" relations.earlier marked history_only is an earlier record or rejected suggestion, never the current design; unresolved is not a replacement.";
const renderGuide=(values:object[],omitted:number)=>values.length?"\nSHARED PROJECT FACT CATALOGUE (partial navigation; full detail stays in owning material):\n"+JSON.stringify({facts:values,coverage:{included:values.length,omitted},rule:"Omitted rows are unknown here, never resolved, completed or superseded. Adoption and delivery are separate; keep unresolved relationships explicit."+(values.some(value=>"relations" in value)?RELATION_RULE:"")}):"";

export function wikiCurrentGuide(states:Array<ProjectState|undefined>,sources:WikiFactSource[],retiredHistory:ProjectHistoryEvent[]=[]):string {
 const catalogue=wikiGuideCatalogue(states,sources,retiredHistory);
 return renderGuide(catalogue.facts.map(fact=>fact.value),catalogue.omitted);
}

/** Shared message IDs are provenance, not semantic ownership: one message may
 * discuss several modules. Prefer the chapter retaining this fact's exact quote.
 * Legacy notes without text keep their stable provenance-only fallback. */
export function assignGuideOwners(catalogue:WikiGuideCatalogue,notes:Array<{rawEvidenceIds:string[];wikiOwnerId?:string;text?:string}>,ownerOrder:string[]):WikiGuideCatalogue {
 const supports=notes.map(note=>({...note,proof:note.text===undefined?undefined:wikiNoteEvidenceText([{text:note.text}])}));
 const cited=new Map<string,Map<string,number>>();
 for(const note of notes)if(note.wikiOwnerId)for(const id of note.rawEvidenceIds){const owners=cited.get(id)??new Map<string,number>();owners.set(note.wikiOwnerId,(owners.get(note.wikiOwnerId)??0)+1);cited.set(id,owners);}
 return {...catalogue,facts:catalogue.facts.map(fact=>{
  const counts=new Map<string,number>();
  for(const id of fact.evidenceIds)for(const [owner,count] of cited.get(id)??[])counts.set(owner,(counts.get(owner)??0)+count);
  const rank=(owner:string)=>{const index=ownerOrder.indexOf(owner);return index<0?ownerOrder.length:index;};
  const quote=(fact.value as {quote?:string}).quote;
  const matching=new Set(supports.filter(note=>note.wikiOwnerId&&note.proof!==undefined&&quote&&wikiQuoteRange(note.proof,quote)&&fact.evidenceIds.some(id=>note.rawEvidenceIds.includes(id))).map(note=>note.wikiOwnerId!));
  // A fact with ambiguous/no textual support must not be assigned merely because
  // another chapter repeats the same source message more often.
  const textual=supports.some(note=>note.proof!==undefined&&fact.evidenceIds.some(id=>note.rawEvidenceIds.includes(id)));
  const ownerId=matching.size===1?[...matching][0]:textual?undefined:[...counts].sort((a,b)=>b[1]-a[1]||rank(a[0])-rank(b[0]))[0]?.[0];
  return {value:fact.value,evidenceIds:fact.evidenceIds,...(ownerId?{ownerId}:{})};
 })};
}

const ELSEWHERE_RULE=". These belong to the named chapters, not to this request. If this chapter's own material depends on one, state the dependency in at most one sentence and name that chapter; never repeat its explanation, conditions or examples here. This chapter's own supplied material still decides what it must cover.";
const elsewhereText=(fact:WikiGuideFact)=>{const text=String((fact.value as {text?:unknown}).text??"");return text.length>120?text.slice(0,120)+"…":text;};

/** The catalogue for one writing request: its own chapters' facts in full, other
 * chapters' facts only as a named pointer, so shared facts are explained once. */
export function wikiChapterGuide(catalogue:WikiGuideCatalogue,ownerIds:ReadonlySet<string>,titles:ReadonlyMap<string,string>):string {
 const own=catalogue.facts.filter(fact=>!fact.ownerId||ownerIds.has(fact.ownerId));
 const elsewhere=catalogue.facts.filter(fact=>fact.ownerId&&!ownerIds.has(fact.ownerId)).map(fact=>({text:elsewhereText(fact),chapter:titles.get(fact.ownerId!)??fact.ownerId}));
 return renderGuide(own.map(fact=>fact.value),catalogue.omitted)+(elsewhere.length?"\nFACTS OWNED BY OTHER CHAPTERS (do not explain here): "+JSON.stringify(elsewhere)+ELSEWHERE_RULE:"");
}

/** Upper bound on what wikiChapterGuide adds beyond the full catalogue, for batch sizing. */
export function wikiChapterGuideAllowance(catalogue:WikiGuideCatalogue,titles:ReadonlyMap<string,string>):number {
 const longest=Math.max(0,...[...titles.values()].map(title=>title.length));
 return catalogue.facts.length?80+ELSEWHERE_RULE.length+catalogue.facts.reduce((sum,fact)=>sum+elsewhereText(fact).length+longest+40,0):0;
}
