import type {FocusSession} from "./focus-session";
import {projectMatters,type ProjectMatter} from "./project-matters";
import {wikiSections} from "./wiki-navigation";
import {matterTopics,matterTopicScores} from "./project-matter-topics";

const normalized=(text:string)=>text.normalize("NFKC").toLocaleLowerCase();
const generic=new Set(["项目","系统","具体","如何","什么","当前","需要","支持","是否","功能","方案","设计","哪些","处理","机制"]);
const terms=(text:string)=>[...new Set(normalized(text).match(/[a-z][a-z0-9_-]{2,}|[\p{Script=Han}]{2,}/gu)?.flatMap(word=>/\p{Script=Han}/u.test(word)?Array.from({length:word.length-1},(_,index)=>word.slice(index,index+2)):word)??[])].filter(word=>!generic.has(word));
const winner=(scores:Array<{id:string;score:number}>,minimum:number)=>{const ranked=[...scores].sort((a,b)=>b.score-a.score);return ranked[0]?.score>=minimum&&ranked[0].score>(ranked[1]?.score??0)?ranked[0].id:"";};

/** Display grouping is local and derived; no AI call, fact change or saved edge. */
export function createMatterCategoryResolver(session:FocusSession){
 const pages=wikiSections(session);
 const profiles=pages.map(page=>{
  const text=[page.wikiDisplayTitle||page.title,page.wikiQuestion,...page.wikiSubtopics?.flatMap(topic=>[topic.title,topic.question])??[],...page.body.match(/^#{1,6}\s+.+$/gmu)??[]].filter(Boolean).join(" ");
  return {id:page.id,terms:terms(text),topics:matterTopicScores(text)};
 });
 return (matter:ProjectMatter):string=>{
 if(matter.category!==undefined)return [...pages,...matterTopics].some(page=>page.id===matter.category)?matter.category:"";
 const linked=pages.filter(page=>matter.linkedKnowledgeIds?.includes(page.id)||page.matterLinks?.some(link=>link.id===matter.id&&link.type===matter.type));
 if(linked.length===1)return linked[0].id;
 const ids=new Set(matter.sources.map(source=>source.id));
 const scores=pages.map(page=>({id:page.id,score:page.evidenceIds.filter(id=>ids.has(id)).length})).sort((a,b)=>b.score-a.score);
 const evidence=winner(scores,1);if(evidence&&linked.length<2)return evidence;
 const text=normalized([matter.displayTitle,matter.text,matter.options,matter.included,matter.excluded].filter(Boolean).join(" "));
 const eligible=linked.length>1?profiles.filter(page=>linked.some(link=>link.id===page.id)):profiles;
 const lexical=winner(eligible.map(page=>({id:page.id,score:page.terms.filter(term=>text.includes(term)).length*2})),2);
 if(lexical)return lexical;
 const topic=winner(matterTopicScores(text),4);if(!topic)return "";
 const chapter=winner(eligible.map(page=>({id:page.id,score:page.topics.find(item=>item.id===topic)?.score??0})),2);
 return chapter||topic;
 };
}
export function matterCategory(session:FocusSession,matter:ProjectMatter):string{return createMatterCategoryResolver(session)(matter);}
export function matterCategories(session:FocusSession,zh:boolean,matters=projectMatters(session)){
 const resolve=createMatterCategoryResolver(session),used=new Set(matters.map(resolve));
 return [...wikiSections(session).map(page=>({id:page.id,title:page.wikiDisplayTitle||page.title})),...matterTopics.filter(topic=>used.has(topic.id)).map(topic=>({id:topic.id,title:zh?topic.zh:topic.en})),{id:"",title:zh?"未分类":"Uncategorized"}];
}
