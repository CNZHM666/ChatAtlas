import type {FocusSection} from "../shared/focus-session";
import type {DirectoryPage} from "../shared/wiki-directory";
import {sourceMessageSignature} from "../shared/source-signature";
import {AIProviderValidationError} from "./provider-errors";
import {knowledgeTerms} from "../shared/knowledge-subject";
import {catchAllChapter,projectNamedChapter,MAX_WIKI_SUBSECTIONS} from "../shared/wiki-directory-guard";

/** Chapters the directory asks for. Each chapter names one subject; parts
 * (the chapter group) keep related chapters together for navigation. */
export const MAX_WIKI_MAIN_CHAPTERS=10;
export const MAX_WIKI_PARTS=5;
/** Accepted when convergence stalls above the target: more single-subject
 * chapters read better than paired titles, a catch-all or a failed run. */
export const WIKI_CHAPTER_ACCEPT_LIMIT=14;
/** Materials per chapter a reader can review as one subject: fewer, fuller chapters
 * read less cluttered, so 56 materials become about 7 chapters. The chapter count
 * follows the material; 10 is only the ceiling. */
export const WIKI_MATERIALS_PER_CHAPTER=8;
export const MIN_WIKI_CHAPTERS=4;
/** Material counts measure how finely sources were cut, not how many subjects
 * they hold: one long conversation yields hundreds of materials. Breadth (the
 * number of source conversations) bounds the chapter count; volume only lowers it. */
export function wikiChapterBreadth(conversations:number):number{
 return Math.min(MAX_WIKI_MAIN_CHAPTERS,Math.round(4+2*Math.log2(Math.max(1,conversations)+1)));
}
export function wikiChapterTarget(materials:number,conversations?:number):number{
 const volume=Math.round(materials/WIKI_MATERIALS_PER_CHAPTER),ceiling=conversations===undefined?MAX_WIKI_MAIN_CHAPTERS:wikiChapterBreadth(conversations);
 return Math.min(MAX_WIKI_MAIN_CHAPTERS,Math.max(Math.min(MIN_WIKI_CHAPTERS,materials),Math.min(volume,ceiling)));
}
/** Subtopics a whole Wiki holds; each chapter's share is capped at MAX_WIKI_SUBSECTIONS. */
export const MAX_WIKI_SUBTOPICS=60;
export function wikiSubtopicLimit(chapters:number):number{
 return Math.min(MAX_WIKI_SUBSECTIONS,Math.max(3,Math.floor(MAX_WIKI_SUBTOPICS/Math.max(1,chapters))));
}
/** A title naming the whole project rather than one subject ("项目知识管理", "项目全景与优化"). */
const GENERIC_TITLE=/(?:项目|产品|系统|知识)(?:知识)?管理$|总览|概述|综述|概况|全景|整体|综合|其他|杂项|\b(?:overview|general|miscellaneous|other)\b/iu;
/** A chapter titled after the document or project itself ("Atlas 项目知识工作区" in a
 * document of that name), optionally with a generic tail ("Atlas 项目知识管理" for "Atlas"). */
export function documentNamedWikiTitle(title:string,names:Array<string|undefined>):boolean{
 const key=wikiNameKey(title);
 return names.some(name=>{
  const own=name?wikiNameKey(name):"";if(own.length<2)return false;
  return key===own||key.startsWith(own)&&GENERIC_TITLE.test(key.slice(own.length));
 });
}
/** Chapters that act as a catch-all: far more material than the median chapter,
 * a generic project-level title on a clearly larger chapter, or a title that is
 * the document's own name on any chapter that is not tiny: that name says nothing
 * about which subject it holds, whatever its size. Largest first. */
export function broadWikiChapters(pages:Array<Pick<DirectoryPage,"title"|"sectionIds">>,names:Array<string|undefined>=[]):number[]{
 if(pages.length<MIN_WIKI_CHAPTERS)return [];
 const sizes=pages.map(page=>page.sectionIds.length),sorted=[...sizes].sort((a,b)=>a-b),median=sorted[Math.floor(sorted.length/2)];
 // A project-named or catch-all title is refused at any size: it names no subject.
 return pages.flatMap((page,index)=>sizes[index]>=WIKI_MATERIALS_PER_CHAPTER*2&&sizes[index]>median*2.5
  ||GENERIC_TITLE.test(page.title)&&sizes[index]>median*1.5&&sizes[index]>=WIKI_MATERIALS_PER_CHAPTER
  ||unownedWikiTitle(page.title,names)?[index]:[]).sort((a,b)=>sizes[b]-sizes[a]||a-b);
}
/** A chapter title that names the project itself or a leftover bin, not a subject. */
export const unownedWikiTitle=(title:string,names:Array<string|undefined>)=>documentNamedWikiTitle(title,names)||projectNamedChapter(title,names)||catchAllChapter(title);

const terms=(text:string)=>knowledgeTerms(text);
const shared=(a:Set<string>,b:Set<string>)=>{let count=0;for(const term of a)if(b.has(term))count++;return count/Math.max(1,Math.min(a.size,b.size));};
type Subtopic=NonNullable<DirectoryPage["subtopics"]>[number];
const subtopicTerms=(topic:Subtopic)=>terms(`${topic.title} ${topic.question??""}`);

/** Planning acceptance, not a later repair: chapters that name the project or
 * hold leftovers are dissolved into the chapters their subtopics belong to,
 * before any prose is written. Material assignments move with them; nothing is
 * dropped. Without another chapter the page stays. */
export function dissolveUnownedWikiPages(pages:DirectoryPage[],names:Array<string|undefined>):DirectoryPage[]{
 const unowned=pages.filter(page=>unownedWikiTitle(page.title,names));
 const homes=pages.filter(page=>!unowned.includes(page));
 if(!unowned.length||!homes.length)return pages;
 const next=new Map(homes.map(page=>[page,{...page,sectionIds:[...page.sectionIds],subtopics:page.subtopics?.map(topic=>({...topic,sectionIds:[...topic.sectionIds??[]]}))}]));
 const profile=(page:DirectoryPage)=>terms([page.title,page.question,...(page.subtopics??[]).map(topic=>`${topic.title} ${topic.question??""}`)].join(" "));
 const profiles=new Map(homes.map(page=>[page,profile(page)]));
 const best=(own:Set<string>)=>homes.map(page=>({page,score:3*shared(own,terms(page.title))+shared(own,profiles.get(page)!)})).sort((a,b)=>b.score-a.score)[0].page;
 for(const page of unowned){
  const topics=page.subtopics?.length?page.subtopics:[{title:page.question||page.title,question:page.question,sectionIds:page.sectionIds}];
  const placed=new Map<string,DirectoryPage>();let main:DirectoryPage|undefined;
  for(const topic of topics){
   const home=best(subtopicTerms(topic)),target=next.get(home)!;main??=home;
   // Sibling subtopics may share a material; it stays with the first chapter that took it.
   const ids=(topic.sectionIds??[]).filter(id=>(placed.get(id)??home)===home);
   if(!ids.length)continue;
   ids.forEach(id=>placed.set(id,home));
   target.sectionIds=[...new Set([...target.sectionIds,...ids])];
   // A leftover heading ("核心机制") joins the home's closest subtopic instead of becoming one.
   if(unownedWikiTitle(topic.title,names)||!page.subtopics?.length){
    const into=(target.subtopics??[]).map((own,index)=>({index,score:shared(subtopicTerms(topic),subtopicTerms(own))})).sort((a,b)=>b.score-a.score)[0];
    if(into&&target.subtopics){target.subtopics[into.index]={...target.subtopics[into.index],sectionIds:[...new Set([...target.subtopics[into.index].sectionIds??[],...ids])]};continue;}
   }
   target.subtopics=[...target.subtopics??[],{...topic,sectionIds:[...ids]}];
  }
  const rest=page.sectionIds.filter(id=>!placed.has(id));
  if(rest.length&&main){const target=next.get(main)!;target.sectionIds=[...new Set([...target.sectionIds,...rest])];if(target.subtopics?.length)target.subtopics[target.subtopics.length-1]={...target.subtopics.at(-1)!,sectionIds:[...new Set([...target.subtopics.at(-1)!.sectionIds??[],...rest])]};}
 }
 return homes.map(page=>next.get(page)!);
}

/** Acceptance limit on planned subtopics: a chapter keeps at most its share, and
 * the most similar subtopics share one heading (the earlier title stays). Every
 * material assignment is kept, so the writer explains the same material under
 * fewer headings instead of one heading per fragment. */
export function capWikiSubtopics(pages:DirectoryPage[],limit=wikiSubtopicLimit(pages.length)):DirectoryPage[]{
 return pages.map(page=>{
  const topics=page.subtopics?.map(topic=>({...topic,sectionIds:[...topic.sectionIds??[]]}));
  if(!topics||topics.length<=limit)return page;
  while(topics.length>limit){
   let pick={score:-1,into:0,from:1};
   const sets=topics.map(subtopicTerms);
   for(let a=0;a<topics.length;a++)for(let b=a+1;b<topics.length;b++){
    // Similar subjects first; among equals, the smallest topic is absorbed.
    const score=shared(sets[a],sets[b])+1/(1+Math.min(topics[a].sectionIds.length,topics[b].sectionIds.length));
    if(score>pick.score)pick={score,into:a,from:b};
   }
   topics[pick.into]={...topics[pick.into],sectionIds:[...new Set([...topics[pick.into].sectionIds,...topics[pick.from].sectionIds])]};
   topics.splice(pick.from,1);
  }
  return {...page,subtopics:topics};
 });
}
export const genericWikiTitle=(title:string)=>GENERIC_TITLE.test(title);
/** A local catalogue window proposes a few broad candidates; the global step
 * owns the final chapter count. Many windows at the global target would add up. */
export const MAX_WIKI_WINDOW_CANDIDATES=7;
/** A convergence window's share of the chapter target, so one windowed round
 * sums to about the target instead of the target per window. */
export function wikiWindowTarget(windowSize:number,totalSize:number):number{
 // At least two per window keeps distinct subjects apart; the global pass merges the rest.
 return Math.min(windowSize,Math.max(2,Math.floor(MAX_WIKI_MAIN_CHAPTERS*windowSize/Math.max(1,totalSize))));
}
// Ignore display spacing and a Chinese editorial colon, not meaningful
// punctuation in signs, versions, languages or paths (e.g. -5V, V1.0, C#).
export const wikiNameKey=(text:string)=>text.normalize("NFKC").toLocaleLowerCase().replace(/(?<=\p{Script=Han}):(?=\p{Script=Han})/gu,"").replace(/[\p{Z}\s]/gu,"");
export function wikiOutlineError(reason:string,path="pages"):AIProviderValidationError {
 const error=new AIProviderValidationError(`wiki_directory_${reason}`);
 error.fieldPaths=[path];
 error.message="目录整理未完成，已保留原稿和阅读缓存。请重试目录整理。 / Outline incomplete; the original and reading cache are preserved.";
 return error;
}

/** Acceptance is independent of provider JSON validity. Never truncate pages. */
export function assertWikiOutline(pages:DirectoryPage[],requireHierarchy=true,maxMainCount=WIKI_CHAPTER_ACCEPT_LIMIT,options?:{allowDuplicateTitles?:boolean}):void {
 if(!pages.length||pages.length>maxMainCount){const error=wikiOutlineError("chapter_count");error.wikiDirectoryCounts={mainCount:pages.length,maxMainCount,subtopicCount:pages.reduce((sum,page)=>sum+(page.subtopics?.length??0),0)};throw error;}
 const titles=new Set<string>();
 for(const [index,page] of pages.entries()){
  const title=wikiNameKey(page.title);
  if(titles.has(title)&&!options?.allowDuplicateTitles)throw wikiOutlineError("duplicate_title",`pages[${index}].title`);
  titles.add(title);
  if(page.title.length>(/\p{Script=Han}/u.test(page.title)?32:72))throw wikiOutlineError("verbose_title",`pages[${index}].title`);
  // Conjunctions and shared vocabulary cannot establish duplicate subjects.
  // Keep semantic naming guidance in the planner, not a punctuation quota.
  if(requireHierarchy&&page.sectionIds.length>1&&!page.subtopics?.length)throw wikiOutlineError("hierarchy_missing",`pages[${index}].subtopics`);
 }
}

/** Identity follows a verified existing subject, not this run's first fragment. */
export function identifyWikiOwners(pages:DirectoryPage[],sections:FocusSection[]):DirectoryPage[]{
 const used=new Set<string>();
 return pages.map(page=>{
  const candidates=[...new Set(sections.filter(section=>page.sectionIds.includes(section.id)&&section.wikiOwnerId&&(wikiNameKey(section.title)===wikiNameKey(page.title)||wikiNameKey(section.wikiQuestion??"")===wikiNameKey(page.question))).map(section=>section.wikiOwnerId!))];
  const existing=candidates.length===1&&!used.has(candidates[0])?candidates[0]:undefined;
  const ownerId=existing??`wiki-owner:${sourceMessageSignature(wikiNameKey(page.title))}`;
  if(used.has(ownerId))throw wikiOutlineError("duplicate_owner");used.add(ownerId);
  return {...page,ownerId};
 });
}
