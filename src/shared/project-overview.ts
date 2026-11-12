import {projectKnowledgeIntroduction,projectIntroduction,projectKnowledgeView,knowledgeFactText} from "./project-knowledge-view";
import {projectSnapshot} from "./project-snapshot";
import {factTextKey} from "./project-fact-state";
import type { FocusSession } from "./focus-session";
import { discussionBlocks } from "./discussion-context";
import { evidencePresentation } from "./evidence-presentation";
import {completeProjectIntroduction,introductionPriority,projectPurposeText} from "./project-introduction-text";
import {aiAdvicePresentation} from "./ai-advice-presentation";
import {readingEmphasisMarkdown} from "./reading-emphasis";
import {currentWikiOverview} from "./wiki-overview";
import {qualifyWikiOverviewClaims} from "../ai/wiki-claim-review";

/** A common emphasis projection for overview UI and every export. */
export function projectOverviewReadingText(session:FocusSession,overview=projectOverviewContent(session)){
 if(session.briefUserEdited||session.projectMaintenance?.overview!==undefined)return overview.text;
 const phrases=session.sections.flatMap(section=>(section.claims??[]).filter(claim=>claim.overviewRole&&claim.evidenceIds.some(id=>overview.evidenceIds.includes(id))).flatMap(claim=>[claim.text,...claim.formulations??[]]));
 return readingEmphasisMarkdown(overview.text,{phrases});
}

export function projectOverviewText(session:FocusSession) {
  if(session.projectMaintenance?.overview!==undefined)return session.projectMaintenance.overview;
  if(session.briefUserEdited)return session.brief?.summary??"";
  const generated=currentWikiOverview(session);if(generated)return generated.text;
  const valid=(text?:string)=>Boolean(text?.trim()&&completeProjectIntroduction(text)&&introductionPriority(text)>=0&&text.trim()!==session.goal.trim()&&!/^(?:把|将|请|帮我)?全部已选对话|^create a project from all selected/iu.test(text));
  const introduction=projectKnowledgeIntroduction(session);
  if(valid(introduction)||session.knowledgeViewVersion===1)return introduction;
  if(valid(session.projectState?.summary))return projectPurposeText(session.projectState!.summary);
  for(const section of session.sections.filter(section=>section.kind==="finding"||section.kind==="review")){
    // A chapter introduction ("本章概述…") describes one chapter, not the project.
    const paragraph=discussionBlocks(section.body).find(block=>!/^\s*(?:[#>`~|*-]|\d+[.)])/u.test(block.text)&&!/^\s*(?:本章|这一章|本节)/u.test(block.text)&&block.text.length<=500&&valid(block.text));
    if(paragraph)return evidencePresentation(projectPurposeText(paragraph.text));
  }
  return "";
}

/** A connected overview in natural paragraphs, without a dashboard of headings
 * or another model summary. Complete saved facts retain their source pointers. */
export function projectOverviewContent(session:FocusSession){
 const intro=projectIntroduction(session),saved=projectOverviewText(session);
 if(intro.source==="personal")return {text:saved,evidenceIds:intro.evidenceIds};
 const base=qualifyWikiOverviewClaims(saved,session);
 const generated=currentWikiOverview(session);
 if(generated)return {text:aiAdvicePresentation(base),evidenceIds:generated.evidenceIds};
 const parts=base.trim()?[base.trim().replace(/\s*\n\s*/gu," ")]:[],ids=new Set(intro.evidenceIds);
 const sentence=(part:string)=>/[。！？.!?]$/u.test(part)?part:part+(session.locale==="en"?".":"。");
 const blocks=projectSnapshot(session);
 const scope=projectKnowledgeView(session).current.filter(fact=>fact.role==="scope"&&!fact.contested&&!fact.sourceChanged).map(fact=>({text:knowledgeFactText(fact,session.locale!=="en"),evidenceIds:fact.claim.evidenceIds}));
 let characters=parts.join("\n\n").length;
 // Current state comes only from user confirmations and reports, never from suggestions.
 const view=projectKnowledgeView(session),state:string[]=[];
 for(const fact of [...view.current.filter(fact=>!fact.contested&&fact.adoption==="accepted").slice(0,2),...view.current.filter(fact=>!fact.contested&&fact.implementation==="reported").slice(0,2)]){
  const text=knowledgeFactText(fact,session.locale!=="en"),key=factTextKey(text);
  if([...parts,...state].some(part=>factTextKey(part).includes(key))||characters+text.length>1100)continue;
  state.push(sentence(text.trim().replace(/\s*\n\s*/gu," ")));characters+=text.length;
  for(const id of fact.claim.evidenceIds)ids.add(id);
 }
 if(state.length)parts.push(state.join(" "));
 for(const role of ["workflow","boundary"] as const){
  const paragraph:string[]=[];
  for(const block of role==="workflow"?blocks.filter(block=>block.role==="workflow"):[...scope,...blocks.filter(block=>block.role==="constraint"),...blocks.filter(block=>block.role==="status")]){
   const key=factTextKey(block.text);if([...parts,...paragraph].some(part=>factTextKey(part).includes(key)))continue;
   if(characters+block.text.length>1100||paragraph.length>=2)continue;
   paragraph.push(sentence(block.text.trim().replace(/\s*\n\s*/gu," ")));characters+=block.text.length;
   for(const id of block.evidenceIds)ids.add(id);
  }
  if(paragraph.length)parts.push(paragraph.join(" "));
 }
 return {text:aiAdvicePresentation(parts.join("\n\n")),evidenceIds:[...ids]};
}
