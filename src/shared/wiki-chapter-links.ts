import type {FocusSection} from "./focus-session";
import type {WikiClaim} from "./wiki-claims";
import type {WikiKnowledgeOrganization} from "./wiki-knowledge";
import {wikiDocumentBlocks} from "./wiki-document-blocks";
import {wikiCoverageMatcher,wikiExplanatorySentenceCount} from "./wiki-cross-duplicates";

/** In-document chapter link target; the Reader opens the chapter, export prints the title. */
export const WIKI_CHAPTER_LINK="#atlas-chapter-";
/** Window event the Reader dispatches for an in-text chapter link; the workspace opens it. */
export const WIKI_OPEN_CHAPTER_EVENT="atlas:open-chapter";
const MIN_REPEAT=60;
const MIN_SOURCED_REPEAT=20;
const exactText=(text:string)=>text.normalize("NFKC").replace(/\*\*|__/gu,"").replace(/\s+/gu," ").trim();
const claimIdentity=(claim:WikiClaim)=>JSON.stringify([
 exactText(claim.text),claim.quote,[...claim.evidenceIds].sort(),[...claim.unitIds??[]].sort(),
 claim.scope,claim.holder,claim.userDecided,claim.workStatus,claim.verification,claim.markOnly,claim.relation,
]);
const SCOPED=/\d|如果|假如|只有|仅|除非|否则|未|禁止|\b(?:if|unless|except|only|never|not|without)\b/iu;

/** Unambiguous planned home of each point. Shared or unassigned units still
 * use the first eligible chapter in reading order. */
export function wikiUnitChapterHomes(organization:WikiKnowledgeOrganization|undefined){
 const subjects=new Map(organization?.subjects.map(subject=>[subject.id,subject.unitIds]));
 const homes=new Map<string,string>(),ambiguous=new Set<string>(),subjectChapters=new Map<string,Set<string>>();
 for(const chapter of organization?.chapters??[]) for(const topic of chapter.subtopics) for(const subject of topic.subjectIds){
  const owners=subjectChapters.get(subject)??new Set<string>();
  owners.add(chapter.id);
  subjectChapters.set(subject,owners);
  for(const id of subjects.get(subject)??[]){
   if(homes.has(id)&&homes.get(id)!==chapter.id)ambiguous.add(id);
   homes.set(id,chapter.id);
  }
 }
 for(const id of ambiguous)homes.delete(id);
 for(const group of organization?.groups??[]){
  const owners=subjectChapters.get(group.homeSubjectId);
  if(owners?.size===1)for(const member of group.members)homes.set(member.unitId,[...owners][0]);
 }
 return homes;
}

const link=(chapter:Pick<FocusSection,"id"|"title">,zh:boolean)=>zh?`[「${chapter.title}」](${WIKI_CHAPTER_LINK}${encodeURIComponent(chapter.id)})`:`[“${chapter.title}”](${WIKI_CHAPTER_LINK}${encodeURIComponent(chapter.id)})`;

/** Paragraphs an EARLIER chapter (reading order) already explains in full leave
 * this chapter. A subsection made only of such paragraphs from one chapter keeps
 * its heading and becomes one pointer to that chapter; otherwise its own content
 * stays and one "see also" line closes it, so a pointer never stands in front of
 * text that is new. Saved text, personal chapters, lists, code, quotations and a
 * claim found nowhere else in this chapter are unchanged. */
export function wikiChapterLinks(body:string,section:Pick<FocusSection,"id"|"claims"|"userEdited"|"origin">,chapters:Array<Pick<FocusSection,"id"|"title"|"body"|"claims"|"userEdited"|"origin">>,zh=true,homes?:ReadonlyMap<string,string>):string {
 if(section.userEdited||section.origin)return body;
 const index=chapters.findIndex(chapter=>chapter.id===section.id);
 if(index<0||chapters.length<2)return body;
 const candidates=chapters.flatMap((chapter,at)=>chapter.id===section.id||chapter.userEdited||chapter.origin?[]:[{
  chapter,at,blocks:wikiDocumentBlocks(chapter.body,chapter.claims),covers:wikiCoverageMatcher(chapter.body,.9),
 }]);
 const nodes=wikiDocumentBlocks(body,section.claims);
 const owner=new Map<number,Pick<FocusSection,"id"|"title">>();
 nodes.forEach((node,at)=>{
  if(node.kind!=="paragraph"||node.standaloneLabel||node.text.length<(node.claims.length?MIN_SOURCED_REPEAT:MIN_REPEAT)||!wikiExplanatorySentenceCount(node.text))return;
  const claimIds=node.claims.flatMap(claim=>claim.unitIds??[]);
  const planned=claimIds.length?homes?.get(claimIds[0]):undefined;
  const home=planned&&claimIds.every(id=>homes?.get(id)===planned)?planned:undefined;
  if(home===section.id)return;
  const literal=Boolean(homes)||node.claims.length>0||SCOPED.test(node.text);
  const identity=new Set(node.claims.map(claimIdentity));
  const equivalent=(other:typeof node)=>other.kind==="paragraph"&&!other.standaloneLabel
   && exactText(node.text)===exactText(other.text) && identity.size===new Set(other.claims.map(claimIdentity)).size
   && other.claims.every(claim=>identity.has(claimIdentity(claim)));
  const eligible=candidates.filter(item=>home?item.chapter.id===home:item.at<index);
  const match=eligible.find(item=>literal?item.blocks.some(equivalent):item.covers(node.text)===1&&item.blocks.some(other=>
   other.kind==="paragraph"&&!other.claims.length&&!SCOPED.test(other.text)&&wikiCoverageMatcher(other.text,.9)(node.text)===1&&wikiCoverageMatcher(node.text,.9)(other.text)===1));
  if(match)owner.set(at,match.chapter);
 });
 if(!owner.size)return body;
 // Subsections: the nodes after each heading (the lead before the first heading is one too).
 const groups:number[][]=[[]];
 nodes.forEach((node,at)=>{if(node.kind==="heading")groups.push([]);else groups.at(-1)!.push(at);});
 const edits:Array<{start:number;end:number;text:string}>=[];
 for(const group of groups){
  const owned=group.filter(at=>owner.has(at));if(!owned.length)continue;
  const chapters=[...new Map(owned.map(at=>[owner.get(at)!.id,owner.get(at)!])).values()];
  const start=nodes[group[0]].start,end=nodes[group.at(-1)!].end;
  if(owned.length===group.length&&chapters.length===1){
   edits.push({start,end,text:zh?`> 这部分已在${link(chapters[0],zh)}中说明。`:`> Already explained in ${link(chapters[0],zh)}.`});
   continue;
  }
  for(const at of owned)edits.push({start:nodes[at].start,end:nodes[at].end,text:""});
  const also=chapters.map(chapter=>link(chapter,zh)).join(zh?"、":", ");
  edits.push({start:end,end,text:zh?`\n\n> 相关内容另见${also}。`:`\n\n> See also ${also}.`});
 }
 let next=body;
 for(const edit of edits.sort((a,b)=>b.start-a.start||b.end-a.end))next=next.slice(0,edit.start)+edit.text+next.slice(edit.end);
 return next.replace(/\n{3,}/gu,"\n\n").trim();
}

/** Export has no in-document navigation: chapter links print as titles. */
export function wikiChapterLinksAsText(body:string):string {
 return body.replace(/\[([「“][^\]]+[」”])\]\(#atlas-chapter-[^)]+\)/gu,"$1");
}
