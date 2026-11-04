/** Local, deterministic overlap between candidate Wiki subjects, over titles
 * and subtopic titles only: scope questions share templates (如何设计？) that
 * would make unrelated subjects look alike. It is a weak signal, used only to
 * order candidates and hint the planner; the model still decides every parent,
 * and final chapters are audited semantically instead. */
export const SUBJECT_SIMILARITY=.1;
const MAX_GROUP=6;

interface Subject {title:string;wikiQuestion?:string;question?:string;wikiSubtopics?:Array<{title:string}>;subtopics?:Array<{title:string}>}
// Connectives join two subjects; they say nothing about either one.
const text=(item:Subject)=>[item.title,...(item.wikiSubtopics??item.subtopics??[]).map(topic=>topic.title)].join(" ").toLocaleLowerCase().replace(/[与和及、]|\band\b|[\p{P}\p{S}\s]+/gu,"");
const bigrams=(value:string)=>{const grams=new Set<string>();for(let i=0;i+2<=value.length;i++)grams.add(value.slice(i,i+2));return grams;};
const jaccard=(a:Set<string>,b:Set<string>)=>{let shared=0;for(const gram of a)if(b.has(gram))shared++;return shared/Math.max(1,a.size+b.size-shared);};

/** Groups (by index) of candidates that likely name the same subject. */
export function wikiSubjectGroups(items:Subject[],threshold=SUBJECT_SIMILARITY):number[][] {
 const grams=items.map(item=>bigrams(text(item))),parent=items.map((_,index)=>index),size=items.map(()=>1);
 const root=(index:number):number=>parent[index]===index?index:(parent[index]=root(parent[index]));
 const pairs:Array<[number,number,number]>=[];
 for(let a=0;a<items.length;a++)for(let b=a+1;b<items.length;b++){const score=jaccard(grams[a],grams[b]);if(score>=threshold)pairs.push([score,a,b]);}
 // Strongest overlaps first, and no group beyond MAX_GROUP: formulaic wording
 // must not chain a whole catalogue into one "same subject".
 for(const [,a,b] of pairs.sort((x,y)=>y[0]-x[0])){const ra=root(a),rb=root(b);if(ra!==rb&&size[ra]+size[rb]<=MAX_GROUP){parent[rb]=ra;size[ra]+=size[rb];}}
 const groups=new Map<number,number[]>();
 items.forEach((_,index)=>{const key=root(index);groups.set(key,[...groups.get(key)??[],index]);});
 return [...groups.values()].filter(group=>group.length>1);
}

/** Stable order that keeps likely-same subjects adjacent, so request windows
 * never separate them. Each group moves to its first member's position. */
export function orderBySubject<T extends Subject>(items:T[]):T[] {
 const groupOf=new Map<number,number[]>();
 for(const group of wikiSubjectGroups(items))for(const index of group)groupOf.set(index,group);
 const seen=new Set<number>(),ordered:T[]=[];
 items.forEach((_,index)=>{if(seen.has(index))return;for(const member of groupOf.get(index)??[index]){seen.add(member);ordered.push(items[member]);}});
 return ordered;
}
