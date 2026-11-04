import {unified} from "unified";
import remarkParse from "remark-parse";
import type {FocusEvidence,FocusSection,FocusSession} from "./focus-session";
import {evolutionRecords,type EvolutionRecord} from "./product-evolution";
import {historyTime} from "./history-order";
import {wikiSections} from "./wiki-navigation";

const parser=unified().use(remarkParse);
/** "历史：", "**历史**：", "**历史：**" and the English form; the whole label is removed. */
const LABEL=/^\s*(?:\*\*|__)?\s*(?:历史|History)\s*(?:\*\*|__)?\s*[：:]\s*(?:\*\*|__)?\s*/iu;
// A history note must say what changed; commentary on the material is not evolution.
const CHANGE=/改为|改成|改用|换成|替换|取代|不再|放弃|取消|撤回|转为|转向|调整为|升级为|收敛为|从.{1,40}(?:改|转|变|调整)|(?:最初|起初|原先|原本|早期|曾经?)(?:.{0,60})(?:后来|后续|之后|最终|现|但)|→|\b(?:replaced|switched|no longer|instead of|dropped|withdrew|changed)\b/iu;
const COMMENTARY=/(?:后续)?评估(?:指出|认为)|整理稿|导出(?:文件|内容)|尚未整合|来自早期\s*AI\s*建议|证据归属|材料(?:未显示|显示)/u;

export interface WikiHistoryNote {text:string;heading?:string}
/** Prose without its history paragraphs, and those paragraphs with their section heading. */
export function extractHistoryNotes(body:string):{body:string;notes:WikiHistoryNote[]} {
 const notes:WikiHistoryNote[]=[],ranges:Array<[number,number]>=[];let heading:string|undefined;
 for(const node of parser.parse(body).children){
  if(node.type==="heading"&&node.depth<=3){heading=body.slice(node.position!.start.offset!,node.position!.end.offset!).replace(/^#+\s*/u,"").trim();continue;}
  if(node.type!=="paragraph")continue;
  const start=node.position!.start.offset!,end=node.position!.end.offset!,text=body.slice(start,end);
  if(!LABEL.test(text))continue;
  ranges.push([start,end]);
  const note=text.replace(LABEL,"").replace(/^\s*(?:\*\*|__)\s*/u,"").trim();
  if(note)notes.push({text:note,...(heading?{heading}:{})});
 }
 let next=body;for(const [start,end] of ranges.reverse())next=next.slice(0,start)+next.slice(end);
 return {body:ranges.length?next.replace(/\n{3,}/gu,"\n\n").trim():body,notes};
}

const trigrams=(text:string)=>{const chars=Array.from(text.normalize("NFKC").replace(/[\s\p{P}]/gu,""));return new Set(chars.slice(2).map((_,i)=>chars.slice(i,i+3).join("")));};
/** Share of the smaller text's wording that also appears in the other. */
export function wordingContainment(a:string,b:string):number {
 const left=trigrams(a),right=trigrams(b),smaller=Math.min(left.size,right.size);if(!smaller)return 0;
 let shared=0;for(const gram of left)if(right.has(gram))shared++;
 return shared/smaller;
}
/** The same change told twice (once briefly, once with examples) keeps the fuller telling, in first position. */
export function distinctNotes(notes:WikiHistoryNote[]):WikiHistoryNote[] {
 const kept:WikiHistoryNote[]=[];
 for(const note of notes){
  const twin=kept.findIndex(other=>wordingContainment(other.text,note.text)>=.6);
  if(twin<0)kept.push(note);else if(note.text.length>kept[twin].text.length)kept[twin]={...kept[twin],text:note.text};
 }
 return kept;
}

export const meaningfulHistoryNote=(text:string)=>CHANGE.test(text)&&!COMMENTARY.test(text);

export type WikiHistoryEntry=
 |{kind:"record";id:string;before:string;after:string;reason?:string;date?:number;status:"confirmed"|"proposal"|"documented";sources:FocusEvidence[]}
 |{kind:"note";id:string;text:string;heading?:string};

const messageKey=(ref:Pick<FocusEvidence,"conversationId"|"messageId">)=>`${ref.conversationId}\u0000${ref.messageId}`;
const realChange=(record:EvolutionRecord)=>record.event.recordKind!=="reference"&&Boolean(record.event.before?.trim()&&record.event.after?.trim());

/** Each structured change goes to the one chapter citing most of its original
 * messages (first chapter on a tie); records sharing no message stay in Product Evolution. */
export function evolutionRecordsBySection(session:FocusSession):Map<string,EvolutionRecord[]> {
 const chapters=wikiSections(session).filter(section=>!section.userEdited&&!section.origin).map(section=>({id:section.id,messages:new Set(session.evidence.filter(ref=>section.evidenceIds.includes(ref.id)).map(messageKey))}));
 const result=new Map<string,EvolutionRecord[]>();
 for(const record of evolutionRecords(session).filter(realChange)){
  const keys=record.sources.map(messageKey);
  const best=chapters.map(chapter=>({chapter,overlap:keys.filter(key=>chapter.messages.has(key)).length})).filter(item=>item.overlap).sort((a,b)=>b.overlap-a.overlap)[0];
  if(best)result.set(best.chapter.id,[...result.get(best.chapter.id)??[],record]);
 }
 return result;
}

/** Evolution shown with a generated chapter: structured records first, then
 * history notes that state an actual change and are not already covered. */
export function wikiHistoryEntries(session:FocusSession,section:FocusSection,records=evolutionRecordsBySection(session).get(section.id)??[]):WikiHistoryEntry[] {
 if(section.userEdited||section.origin)return [];
 const structured:WikiHistoryEntry[]=records.map(record=>({kind:"record",id:record.id,before:record.event.before.trim(),after:record.event.after.trim(),
  ...(record.event.reason?.trim()?{reason:record.event.reason.trim()}:{}),...(historyTime(record.event.discussedAt)?{date:record.event.discussedAt}:{}),
  status:record.event.decisionStatus==="confirmed"?"confirmed":record.event.status==="proposal"?"proposal":"documented",sources:record.sources}));
 const covered=(text:string)=>records.some(record=>[record.event.before,record.event.after].some(part=>part.trim().length>=6&&text.includes(part.trim())));
 const notes:WikiHistoryEntry[]=distinctNotes(extractHistoryNotes(section.body).notes.filter(note=>meaningfulHistoryNote(note.text)&&!covered(note.text))).map((note,index)=>({kind:"note",id:`${section.id}:note${index}`,...note}));
 return [...structured,...notes];
}
