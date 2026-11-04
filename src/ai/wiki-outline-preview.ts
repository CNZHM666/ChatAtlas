import type {FocusSection} from "../shared/focus-session";
import type {DirectoryPage} from "../shared/wiki-directory";

type OwnedNote = {id:string;title?:string;text:string;wikiOwnerId?:string};
const MAX_POINTS=5,MAX_POINT=90;
// Raw originals carried unchanged ("user: …") are evidence, not a summary point.
const rawOriginal=(text:string)=>/^(?:user|assistant|system|tool)\s*:/iu.test(text.trim());
const clean=(text:string)=>text.replace(/[#*_`>]/gu,"").replace(/\s+/gu," ").trim();

/** One key point from a reading note: its title, then its first sentence. */
function notePoint(note:OwnedNote):string|undefined {
 if(rawOriginal(note.text))return undefined;
 const [head="",...rest]=note.text.split("\n");
 const title=clean(head),body=clean(rest.join(" ").replace(/\bNext:.*$/u,""));
 // Chinese sentence marks end a sentence directly; Latin ones need a following space.
 const sentence=body.match(/^.*?(?:[。！？]|[.!?](?=\s|$))/u)?.[0]??body;
 const point=title&&sentence&&!sentence.startsWith(title)?`${title}：${sentence}`:sentence||title;
 if(!point)return undefined;
 return Array.from(point).length>MAX_POINT?`${Array.from(point).slice(0,MAX_POINT-1).join("")}…`:point;
}

/** The chapter outline shown as soon as planning finishes, while chapters are
 * still being written: planned titles, questions and sub-topics, plus up to five
 * key points from each chapter's own reading notes. No model call. Evidence ids
 * are the notes' material ids, mapped to originals like written chapters. */
export function wikiOutlineSections(plan:DirectoryPage[],materials:OwnedNote[],zh:boolean,written:ReadonlySet<string>=new Set()):FocusSection[] {
 return plan.flatMap(page=>{
  const owner=page.ownerId??page.sectionIds[0];
  if(!owner||written.has(owner))return [];
  const owned=materials.filter(item=>item.wikiOwnerId===owner);
  const points=[...new Set(owned.flatMap(note=>notePoint(note)??[]))].slice(0,MAX_POINTS);
  const topics=page.subtopics?.map(topic=>topic.title).filter(Boolean)??[];
  const body=[
   page.question?clean(page.question):"",
   points.length?points.map(point=>`- ${point}`).join("\n"):"",
   topics.length?`${zh?"本章包括：":"Covers: "}${topics.join(" · ")}`:"",
  ].filter(Boolean).join("\n\n");
  return [{id:`outline:${owner}`,title:page.title,body:body||(zh?"正文生成中。":"Being written."),kind:"finding" as const,transition:"",
   evidenceIds:owned.filter(note=>!rawOriginal(note.text)).slice(0,12).map(note=>note.id),
   wikiOwnerId:owner,wikiQuestion:page.question,...(page.group?{wikiGroup:page.group}:{}),
   ...(page.subtopics?{wikiSubtopics:page.subtopics.map(({title,question})=>({title,question}))}:{}),wikiOutline:true}];
 });
}

/** Written chapters in plan order, with outline placeholders for the rest. */
export function withWikiOutline(written:FocusSection[],plan:DirectoryPage[],materials:OwnedNote[],zh:boolean):FocusSection[] {
 const done=new Set(written.flatMap(section=>section.wikiOwnerId?[section.wikiOwnerId]:[]));
 const outline=wikiOutlineSections(plan,materials,zh,done);
 const order=plan.map(page=>page.ownerId??page.sectionIds[0]);
 const rank=(section:FocusSection)=>{const index=order.indexOf(section.wikiOwnerId??"");return index<0?order.length:index;};
 return [...written,...outline].sort((a,b)=>rank(a)-rank(b));
}
