import type {FocusSection} from "./focus-session";
import {wikiChapterUnconfirmed} from "./wiki-chapter-status";

/** Status wording and generic references to "the design"; what remains after
 * removing them is the clause's actual content. */
const STATUS_WORDS=/AI\s*建议|建议|提议|讨论中的设计|材料|未显示|显示|用户|已|确认|采用|实施|尚未|未见|仍属|仍|多为|均为|为|是|属|或|这一|这些|该|此|上述|以下|结论|源自|全面|均|目前|当前|结构|架构|方案|设计|变更|做法|路线|内容|部分|在|中|的|了/gu;
const STATUS=/材料未显示|未显示用户(?:已)?确认|尚未(?:经用户)?(?:确认|采用|实施)|未见用户(?:已)?确认|仍属提议/u;
// Formatting, code, links and quotations are left exactly as written.
const PROTECTED=/\*\*|__|`|\[|“|「|"/u;

/** A clause that only restates "this is an AI proposal the user has not confirmed". */
function statusOnly(clause:string,claims:string[]):boolean {
 if(!STATUS.test(clause)||PROTECTED.test(clause)||claims.some(text=>text&&clause.includes(text)))return false;
 return clause.replace(STATUS_WORDS,"").replace(/[\p{P}\p{S}\s]+/gu,"").length<=4;
}

/** The completion wrapper on a sentence that is itself a recommendation adds only
 * status; a quoted completion claim keeps its "完成情况尚未确认" caution. */
const unwrapAdvice=(text:string)=>text
 .replace(/讨论记录提及“((?:针对[^”]{0,40}?，)?(?:AI\s?)?建议[^”]*)”，完成情况尚未确认。/gu,"$1。")
 .replace(/据讨论，((?:针对[^，。]{0,40}?，)?(?:AI\s?)?建议[^。]*?)（未核实）。/gu,"$1。");

/** Later sentence-initial "AI建议" in the same subsection: the actor is already
 * named, so the sentence reads as a plain recommendation. Never inside quotes or
 * code, never before 的/了 (a noun phrase or a reported act). */
const REPEATED_ACTOR=/(^|[。！？；]\s*)AI\s?建议(?![的了]|发现|指出|认为|评估|起草|强调|分析|解释|警告|筛选|提出|对)(?![^。！？\n]{0,8}了)/gu;
function thinActor(text:string,named:{value:boolean}):string {
 const quoted=[...text.matchAll(/“[^”]*”|「[^」]*」|`[^`\n]*`|"[^"\n]*"/gu)].map(match=>({start:match.index!,end:match.index!+match[0].length}));
 return text.replace(REPEATED_ACTOR,(match,before:string,at:number)=>{
  const start=at+before.length;
  if(quoted.some(range=>start>=range.start&&start<range.end))return match;
  if(!named.value){named.value=true;return match;}
  return `${before}建议`;
 }).replace(/AI\s?建议/gu,(match,at:number)=>{if(!quoted.some(range=>at>=range.start&&at<range.end))named.value=true;return match;});
}

function line(text:string,claims:string[],named:{value:boolean}):string {
 const sentences=unwrapAdvice(text).split(/(?<=[。！？])/u).map(sentence=>{
  const end=sentence.match(/[。！？]\s*$/u)?.[0]??"",core=sentence.slice(0,sentence.length-end.length);
  const kept=core.split("；").filter(clause=>!statusOnly(clause,claims));
  return kept.length?kept.join("；")+end:"";
 });
 // The actor stays once per subsection, so each part still says who proposed it.
 return thinActor(sentences.join(""),named).replace(/[ \t]+$/u,"");
}

/** Reading projection for a generated chapter whose status line says it is mostly
 * unconfirmed AI proposals: drop clauses that only repeat that status, and name the
 * actor ("AI建议") once per subsection instead of in every sentence. Saved text,
 * personal chapters, code, tables, quotations and chapters with confirmed content are unchanged. */
export function wikiStatusProse(body:string,section:Pick<FocusSection,"claims"|"userEdited"|"origin">):string {
 if(!wikiChapterUnconfirmed(section))return body;
 const claims=(section.claims??[]).flatMap(claim=>[claim.text,...claim.formulations??[]]);
 let fenced=false;
 const named={value:false};
 const lines=body.split("\n").map(text=>{
  if(/^\s*(```|~~~)/u.test(text)){fenced=!fenced;return text;}
  if(!fenced&&/^\s*#/u.test(text))named.value=false;
  if(fenced||/^\s*(?:#|>|\|)/u.test(text)||!text.trim())return text;
  const marker=text.match(/^\s*(?:[-*+]|\d+[.)])\s+/u)?.[0]??"";
  const rest=line(text.slice(marker.length),claims,named);
  return rest.trim()?marker+rest:"";
 });
 // A paragraph that was only a disclaimer leaves no blank run behind.
 return lines.join("\n").replace(/\n{3,}/gu,"\n\n").trim();
}
