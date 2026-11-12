import type {FocusSession,FocusSection} from "./focus-session";
import {projectMatters} from "./project-matters";
import {matterNeedsAttention} from "./project-work-queue";
import {knowledgeBodyPresentation} from "./wiki-knowledge-prose";
import {factTextKey} from "./project-fact-state";
import {projectKnowledgeFacts,type ProjectKnowledgeFact} from "./project-knowledge-facts";
import {completeProjectIntroduction,projectIntroductionParagraphs,introductionPriority,projectPurposeText} from "./project-introduction-text";
import {wikiStatusProse} from "./wiki-status-prose";
import {wikiReadingCleanup} from "./wiki-reading-cleanup";
import {wikiDisplayMath} from "./wiki-display-math";
import {wikiReadingFormat} from "./wiki-reading-format";
import {wikiChapterLinks,wikiUnitChapterHomes} from "./wiki-chapter-links";
import {qualifyWikiPriceTables} from "./wiki-document-blocks";
import {wikiSections} from "./wiki-navigation";
import {knowledgeOverlap} from "./knowledge-subject";
import {reviewWikiChapter} from "../ai/wiki-claim-review";
export type {ProjectKnowledgeFact} from "./project-knowledge-facts";

/** Topic-local navigation from already saved facts. Whole rows only, bounded
 * independently of the raw reading cache and never new source evidence. */
export function relatedProjectFacts(session:FocusSession,sectionId:string,query:string){
 const view=projectKnowledgeFacts(session),selected:ProjectKnowledgeFact[]=[];let characters=0;
 // Unresolved scoped records are part of the writing context. Omitting them
 // would make the surviving alternative appear to be an uncontested choice.
 const eligible=view.facts.filter(fact=>!fact.historical&&!fact.sourceChanged);
 const rows=eligible.map(fact=>({fact,score:(fact.sectionId===sectionId?20:0)+knowledgeOverlap(query,`${fact.claim.subject??""} ${fact.claim.text}`).length*3+(fact.role==="stage"?2:0)})).sort((a,b)=>b.score-a.score);
 for(const {fact,score} of rows){if(!score)continue;const size=fact.claim.text.length+fact.claim.quote.length;if(selected.length>=16||characters+size>5000)continue;selected.push(fact);characters+=size;}
 return {facts:selected.map(fact=>({text:fact.claim.text,quote:fact.claim.quote,subject:fact.claim.subject,scope:fact.claim.scope,status:fact.status,historical:fact.historical,adoption:fact.adoption,implementation:fact.implementation,contested:Boolean(fact.contested),scopeConflict:fact.scopeConflict})),coverage:{included:selected.length,omitted:eligible.length-selected.length}};
}

/** Shared current knowledge; source reports and chosen plans remain separate. */
export function projectKnowledgeView(session:FocusSession){
 const view=projectKnowledgeFacts(session);
 const candidates=view.current.filter(fact=>!fact.contested&&["purpose","scope"].includes(fact.role??"")&&completeProjectIntroduction(fact.claim.text)&&introductionPriority(fact.claim.text)>=0&&!/已完成|已实现|\bcompleted\b/iu.test(fact.claim.text));
 const ranked=candidates.sort((a,b)=>introductionPriority(b.claim.text)-introductionPriority(a.claim.text)||Number(b.claim.overviewRole==="purpose")-Number(a.claim.overviewRole==="purpose"));
 const purpose=ranked[0];
 const questions=projectMatters(session).filter(matter=>matter.status==="open"&&matterNeedsAttention(session,matter));
 return {...view,purpose,questions};
}

// Generated wording that asserts a user choice or adoption. Model prose cannot
// supply it; only an original user decision (adoption "accepted") can.
const ADOPTION_ZH=/(?:用户|团队|我们|项目)?(?:已经|已|最终|明确)+(?:正式)?(?:确认|决定|选定|采纳|拍板)了?(?=采用|使用|选择|选用|改用|改为|将|把|以|由)|(?:用户|团队|我们)(?:决定|选定|采纳|拍板)了?(?=采用|使用|选择|选用|改用|改为|将|把|以|由)|(?:用户|团队|我们|项目)?(?:已经|已|最终)(?:正式)?(?=采用|选用|选定)/gu;
const ADOPTION_EN=/\b(?:the user|the team|we)\s+(?:has\s+|have\s+)?(?:(?:explicitly|finally)\s+)?(?:confirmed|decided|chosen|chose|adopted)(?:\s+(?:that|to))?\s+/giu;
// Remaining wording that still names a decision once the leading claim is removed.
const ADOPTION_LEFT=/已(?:经)?(?:被)?(?:用户)?(?:确认|决定|采纳|选定|采用)|(?:用户|团队)(?:已经?|明确|最终)(?:确认|决定)|\b(?:confirmed|adopted|decided)\b/iu;
const ADOPTION_CLAIM=/(?:用户|团队|我们)(?:已经?|明确|最终)(?:确认|决定)|已(?:经)?被用户(?:确认|采纳)/u;
/** A fact without an original user decision keeps its content but not a
 * generated "the user confirmed" claim; the status is stated at that sentence. */
export function unsupportedAdoption(fact:ProjectKnowledgeFact,text=fact.claim.text){
 if(fact.adoption==="accepted"||fact.historical||fact.status==="reported"||fact.status==="personal")return false;
 return ADOPTION_CLAIM.test(text)||new RegExp(ADOPTION_ZH.source,"u").test(text)||new RegExp(ADOPTION_EN.source,"iu").test(text);
}
/** The fact's content without a generated adoption claim it cannot support; undefined when inseparable. */
export function knowledgeFactCore(fact:ProjectKnowledgeFact,text=fact.claim.text):string|undefined{
 if(!unsupportedAdoption(fact,text))return text;
 const stripped=text.replace(ADOPTION_ZH,"").replace(ADOPTION_EN,"").trim();
 const core=/^[a-z]/u.test(stripped)?stripped[0].toUpperCase()+stripped.slice(1):stripped;
 return core&&!ADOPTION_LEFT.test(core)?core:undefined;
}
function withoutAdoption(fact:ProjectKnowledgeFact,text:string,zh:boolean){
 const core=knowledgeFactCore(fact,text)??"";
 // What could not be detached is shown as the unverified record it is.
 if(!core||ADOPTION_LEFT.test(core))return (zh?"讨论记录（所选来源中未发现用户明确确认）：":"Discussion record (no explicit user confirmation found in the selected sources): ")+text;
 if(fact.status==="proposal")return (zh?"讨论建议（未发现用户确认）：":"Discussion proposal (no user confirmation found): ")+core;
 if(fact.status==="planned")return (zh?"计划（未发现用户确认）：":"Planned (no user confirmation found): ")+core;
 return (zh?"所选来源中未发现用户明确确认：":"No explicit user confirmation found in the selected sources: ")+core;
}

export function knowledgeFactText(fact:ProjectKnowledgeFact,zh=true,formulation=fact.claim.text,learning=false){
 const text=knowledgeBodyPresentation(formulation,[fact.claim],zh,()=>({reported:fact.implementation==="reported"}));
 // A sentence with a holder mark already says whose it is: no holder label goes before it, and decided wording it
 // cannot support is only taken out. What changes its meaning (replaced, unreconciled, source changed) is still said.
 if(fact.claim.holder&&!fact.historical&&!fact.scopeConflict&&!fact.sourceChanged&&!fact.contested)return unsupportedAdoption(fact,text)?knowledgeFactCore(fact,text)??text:text;
 if(!fact.contested&&!fact.sourceChanged&&!fact.scopeConflict&&unsupportedAdoption(fact,text))return withoutAdoption(fact,text,zh);
 if(fact.historical)return (zh?fact.role==="stage"?"此前的阶段记录：":"此前记录：":"Earlier record: ")+text;
 if(fact.scopeConflict)return (zh?"版本范围尚待核对：":"Version scope requires review: ")+text;
 if(fact.sourceChanged)return (zh?"原记录（来源已变化）：":"Earlier record (source changed): ")+text;
 if(fact.contested)return (zh?"尚待统一的记录：":"Unreconciled record: ")+text;
 // A learning record's points are lessons, not a project's decisions: "已选择的方案：" before a Git acceptance standard
 // and "讨论建议：" before an explanation told nothing.
 if(learning)return text;
 if(fact.status==="reported"&&!/用户(?:报告|反馈|表示)|\b(?:user reported|reported by the user)/iu.test(text))return (zh?"用户报告：":"User reported: ")+text;
 if(fact.adoption==="accepted"&&!/已(?:经)?(?:决定|选择|确认|采用)|决定|确认采用|\b(?:decided|confirmed|adopted|chosen)\b/iu.test(text))return (zh?"已选择的方案：":"Chosen approach: ")+text;
 if(fact.status==="proposal"&&!/建议|提议|拟|\b(?:suggest|propos|recommend)/iu.test(text))return (zh?"讨论建议：":"Discussion proposal: ")+text;
 if(fact.status==="planned"&&!/计划|拟|\b(?:plan|intend)/iu.test(text))return (zh?"计划：":"Planned: ")+text;
 return text;
}

export interface ProjectIntroduction {text:string;evidenceIds:string[];sectionIds:string[];source:"personal"|"claims"|"legacy"}
/** One introduction and its provenance for Brief, UI and every export. */
export function projectIntroduction(session:FocusSession):ProjectIntroduction{
 if(session.projectMaintenance?.overview!==undefined)return {text:session.projectMaintenance.overview,evidenceIds:[],sectionIds:[],source:"personal"};
 if(session.briefUserEdited)return {text:session.brief?.summary??"",evidenceIds:[],sectionIds:[],source:"personal"};
 const view=projectKnowledgeView(session),chosen:ProjectKnowledgeFact[]=[];
 if(view.purpose){
  chosen.push(view.purpose);
  for(const fact of view.current.filter(fact=>fact!==view.purpose&&!fact.contested&&fact.role==="purpose")){
   const text=projectPurposeText(fact.claim.text),key=factTextKey(text);
   if(!completeProjectIntroduction(text)||introductionPriority(text)<0||chosen.some(previous=>factTextKey(projectPurposeText(previous.claim.text)).includes(key)||key.includes(factTextKey(projectPurposeText(previous.claim.text)))))continue;
   if(chosen.length>=2||chosen.reduce((length,row)=>length+projectPurposeText(row.claim.text).length,0)+text.length>520)continue;
   chosen.push(fact);
  }
  return {text:chosen.map(fact=>knowledgeFactText(fact,session.locale!=="en",projectPurposeText(fact.claim.text))).join("\n\n"),evidenceIds:[...new Set(chosen.flatMap(fact=>fact.claim.evidenceIds))],sectionIds:[...new Set(chosen.map(fact=>fact.sectionId))],source:"claims"};
 }
 const candidates=session.sections.flatMap(section=>{
  if(section.origin||section.userEdited||section.reviewIssue||!section.evidenceIds.length||!/定位|概况|项目介绍|产品介绍|positioning|overview|introduction/iu.test(section.title))return [];
  return projectIntroductionParagraphs(section.body).filter(text=>!/已完成|已实现|\b(?:completed|implemented)/iu.test(text)).map(text=>({text,section}));
 }).sort((a,b)=>introductionPriority(b.text)-introductionPriority(a.text));
 const candidate=candidates.find(candidate=>introductionPriority(candidate.text)>=0);
 const brief=!session.knowledgeViewVersion&&completeProjectIntroduction(session.brief?.summary??"")&&introductionPriority(session.brief!.summary)>=0?session.brief!.summary:undefined;
 if(brief&&(!candidate||introductionPriority(brief)>=introductionPriority(candidate.text)))return {text:knowledgeBodyPresentation(projectPurposeText(brief),[],session.locale!=="en"),evidenceIds:[],sectionIds:[],source:"legacy"};
 if(candidate)return {text:knowledgeBodyPresentation(projectPurposeText(candidate.text),[],session.locale!=="en"),evidenceIds:[...candidate.section.evidenceIds],sectionIds:[candidate.section.id],source:"legacy"};
 const legacy=session.knowledgeViewVersion?"":session.projectState?.summary??"";
 return {text:completeProjectIntroduction(legacy)?knowledgeBodyPresentation(projectPurposeText(legacy),[],session.locale!=="en"):"",evidenceIds:[],sectionIds:[],source:"legacy"};
}

export function projectKnowledgeIntroduction(session:FocusSession){return projectIntroduction(session).text;}

/** Qualify only complete generated assertion spans; originals and personal text
 * remain intact. A chosen plan is never evidence that its code was delivered. */
export function projectKnowledgeSection(section:FocusSection,session:FocusSession,view=projectKnowledgeView(session)):FocusSection {
 if(section.origin||section.userEdited)return section;
 section=reviewWikiChapter(section,session);
 const facts=view.facts.filter(fact=>fact.sectionId===section.id),learning=session.wikiKnowledge?.documentType==="learning";
 const replacements=new Map<string,string>();
 for(const fact of facts){
  if(fact.historical||fact.contested||fact.sourceChanged||fact.scopeConflict||fact.adoption==="accepted"||fact.status==="reported"||unsupportedAdoption(fact)||(fact.claim.formulations??[]).some(text=>unsupportedAdoption(fact,text)))replacements.set(factTextKey(fact.claim.text),knowledgeFactText(fact,session.locale!=="en",fact.claim.text,learning));
 }
 // A multi-line formula is fixed first, before any step parses its "=" line as a heading.
 const body=knowledgeBodyPresentation(wikiDisplayMath(section.body),section.claims??[],session.locale!=="en",(claim,formulation)=>{
  const fact=facts.find(fact=>factTextKey(fact.claim.text)===factTextKey(claim.text));
  return fact?{reported:fact.implementation==="reported",text:replacements.has(factTextKey(claim.text))?knowledgeFactText(fact,session.locale!=="en",formulation,learning):undefined}:undefined;
 });
 // The chapter status line states "mostly unconfirmed AI proposals" once; prose need not repeat it.
 // Batch-written chapters also repeat introductions and near-identical paragraphs.
 const zh=session.locale!=="en",cleaned=wikiReadingCleanup(zh?wikiStatusProse(body,section):body,section);
 const accepted=new Set(facts.filter(fact=>fact.adoption==="accepted"&&!fact.historical&&!fact.contested&&!fact.scopeConflict&&!fact.sourceChanged&&fact.status!=="uncertain").map(fact=>fact.claim));
 return {...section,body:learning?cleaned:qualifyWikiPriceTables(cleaned,section.claims??[],accepted,zh)};
}

/** The chapter as read in Reader and exports: history gathered per section, long
 * paragraphs split, and a paragraph an earlier chapter already explains becomes a
 * link to that chapter. Context packs keep the full projection instead. */
export function projectKnowledgeReading(section:FocusSection,session:FocusSession,view=projectKnowledgeView(session),chapters=wikiSections(session)):FocusSection {
 const projected=projectKnowledgeSection(section,session,view);
 if(section.origin||section.userEdited)return projected;
 const homes=session.wikiKnowledge?wikiUnitChapterHomes(session.wikiKnowledge.organization):undefined;
 const reviewed=chapters.map(chapter=>reviewWikiChapter(chapter,session));
 return {...projected,body:wikiChapterLinks(wikiReadingFormat(projected.body,projected),projected,reviewed,session.locale!=="en",homes)};
}
