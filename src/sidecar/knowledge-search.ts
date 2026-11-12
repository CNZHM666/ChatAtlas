import type {FocusSession} from "../shared/focus-session";
import {wikiSections,localizedWikiTitle} from "../shared/wiki-navigation";
import {readableSourceText} from "../shared/source-text-display";
import {projectDocument} from "../export/project-document";
import {formatComposerReference,plainComposerReference} from "../shared/composer-reference";

export interface KnowledgeHit {sessionId:string;sectionId:string;project:string;chapter:string;excerpt:string;score:number}

const terms=(query:string)=>{
 const text=query.normalize("NFKC").toLocaleLowerCase().replace(/["“”]/gu,"").trim();
 // Whole query first; then words and 2+ character Chinese runs, so "侧栏 职责" and "侧栏职责" both match.
 return [...new Set([text,...text.split(/[\s,，、。；;:：!?！？]+/u)].filter(term=>Array.from(term).length>=2))];
};
const plain=(body:string)=>readableSourceText(body.replace(/!?\[([^\]]*)\]\([^)]*\)/gu,"$1").replace(/`/gu,"")).replace(/\s+/gu," ");

/** Already organized knowledge that matches the query, from saved Wiki chapters
 * only. Local text matching, no model call; personal edits are searched as written. */
export function searchKnowledge(query:string,projects:FocusSession[],zh:boolean,limit=3):KnowledgeHit[] {
 const wanted=terms(query);if(!wanted.length)return [];
 const hits:KnowledgeHit[]=[];
 for(const session of projects)for(const section of wikiSections(session)){
  const chapter=localizedWikiTitle(section,zh)||section.title,title=chapter.toLocaleLowerCase(),body=plain(section.body),lower=body.toLocaleLowerCase();
  let score=0,first=-1;
  for(const [index,term] of wanted.entries()){
   const weight=index===0?3:1,inTitle=title.includes(term),at=lower.indexOf(term);
   if(inTitle)score+=4*weight;
   if(at>=0){score+=weight*Math.min(3,lower.split(term).length-1);if(first<0||index===0)first=at;}
  }
  if(!score)continue;
  const start=Math.max(0,first<0?0:first-30),excerpt=body.slice(start,start+110).trim();
  hits.push({sessionId:session.id,sectionId:section.id,project:session.title,chapter,excerpt:`${start>0?"…":""}${excerpt}${start+110<body.length?"…":""}`,score});
 }
 return hits.sort((a,b)=>b.score-a.score).slice(0,limit);
}

/** The chapter's reading projection with its project and chapter title. */
export function knowledgeInsertText(session:FocusSession,sectionId:string,zh:boolean):string {
 const {chapter}=projectDocument(session,{overview:false,wikiIds:[sectionId],matters:false,history:false,sources:false},"md",zh);
 if(!chapter)throw new Error(zh?"所选章节没有可引用的内容。":"The selected chapter has no content to quote.");
 const inline=(text:string)=>text.replace(/\s+/gu," ").trim();
 const source=`${zh?"《":"“"}${inline(session.title)}${zh?"》":"”"} · ${inline(chapter.title)}`;
 const note=zh?"以下是我在 ChatAtlas 中整理的项目知识，供参考：":"For reference, project knowledge I organized in ChatAtlas:";
 return formatComposerReference(note,source,plainComposerReference(chapter.body,true));
}

