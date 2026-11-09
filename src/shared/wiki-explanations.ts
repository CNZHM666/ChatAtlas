import {unified} from "unified";
import remarkParse from "remark-parse";
import type {FocusSection,FocusSession} from "./focus-session";
import type {WikiClaim} from "./wiki-claims";
import {sourceMessageSignature} from "./source-signature";
import {wikiExplanatorySentenceCount,wikiSentenceCoverage} from "./wiki-cross-duplicates";
import {WIKI_CHAPTER_LINK} from "./wiki-chapter-links";
import {projectKnowledgeFacts,type ProjectKnowledgeFact} from "./project-knowledge-facts";
import {unsupportedAdoption} from "./project-knowledge-view";
import {wikiSections} from "./wiki-navigation";
import {knowledgeTerms} from "./knowledge-subject";

/** Bumped when explanation ownership, block issues or their repair change meaning.
 * Saved documents below it are upgraded only by an explicit update. */
export const WIKI_SEMANTIC_VERSION=4;

const parser=unified().use(remarkParse);
const MIN_BLOCK=60;

/** One explanation block: a generated prose paragraph with the claims it states.
 * Its ID follows the text, so reordering chapters or blocks keeps it. */
export interface WikiBlock {id:string;sectionId:string;start:number;end:number;text:string;claims:WikiClaim[]}
export type WikiBlockIssueCode="duplicate_explanation"|"duplicate_with_extra"|"unsupported_status"|"unbound_decision"|"retired_as_current";
/** A located, actionable problem. Literal similarity only nominates duplicates;
 * shared claim identity or the repair step decides them. */
export interface WikiBlockIssue {code:WikiBlockIssueCode;sectionId:string;blockId:string;targetSectionId?:string;targetBlockId?:string;claimKeys:string[];evidenceIds:string[];details?:string[]}

/** A claim's identity is its original quotation and evidence, never its wording. */
export const wikiClaimKey=(claim:Pick<WikiClaim,"quote"|"evidenceIds">)=>`claim:${sourceMessageSignature(JSON.stringify([claim.quote.normalize("NFKC").replace(/\s+/gu,""),[...claim.evidenceIds].sort()]))}`;
export const wikiBlockId=(sectionId:string,text:string)=>`${sectionId}#${sourceMessageSignature(text.replace(/\s+/gu," ").trim())}`;
const plain=(text:string)=>text.replace(/\*\*|__/gu,"");

export function wikiBlocks(section:Pick<FocusSection,"id"|"body"|"claims">):WikiBlock[]{
 const body=section.body;
 return parser.parse(body).children.flatMap(node=>{
  if(node.type!=="paragraph")return [];
  // A bold label line introduces a list; a pointer line is navigation.
  if(node.children.length===1&&node.children[0].type==="strong")return [];
  const start=node.position!.start.offset!,end=node.position!.end.offset!,text=body.slice(start,end);
  const claims=(section.claims??[]).filter(claim=>[claim.text,...claim.formulations??[]].some(form=>form&&plain(text).includes(plain(form))));
  return [{id:wikiBlockId(section.id,text),sectionId:section.id,start,end,text,claims}];
 });
}

// Words that make one explanation say something another does not: numbers,
// negations, conditions, modes and versions, code identifiers.
const DETAIL=/\d+(?:\.\d+)?%?|`[^`\n]+`|\b[A-Za-z][A-Za-z\d]*[A-Z][A-Za-z\d]*\b|\bV\d+(?:\.\d+)*\b|BYOK|内置|仅|只有|除非|否则|如果|例外|不|没有|未|禁止|\b(?:only|unless|except|if|not|never|without)\b/giu;
export function wikiDetails(text:string){return new Set((plain(text).match(DETAIL)??[]).map(token=>token.toLowerCase()));}
/** Details of `from` that `into` does not state; merging must not lose them. */
export function missingWikiDetails(from:string,into:string){const own=wikiDetails(into);return [...wikiDetails(from)].filter(token=>!own.has(token));}

const pointer=(chapter:Pick<FocusSection,"id"|"title">,zh:boolean)=>{
 const link=zh?`[「${chapter.title}」](${WIKI_CHAPTER_LINK}${encodeURIComponent(chapter.id)})`:`[“${chapter.title}”](${WIKI_CHAPTER_LINK}${encodeURIComponent(chapter.id)})`;
 return zh?`> 这部分已在${link}中说明。`:`> Already explained in ${link}.`;
};
const generated=(section:FocusSection)=>!section.userEdited&&!section.origin;

const termOverlap=(a:Set<string>,b:Set<string>)=>{let shared=0;for(const term of a)if(b.has(term))shared++;return {shared,ratio:shared/Math.max(1,Math.min(a.size,b.size))};};

/** Two subsections of one chapter whose headings name the same subject (for
 * example 「混合检索架构」 and 「混合检索与性能」) become one: the later one's
 * content moves under the earlier heading, unchanged, so the paragraph checks
 * can then fold what both say. Nothing is deleted here. */
export function mergeWikiTwinSubsections(section:FocusSection):{section:FocusSection;merged:number}{
 if(!generated(section))return {section,merged:0};
 const body=section.body,nodes=parser.parse(body).children;
 const headings=nodes.flatMap((node,index)=>node.type==="heading"&&node.depth===2?[{index,start:node.position!.start.offset!,end:node.position!.end.offset!,title:body.slice(node.position!.start.offset!,node.position!.end.offset!).replace(/^#+\s*/u,"").trim()}]:[]);
 if(headings.length<2)return {section,merged:0};
 const parts=headings.map((heading,at)=>({...heading,terms:knowledgeTerms(heading.title),content:body.slice(heading.end,headings[at+1]?.start??body.length).trim()}));
 const into=new Map<number,number>();
 parts.forEach((part,later)=>{
  for(let earlier=0;earlier<later;earlier++){
   if(into.has(earlier))continue;
   const {shared,ratio}=termOverlap(parts[earlier].terms,part.terms);
   if(shared>=3&&ratio>=.6){into.set(later,earlier);break;}
  }
 });
 if(!into.size)return {section,merged:0};
 const lead=body.slice(0,headings[0].start).trim();
 const kept=parts.flatMap((part,at)=>into.has(at)?[]:[[`## ${part.title}`,part.content,...parts.filter((_,other)=>into.get(other)===at).map(other=>other.content)].filter(Boolean).join("\n\n")]);
 const removed=new Set(parts.filter((_,at)=>into.has(at)).map(part=>part.title));
 return {merged:into.size,section:{...section,body:[lead,...kept].filter(Boolean).join("\n\n"),...(section.wikiSubtopics?{wikiSubtopics:section.wikiSubtopics.filter(topic=>!removed.has(topic.title))}:{})}};
}

/** One explanation, one main place. A later chapter's paragraph that an earlier
 * chapter already states completely, with no number, condition, mode or
 * exception of its own, becomes a pointer; its claims and evidence move to the
 * explaining chapter so nothing citable is lost. Paragraphs that add details
 * are reported for repair, never deleted. Personal chapters are untouched. */
export function mergeWikiDuplicateExplanations(chapters:FocusSection[],zh=true):{sections:FocusSection[];issues:WikiBlockIssue[];merged:number}{
 const issues:WikiBlockIssue[]=[];let merged=0;
 // Parsed once per chapter text: every paragraph is compared with every earlier chapter.
 const parsed=new Map<string,WikiBlock[]>();
 const blocksOf=(section:FocusSection)=>{const key=JSON.stringify([section.id,section.body]);let blocks=parsed.get(key);if(!blocks){blocks=wikiBlocks(section);parsed.set(key,blocks);}return blocks;};
 const sections=chapters.map(section=>{const twins=mergeWikiTwinSubsections(section);merged+=twins.merged;return {...twins.section,claims:twins.section.claims?[...twins.section.claims]:undefined,evidenceIds:[...twins.section.evidenceIds]};});
 // Within a chapter: a later paragraph an earlier one already states completely,
 // with no detail of its own, leaves; its claims stay in the same chapter.
 sections.forEach((page,at)=>{
  if(!generated(page))return;
  const blocks=blocksOf(page),removed:WikiBlock[]=[];
  blocks.forEach((block,index)=>{
   if(block.text.length<MIN_BLOCK||!wikiExplanatorySentenceCount(block.text))return;
   const target=blocks.slice(0,index).find(candidate=>!removed.includes(candidate)&&wikiSentenceCoverage(block.text,candidate.text,.9)===1);
   if(!target)return;
   if(missingWikiDetails(block.text,target.text).length){issues.push({code:"duplicate_with_extra",sectionId:page.id,blockId:block.id,targetSectionId:page.id,targetBlockId:target.id,claimKeys:block.claims.map(wikiClaimKey),evidenceIds:[...new Set(block.claims.flatMap(claim=>claim.evidenceIds))],details:missingWikiDetails(block.text,target.text)});return;}
   removed.push(block);
  });
  if(!removed.length)return;
  merged+=removed.length;
  let body=page.body;
  for(const block of [...removed].sort((a,b)=>b.start-a.start))body=body.slice(0,block.start)+body.slice(block.end);
  sections[at]={...page,body:body.replace(/\n{3,}/gu,"\n\n").trim()};
 });
 for(let later=1;later<sections.length;later++){
  const page=sections[later];if(!generated(page))continue;
  const blocks=blocksOf(page).filter(block=>block.text.length>=MIN_BLOCK&&wikiExplanatorySentenceCount(block.text)>0);
  const edits:Array<{block:WikiBlock;owner:FocusSection}>=[];
  for(const block of blocks){
   let found:{owner:FocusSection;target:WikiBlock}|undefined;
   for(const owner of sections.slice(0,later)){
    if(!generated(owner))continue;
    const target=blocksOf(owner).find(candidate=>wikiSentenceCoverage(block.text,candidate.text,.9)===1);
    if(target){found={owner,target};break;}
   }
   if(!found)continue;
   const missing=missingWikiDetails(block.text,found.target.text);
   if(missing.length){issues.push({code:"duplicate_with_extra",sectionId:page.id,blockId:block.id,targetSectionId:found.owner.id,targetBlockId:found.target.id,claimKeys:block.claims.map(wikiClaimKey),evidenceIds:[...new Set(block.claims.flatMap(claim=>claim.evidenceIds))],details:missing});continue;}
   edits.push({block,owner:found.owner});
   // Claims stated only by this paragraph follow the explanation they belong to.
   const others=blocksOf(page).filter(other=>other.id!==block.id);
   const moving=block.claims.filter(claim=>!others.some(other=>other.claims.includes(claim)));
   if(moving.length){
    const keys=new Set((found.owner.claims??[]).map(wikiClaimKey));
    found.owner.claims=[...found.owner.claims??[],...moving.filter(claim=>!keys.has(wikiClaimKey(claim))).map(claim=>{const rest={...claim};delete rest.formulations;return rest;})];
    found.owner.evidenceIds=[...new Set([...found.owner.evidenceIds,...moving.flatMap(claim=>claim.evidenceIds)])];
    page.claims=page.claims?.filter(claim=>!moving.includes(claim));
   }
  }
  if(!edits.length)continue;
  merged+=edits.length;
  let body=page.body,last:string|undefined;
  for(const edit of [...edits].sort((a,b)=>b.block.start-a.block.start)){
   // Consecutive paragraphs explained by the same chapter share one pointer.
   const line=pointer(edit.owner,zh);
   const next=body.slice(edit.block.end).trimStart();
   body=body.slice(0,edit.block.start)+(last===line&&next.startsWith(line)?"":line)+body.slice(edit.block.end);
   last=line;
  }
  sections[later]={...page,body:body.replace(/\n{3,}/gu,"\n\n").trim()};
 }
 return {sections,issues,merged};
}

export const WIKI_DECISION_CLAIM=/核心(?:技术)?决策|最终(?:决定|方案|确定)|已(?:经)?(?:确定|决定)|用户(?:已经?|明确)(?:确认|决定)|\b(?:the (?:core|final) (?:decision|design)|(?:has|was) decided)\b/iu;
export const WIKI_HISTORY_MARKER=/此前|早期|曾(?:经)?|原先|原来|起初|最初|后(?:来|续)(?:改|决定)|改为|改用|取代|已被|不再|历史|earlier|previously|originally|was replaced|no longer/iu;

/** Located problems over the saved chapters, in reading order. Status issues use
 * the same source readings as the reading view; nothing here calls a model. */
export function wikiBlockIssues(session:FocusSession):WikiBlockIssue[]{
 const chapters=wikiSections(session).filter(generated);
 const facts=projectKnowledgeFacts(session).facts;
 const issues:WikiBlockIssue[]=[];
 const factOf=(section:FocusSection,claim:WikiClaim)=>facts.find(fact=>fact.sectionId===section.id&&fact.claim===claim)??facts.find(fact=>fact.sectionId===section.id&&wikiClaimKey(fact.claim)===wikiClaimKey(claim));
 const seen:Array<{section:FocusSection;block:WikiBlock}>=[];
 for(const section of chapters){
  // The chapter opening summarizes its subsections by design; it is not a repeat.
  const firstHeading=parser.parse(section.body).children.find(node=>node.type==="heading")?.position?.start.offset??Infinity;
  const own:Array<{block:WikiBlock;terms:Set<string>}>=[],marked=Boolean(section.claims?.some(claim=>claim.holder));
  for(const block of wikiBlocks(section)){
   const rows=block.claims.map(claim=>factOf(section,claim)).filter((fact):fact is ProjectKnowledgeFact=>Boolean(fact));
   const base={sectionId:section.id,blockId:block.id,claimKeys:block.claims.map(wikiClaimKey),evidenceIds:[...new Set(block.claims.flatMap(claim=>claim.evidenceIds))]};
   const accepted=rows.some(fact=>fact.adoption==="accepted"&&!fact.historical);
   // A chapter whose sentences carry status marks says decided, open or earlier in the mark, never in its words:
   // its wording is no status claim to check, and a wrong status is fixed by switching the mark.
   if(!marked){
    if(rows.some(fact=>unsupportedAdoption(fact,block.text))&&!accepted)issues.push({...base,code:"unsupported_status"});
    else if(!block.claims.length&&WIKI_DECISION_CLAIM.test(plain(block.text)))issues.push({...base,code:"unbound_decision"});
    if(rows.some(fact=>fact.historical)&&!rows.some(fact=>!fact.historical)&&!WIKI_HISTORY_MARKER.test(block.text))issues.push({...base,code:"retired_as_current"});
   }
   // Duplicate candidates: the same original claim explained again, or most
   // sentences restated. Complete literal repeats were merged before this.
   if(block.text.length>=MIN_BLOCK&&wikiExplanatorySentenceCount(block.text)>0){
    const keys=new Set(base.claimKeys);
    const lead=Number.isFinite(firstHeading)&&block.start<firstHeading,terms=knowledgeTerms(plain(block.text));
    let earlier=lead?undefined:seen.find(item=>item.block.claims.some(claim=>keys.has(wikiClaimKey(claim)))||item.block.text.length>=MIN_BLOCK&&wikiSentenceCoverage(block.text,item.block.text,.7)>=.5);
    // Reworded repeats in one chapter share most content terms but few trigrams.
    // Overlap only nominates them; the repair step decides whether they are one explanation.
    if(!earlier&&!lead){
     const best=own.map(item=>({item,...termOverlap(terms,item.terms)})).filter(row=>row.shared>=6&&row.ratio>=.55).sort((a,b)=>b.ratio-a.ratio)[0];
     if(best)earlier={section,block:best.item.block};
    }
    if(earlier)issues.push({...base,code:"duplicate_explanation",targetSectionId:earlier.section.id,targetBlockId:earlier.block.id,details:missingWikiDetails(block.text,earlier.block.text)});
    if(!lead)own.push({block,terms});
   }
   // A short block can still be the place an original claim is explained.
   seen.push({section,block});
  }
 }
 return issues;
}

/** What the document can honestly claim about itself, computed from saved
 * records only. "decisions_checked" needs every high-impact claim read against
 * its originals and no remaining status problem; implementation is never
 * verified by generation. */
export interface WikiVerification {
 version:1;signature:string;status:"history_digest"|"decisions_checked";
 sources:{conversations:number;messages:number;earliest?:number;latest?:number};
 claims:{total:number;read:number;confirmed:number;proposals:number;reported:number;unread:number};
 openIssues:number;implementation:"not_checked";
}
/** Decisions, not sentences: one decision told as five steps, each a claim of the same units, is one. A claim without
 * units counts by its own text. */
const decisionCount=(facts:ProjectKnowledgeFact[])=>new Set(facts.map(fact=>fact.claim.unitIds?.length?[...fact.claim.unitIds].sort().join("|"):`text:${fact.claim.text}`)).size;
export function wikiVerification(session:FocusSession,issues=wikiBlockIssues(session)):WikiVerification{
 const facts=projectKnowledgeFacts(session).facts;
 const keyed=facts.filter(fact=>fact.claim.overviewRole&&["decision","stage","progress","scope","constraint","workflow"].includes(fact.claim.overviewRole)||fact.adoption==="accepted"||fact.implementation==="reported");
 const read=keyed.filter(fact=>Boolean(fact.claim.sourceReading)&&!fact.sourceChanged);
 const cited=new Set(session.sections.flatMap(section=>section.evidenceIds));
 const refs=session.evidence.filter(ref=>cited.has(ref.id));
 const messages=new Set(refs.map(ref=>JSON.stringify([ref.conversationId,ref.messageId])));
 const dates=facts.flatMap(fact=>fact.claim.sourceReading?.sources.map(source=>source.discussedAt).filter(date=>date>946684800000)??[]);
 const status=issues.some(issue=>issue.code!=="duplicate_explanation"&&issue.code!=="duplicate_with_extra")||read.length<keyed.length||!keyed.length?"history_digest":"decisions_checked";
 return {version:1,signature:wikiVerificationSignature(session),status,
  sources:{conversations:session.sourceConversationIds.length,messages:messages.size,...(dates.length?{earliest:Math.min(...dates),latest:Math.max(...dates)}:{})},
  claims:{total:facts.length,read:facts.filter(fact=>fact.claim.sourceReading).length,confirmed:decisionCount(facts.filter(fact=>fact.adoption==="accepted")),proposals:facts.filter(fact=>fact.adoption==="proposed").length,reported:facts.filter(fact=>fact.implementation==="reported").length,unread:keyed.length-read.length},
  openIssues:issues.length,implementation:"not_checked"};
}
export const wikiVerificationSignature=(session:FocusSession)=>sourceMessageSignature(JSON.stringify([WIKI_SEMANTIC_VERSION,session.sourceSignatures,session.sourceRoles,session.sections.map(section=>[section.id,section.body,section.userEdited,section.claims?.map(claim=>[claim.text,claim.quote,claim.evidenceIds,claim.sourceReading?.status])])]));
/** The saved record when it still describes these chapters; otherwise recomputed. */
export function currentWikiVerification(session:FocusSession):WikiVerification{
 const saved=session.wikiVerification;
 return saved?.version===1&&saved.signature===wikiVerificationSignature(session)?saved:wikiVerification(session);
}
