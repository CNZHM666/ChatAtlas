import type {FocusSession,FocusSection} from "../shared/focus-session";
import {editableWikiTitle,type DirectoryPage} from "../shared/wiki-directory";
import type {AtlasAIProvider} from "./provider";
import {wikiTitleEdits,applyWikiTitleEdits,renameWikiHeadings} from "./wiki-title-pass";

export function sectionTitlePlan(sections:FocusSection[]):DirectoryPage[]{
 return sections.map(section=>({title:section.title,group:section.wikiGroup??"",question:section.wikiQuestion??section.title,sectionIds:[section.id],...(section.wikiSubtopics?.length?{subtopics:section.wikiSubtopics.map(topic=>({...topic,sectionIds:[section.id]}))}:{})}));
}

/** Common explicit-generation exit; reading saved projects never invokes it. */
export async function editWikiSessionTitles(session:FocusSession,ai:Pick<AtlasAIProvider,"generateStructured">,signal:AbortSignal,project?:"new"|"suggest",sectionIds?:string[]):Promise<FocusSession>{
 if(session.mode!=="work")return session;
 const eligible=session.sections.filter(section=>(!sectionIds||sectionIds.includes(section.id))&&editableWikiTitle(section)&&!session.wikiSuggestions?.[section.id]),plan=sectionTitlePlan(eligible).map((page,index)=>({...page,group:eligible[index].wikiGroupEdited?"":page.group}));
 if(!eligible.length)return session;
 let report=session.wikiTitleReview;
 const edits=await wikiTitleEdits(plan,session.locale??"zh-CN",ai,signal,{runId:session.runId,outline:sectionTitlePlan(session.sections).map(({title,question,group})=>({title,question,group})),reservedNames:{chapters:session.sections.map(section=>section.title),parts:session.sections.map(section=>section.wikiGroup??"")},onReport:value=>{report=value;},...(project?{project:{goal:session.goal,currentName:project==="suggest"?session.title:undefined,outline:sectionTitlePlan(session.sections).map(({title,question,group})=>({title,question,group}))}}:{})});
 signal.throwIfAborted();
 const titled=edits?applyWikiTitleEdits(plan,edits):plan;
 return {...session,wikiTitleReview:report,...(project==="suggest"?{wikiSuggestedTitle:edits?.documentTitle!==session.title?edits?.documentTitle:undefined}:project==="new"&&edits?.documentTitle?{title:edits.documentTitle}:{}),sections:session.sections.map(section=>{
  const index=eligible.findIndex(item=>item.id===section.id);if(index<0||!edits)return section;
  const page=titled[index],placement=section.wikiDiagram?.afterHeading;
  const renamedPlacement=placement?plan[index].subtopics?.findIndex(topic=>topic.title===placement):undefined;
  return {...section,title:page.title,wikiGroup:section.wikiGroupEdited?section.wikiGroup:page.group||undefined,body:renameWikiHeadings(section.body,plan[index],page),...(renamedPlacement!==undefined&&renamedPlacement>=0&&section.wikiDiagram?{wikiDiagram:{...section.wikiDiagram,afterHeading:page.subtopics?.[renamedPlacement]?.title??placement}}:{}),...(page.subtopics?{wikiSubtopics:page.subtopics.map(({title,question})=>({title,question}))}:{})};
 })};
}
