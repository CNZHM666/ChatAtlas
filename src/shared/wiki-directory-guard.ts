import {unified} from "unified";
import remarkParse from "remark-parse";
import type {FocusSection,FocusSession} from "./focus-session";
import {knowledgeTerms} from "./knowledge-subject";

const parser=unified().use(remarkParse);
/** Subsections one chapter can hold and still read as one subject. */
export const MAX_WIKI_SUBSECTIONS=12;

const key=(text:string)=>text.normalize("NFKC").toLocaleLowerCase().replace(/[\p{Z}\s]/gu,"");
/** Titles that hold whatever did not fit elsewhere ("核心机制", "其他", "Overview"). */
const CATCH_ALL=/^(?:(?:核心|关键|主要|基础|通用)(?:机制|功能|能力|模块|要点|内容|问题|设计)|其他|其它|杂项|补充(?:说明|内容)?|综合|综述|总览|概述|全景|整体(?:设计|方案)?)$|^(?:core (?:mechanisms?|features?|concepts?)|misc(?:ellaneous)?|other|general|overview)$/iu;
/** A chapter named after the document or the project names no subject. */
export function projectNamedChapter(title:string,names:Array<string|undefined>){
 const own=key(title);
 return names.some(name=>{const value=name?key(name):"";return value.length>=2&&(own===value||own.startsWith(value)&&/^(?:项目)?(?:知识)?(?:工作区|管理|总览|概览|整体|全景|介绍)?$/u.test(own.slice(value.length)));});
}
export const catchAllChapter=(title:string)=>CATCH_ALL.test(title.trim());

interface Part {title:string;content:string;from:string}
interface Chapter {section:FocusSection;lead:string;parts:Part[]}
function split(section:FocusSection):Chapter{
 const body=section.body,nodes=parser.parse(body).children;
 const headings=nodes.flatMap(node=>node.type==="heading"&&node.depth===2?[{start:node.position!.start.offset!,end:node.position!.end.offset!}]:[]);
 const lead=body.slice(0,headings[0]?.start??body.length).trim();
 const parts=headings.map((heading,index)=>({title:body.slice(heading.start,heading.end).replace(/^#+\s*/u,"").trim(),content:body.slice(heading.end,headings[index+1]?.start??body.length).trim(),from:section.id}));
 return {section,lead,parts};
}
const compose=(chapter:Chapter)=>[chapter.lead,...chapter.parts.map(part=>[`## ${part.title}`,part.content].filter(Boolean).join("\n\n"))].filter(Boolean).join("\n\n");
const overlap=(a:Set<string>,b:Set<string>)=>{let shared=0;for(const term of a)if(b.has(term))shared++;return shared;};
const ratio=(a:Set<string>,b:Set<string>)=>overlap(a,b)/Math.max(1,Math.min(a.size,b.size));

// English words common in Chinese project titles, so "Context Engine" and a
// chapter titled 上下文引擎 name the same subject. Only title matching uses this.
const TITLE_ALIASES:Record<string,string>={context:"上下文",engine:"引擎",search:"搜索",retrieval:"检索",index:"索引",indexing:"索引",sidebar:"侧边栏",knowledge:"知识",memory:"记忆",reader:"阅读",export:"导出",import:"导入",pack:"包",architecture:"架构",dashboard:"仪表盘"};
export function wikiTitleTerms(text:string){
 const translated=(text.toLocaleLowerCase().match(/[a-z]+/gu)??[]).map(word=>TITLE_ALIASES[word]??"").join("");
 return knowledgeTerms(translated?`${text} ${translated}`:text);
}
/** Named subjects a chapter explains: multi-word or camel-case English names it
 * uses far more than any other chapter ("Context Engine", "Orama"). A chapter
 * titled after the subject itself owns it, whatever the mention counts. */
function ownedNames(chapters:Chapter[]){
 const NAME=/\b(?:[A-Z][A-Za-z]+(?:\s[A-Z][A-Za-z]+)+|[A-Z][a-z]+[A-Z][A-Za-z]*)\b/gu;
 const counts=chapters.map(chapter=>{const map=new Map<string,number>();for(const match of compose(chapter).matchAll(NAME))map.set(match[0],(map.get(match[0])??0)+1);return map;});
 const owner=new Map<string,number>();
 for(const name of new Set(counts.flatMap(map=>[...map.keys()]))){
  const ranked=counts.map((map,index)=>({index,count:map.get(name)??0})).sort((a,b)=>b.count-a.count);
  const own=wikiTitleTerms(name),titled=own.size>=2?chapters.findIndex(chapter=>overlap(own,wikiTitleTerms(chapter.section.title))>=Math.max(2,Math.ceil(own.size*.6))):-1;
  if(titled>=0)owner.set(name.toLocaleLowerCase(),titled);
  else if(ranked[0].count>=5&&ranked[0].count>=2*(ranked[1]?.count??0))owner.set(name.toLocaleLowerCase(),ranked[0].index);
 }
 return owner;
}

export interface WikiDirectoryGuardReport {dissolved:string[];moved:number;merged:number}

/** One subject, one chapter, after the directory is organized. Chapters named
 * after the project or acting as catch-alls are dissolved into the chapters
 * their subsections belong to; a subsection naming another chapter's main
 * subject moves there; twin and surplus subsections merge under one heading.
 * Text, claims and sources move with their subsection; nothing is deleted.
 * Personal chapters, chapters with notes and edited titles are never changed. */
export function guardWikiDirectory(session:FocusSession,order:string[]=session.sections.map(section=>section.id)):{session:FocusSession;report:WikiDirectoryGuardReport}{
 const report:WikiDirectoryGuardReport={dissolved:[],moved:0,merged:0};
 if(session.mode!=="work")return {session,report};
 const protectedChapter=(section:FocusSection)=>Boolean(section.userEdited||section.origin||section.structureEdited||session.sectionNotes?.[section.id]?.text?.trim()||session.wikiSuggestions?.[section.id]);
 const chapters=order.flatMap(id=>session.sections.filter(section=>section.id===id&&!protectedChapter(section))).map(split);
 if(chapters.length<2)return {session,report};
 const names=[session.title,session.goal];
 const terms=(text:string)=>knowledgeTerms(text);
 // Paragraph-level term counts, weighted by how few chapters use a term: a large
 // chapter does not win a subsection merely by containing more words.
 const counts=(text:string)=>{const map=new Map<string,number>();for(const paragraph of text.split(/\n\s*\n/u))for(const term of terms(paragraph))map.set(term,(map.get(term)??0)+1);return map;};
 const chapterCounts=new Map(chapters.map(chapter=>[chapter,counts(compose(chapter))]));
 const idf=new Map<string,number>();
 for(const map of chapterCounts.values())for(const term of map.keys())idf.set(term,(idf.get(term)??0)+1);
 for(const [term,df] of idf)idf.set(term,Math.log(1+chapters.length/df));
 const cosine=(a:Map<string,number>,b:Map<string,number>)=>{let dot=0,left=0,right=0;for(const [term,count] of a){const weight=idf.get(term)??Math.log(1+chapters.length);const x=count*weight;left+=x*x;const y=(b.get(term)??0)*weight;dot+=x*y;}for(const [term,count] of b){const weight=idf.get(term)??0;right+=(count*weight)**2;}return left&&right?dot/Math.sqrt(left*right):0;};
 const profile=(chapter:Chapter)=>({title:terms(chapter.section.title),subtitles:terms(chapter.parts.map(part=>part.title).join(" ")),body:chapterCounts.get(chapter)!});
 const moves:Array<{part:Part;to:Chapter}>=[];
 // 1. Dissolve project-named and catch-all chapters into the best-matching chapters.
 const dissolve=chapters.filter(chapter=>projectNamedChapter(chapter.section.title,names)||catchAllChapter(chapter.section.title));
 const homes=chapters.filter(chapter=>!dissolve.includes(chapter));
 if(homes.length){
  const profiles=new Map(homes.map(chapter=>[chapter,profile(chapter)]));
  for(const chapter of dissolve){
   // Without subheadings the whole chapter joins its new home's opening, untitled.
   const parts=chapter.parts.length?chapter.parts:[{title:"",content:chapter.lead,from:chapter.section.id}];
   if(chapter.parts.length&&chapter.lead)parts[0]={...parts[0],content:[chapter.lead,parts[0].content].filter(Boolean).join("\n\n")};
   for(const part of parts){
    const title=terms(part.title),content=counts(`${part.title}\n\n${part.content}`);
    const scored=homes.map(home=>{const own=profiles.get(home)!;return {home,score:3*overlap(title,own.title)+overlap(title,own.subtitles)+20*cosine(content,own.body)};}).sort((a,b)=>b.score-a.score);
    moves.push({part,to:scored[0].home});
   }
   chapter.parts=[];chapter.lead="";report.dissolved.push(chapter.section.title);
  }
 }
 // 2. A subsection named after another chapter's own subject moves to that chapter.
 const owners=ownedNames(chapters.filter(chapter=>!dissolve.includes(chapter)));
 const kept=chapters.filter(chapter=>!dissolve.includes(chapter));
 for(const [index,chapter] of kept.entries()){
  chapter.parts=chapter.parts.filter(part=>{
   const title=part.title.toLocaleLowerCase();
   let target=kept.find((other,at)=>at!==index&&(title.includes(other.section.title.toLocaleLowerCase())&&other.section.title.length>=3||[...owners].some(([name,owner])=>owner===kept.indexOf(other)&&title.includes(name))));
   // Its title names another chapter's subject more than its own ("Context Pack" under 系统架构, 上下文引擎 elsewhere).
   if(!target){
    const own=wikiTitleTerms(part.title),here=overlap(own,wikiTitleTerms(chapter.section.title));
    target=kept.map((other,at)=>{const subject=wikiTitleTerms(other.section.title),shared=overlap(own,subject);return {other,at,shared,fits:at!==index&&subject.size>=3&&shared>=2&&shared/subject.size>=.5&&shared>here};}).filter(row=>row.fits).sort((a,b)=>b.shared-a.shared)[0]?.other;
   }
   if(!target)return true;
   moves.push({part,to:target});return false;
  });
 }
 for(const move of moves){if(move.part.title)move.to.parts.push(move.part);else move.to.lead=[move.to.lead,move.part.content].filter(Boolean).join("\n\n");report.moved++;}
 // Same-titled subsections in different chapters are one subject: they join in the chapter whose text fits both best.
 for(let a=0;a<kept.length;a++)for(let b=a+1;b<kept.length;b++){
  for(const later of [...kept[b].parts]){
   const title=terms(later.title),earlier=kept[a].parts.find(part=>{const own=terms(part.title);return overlap(own,title)>=3&&ratio(own,title)>=.6;});
   if(!earlier)continue;
   const both=counts(`${earlier.title}\n\n${earlier.content}\n\n${later.content}`);
   const [home,away,kept1,moved]=cosine(both,chapterCounts.get(kept[a])!)>=cosine(both,chapterCounts.get(kept[b])!)?[kept[a],kept[b],earlier,later]:[kept[b],kept[a],later,earlier];
   kept1.content=[kept1.content,moved.content].filter(Boolean).join("\n\n");
   away.parts=away.parts.filter(part=>part!==moved);
   // Recorded after placement: claims and sources follow it, it is not appended again.
   moves.push({part:moved,to:home});report.moved++;
  }
 }
 // 3. Twin and surplus subsections merge into the most similar earlier one.
 for(const chapter of kept){
  const join=(into:Part,from:Part)=>{into.content=[into.content,from.content].filter(Boolean).join("\n\n");report.merged++;};
  for(let later=chapter.parts.length-1;later>0;later--){
   const title=terms(chapter.parts[later].title);
   const twin=chapter.parts.slice(0,later).find(part=>{const own=terms(part.title);return overlap(own,title)>=3&&ratio(own,title)>=.6;});
   if(twin){join(twin,chapter.parts[later]);chapter.parts.splice(later,1);}
  }
  // A catch-all or project-named heading says nothing either: its text joins its closest sibling.
  for(let at=chapter.parts.length-1;at>=0&&chapter.parts.length>1;at--){
   const part=chapter.parts[at];if(!catchAllChapter(part.title)&&!projectNamedChapter(part.title,names))continue;
   const own=terms(part.content);
   const into=chapter.parts.map((other,index)=>({index,score:index===at?-1:ratio(own,terms(other.content))+ratio(terms(part.title),terms(other.title))})).sort((a,b)=>b.score-a.score)[0].index;
   join(chapter.parts[into],part);chapter.parts.splice(at,1);
  }
  while(chapter.parts.length>MAX_WIKI_SUBSECTIONS){
   let best={score:-1,into:0,from:1};
   const sets=chapter.parts.map(part=>({title:terms(part.title),content:terms(part.content)}));
   for(let a=0;a<sets.length;a++)for(let b=a+1;b<sets.length;b++){const score=3*ratio(sets[a].title,sets[b].title)+ratio(sets[a].content,sets[b].content);if(score>best.score)best={score,into:a,from:b};}
   join(chapter.parts[best.into],chapter.parts[best.from]);chapter.parts.splice(best.from,1);
  }
 }
 if(!report.dissolved.length&&!report.moved&&!report.merged)return {session,report};
 // Claims and sources follow the text they belong to.
 const byId=new Map(session.sections.map(section=>[section.id,section]));
 const present=(claim:NonNullable<FocusSection["claims"]>[number],text:string)=>[claim.text,...claim.formulations??[]].some(form=>form&&text.replace(/\*\*/gu,"").includes(form.replace(/\*\*/gu,"")));
 const next=new Map<string,FocusSection>();
 for(const chapter of kept){
  const body=compose(chapter),own=chapter.section;
  const sources=[...new Set(moves.filter(move=>move.to===chapter).map(move=>move.part.from).filter(id=>id!==own.id))].map(id=>byId.get(id)!);
  const incoming=sources.flatMap(source=>(source.claims??[]).filter(claim=>present(claim,body)));
  // A claim leaves with its text: kept here only while this chapter still states it.
  const left=moves.filter(move=>move.part.from===own.id&&move.to!==chapter).map(move=>move.part.content).join("\n\n");
  const staying=(own.claims??[]).filter(claim=>present(claim,body)||!present(claim,left));
  const claims=[...staying,...incoming.filter(claim=>!staying.includes(claim))];
  const titles=new Set(chapter.parts.map(part=>part.title));
  const subtopics=[...own.wikiSubtopics??[],...sources.flatMap(source=>source.wikiSubtopics??[])].filter((topic,index,all)=>titles.has(topic.title)&&all.findIndex(other=>other.title===topic.title)===index);
  next.set(own.id,{...own,body,...(own.claims||incoming.length?{claims}:{}),evidenceIds:[...new Set([...own.evidenceIds,...incoming.flatMap(claim=>claim.evidenceIds)])],...(own.wikiSubtopics||subtopics.length?{wikiSubtopics:subtopics.length?subtopics:undefined}:{})});
 }
 // A dissolved chapter's remaining sources and scope keys go to the chapter that took most of it.
 const aliases:Record<string,string>={...session.wikiSectionAliases};
 for(const chapter of dissolve){
  const counts=new Map<string,number>();for(const move of moves)if(move.part.from===chapter.section.id)counts.set(move.to.section.id,(counts.get(move.to.section.id)??0)+move.part.content.length);
  const main=[...counts].sort((a,b)=>b[1]-a[1])[0]?.[0];if(!main)continue;
  const target=next.get(main)!;
  next.set(main,{...target,evidenceIds:[...new Set([...target.evidenceIds,...chapter.section.evidenceIds])],...(chapter.section.wikiMaterialKeys?.length?{wikiMaterialKeys:[...new Set([...target.wikiMaterialKeys??[],...chapter.section.wikiMaterialKeys])]}:{})});
  aliases[chapter.section.id]=main;
 }
 const removed=new Set(dissolve.filter(chapter=>aliases[chapter.section.id]).map(chapter=>chapter.section.id));
 const sections=session.sections.filter(section=>!removed.has(section.id)).map(section=>next.get(section.id)??section);
 return {report,session:{...session,sections,...(removed.size?{wikiSectionAliases:aliases,wikiOrder:session.wikiOrder?.filter(id=>!removed.has(id)),completedSectionIds:session.completedSectionIds.filter(id=>!removed.has(id)),activeSectionId:removed.has(session.activeSectionId)?aliases[session.activeSectionId]:session.activeSectionId}:{})}};
}
