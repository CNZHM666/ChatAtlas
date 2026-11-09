import type {FocusSection} from "./focus-session";
import type {WikiClaim} from "./wiki-claims";
import {wikiDraftKept} from "./wiki-review";

/** Who said it in the cited originals. Read locally from the claim's source
 * reading (never model output); workStatus is the fallback. This is the source
 * axis only: whether the user has reviewed it in Atlas is a separate axis. */
export type WikiClaimSource="decision"|"report"|"plan"|"preference"|"aiProposal"|"proposal"|"other";
const SOURCE_ORDER:WikiClaimSource[]=["decision","report","plan","preference","aiProposal","proposal"];
const SOURCE_LABELS:Record<Exclude<WikiClaimSource,"other">,[string,string]>={
 decision:["用户决定","User decision"],report:["用户报告（未核对实现）","User report (implementation not verified)"],
 plan:["计划","Plan"],preference:["用户偏好","User preference"],aiProposal:["AI 建议","AI proposal"],proposal:["建议（未确认采纳）","Proposal (adoption unconfirmed)"],
};

export function wikiClaimSource(claim:WikiClaim):WikiClaimSource {
 const reading=claim.sourceReading,status=reading?.status;
 if(status==="confirmed")return "decision";
 if(status==="reported"||!status&&claim.workStatus==="reported")return "report";
 if(status==="planned"||!status&&claim.workStatus==="planned")return "plan";
 if(status==="preference")return "preference";
 // Only an all-AI source basis names AI as the actor; a user's own suggestion is not an AI proposal.
 if(status==="proposal")return reading!.sources.length&&reading!.sources.every(source=>source.role==="assistant")?"aiProposal":"proposal";
 if(!status&&claim.workStatus==="proposed")return "proposal";
 return "other";
}

export function wikiClaimSourceLabel(source:WikiClaimSource,zh:boolean):string|undefined {
 return source==="other"?undefined:SOURCE_LABELS[source][zh?0:1];
}

type StatusSection=Pick<FocusSection,"claims"|"userEdited"|"origin"|"editorialReview">&{body?:string};
const generated=(section:StatusSection)=>!section.userEdited&&!section.origin;

function sourceCounts(claims:WikiClaim[]){
 const counts=new Map<WikiClaimSource,number>();
 for(const claim of claims){const source=wikiClaimSource(claim);counts.set(source,(counts.get(source)??0)+1);}
 return counts;
}
const USER_SOURCES:WikiClaimSource[]=["decision","report","preference"];
/** Sentences of generated prose that name the user as the one who decided, asked or objected. */
interface Stances {backed:number;unbacked:number}
const NO_STANCES:Stances={backed:0,unbacked:0};
const unconfirmedProposals=(counts:Map<WikiClaimSource,number>,total:number,stances:Stances=NO_STANCES)=>{
 const proposals=(counts.get("aiProposal")??0)+(counts.get("proposal")??0)+(counts.get("plan")??0);
 // "相关原文里没有看到你的确认" would contradict prose that says "用户明确要求……".
 return proposals*2>=total&&!counts.get("decision")&&!stances.backed&&!stances.unbacked;
};

// Only narration that names the user as the actor ("用户明确反驳……", "，用户还要求……").
// "经用户确认的决策", "区分用户确认和 AI 推断", "重度用户要求……" and "用户确认后才更新"
// describe roles or product rules: 用户 then follows another word, or the verb
// heads a noun phrase or a time clause.
const USER_STANCE=/(?:^|(?:(?<=[\s*，,。；;：:！？!?（(“「—])|(?<=[A-Za-z0-9)\]"'’*%`]\.)(?<!\b(?:e\.g|i\.e|vs|etc|incl|approx|cf)\.)(?=\s)))用户(?:已经?|也|还|曾|随后|同时|再次)?(?:明确)?(?:确认|决定|要求|提出|反驳|否定|拒绝|指出|强调|坚持|补充|认为)(?!了?(?:的|后|前|时|才|状态|是否|内容|事实|决策|结论|知识|信息|生成)|\s*[/／、和与或及])|\bthe user (?:explicitly )?(?:confirmed|decided|required|asked|rejected|insisted|chose)\b/iu;
export const stanceKey=(text:string)=>text.normalize("NFKC").toLocaleLowerCase().replace(/[\s*`_[\]（）()「」“”"'，,。.！!？?；;：:、-]/gu,"");
/** A stance sentence is backed when a claim it states has a user-authored source;
 * otherwise the cited originals do not show it. Code, quotations and tables are not narration. */
function userStances(section:StatusSection):Stances&{sentences:string[]} {
 if(!section.body)return {...NO_STANCES,sentences:[]};
 const prose=section.body.replace(/^(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1[^\n]*$/gmu,"").split("\n").filter(line=>!/^\s*(?:#|>|\|)/u.test(line)).join("\n");
 const claims=(section.claims??[]).map(claim=>({user:USER_SOURCES.includes(wikiClaimSource(claim))||Boolean(claim.sourceReading?.sources.some(source=>source.role==="user")),keys:[claim.text,...claim.formulations??[]].map(stanceKey).filter(key=>key.length>=6)}));
 let backed=0,unbacked=0;const sentences:string[]=[];const kept=new Set((section as {wikiStancesKept?:string[]}).wikiStancesKept??[]);
 for(const sentence of prose.split(/(?:(?<=[。！？!?])|(?<=[A-Za-z0-9)\]"'’*%`]\.)(?<!\b(?:e\.g|i\.e|vs|etc|incl|approx|cf)\.)(?=\s))|\n+/u)){
  // "材料未显示用户已确认采用" denies a stance; it does not name one.
  // Quoted words become an empty quote, so "反驳「…」的观点" does not read as "反驳的".
  const narration=sentence.replace(/“[^”]*”|「[^」]*」|`[^`\n]*`|"[^"\n]*"/gu,"「」"),stance=USER_STANCE.exec(narration);
  if(!stance||/(?:未|没|不|无|非)[^。，,；;]{0,6}$/u.test(narration.slice(0,stance.index)))continue;
  // "用户提出需要综合回答的问题时，……" is a condition, not a stance.
  if(/时$/u.test(narration.slice(stance.index).split(/[，,；;。！？!?]/u)[0]))continue;
  const key=stanceKey(sentence);
  // A stance the user kept as their own is backed by that choice.
  if(kept.has(key)){backed++;continue;}
  if(claims.some(claim=>claim.user&&claim.keys.some(text=>key.includes(text)||text.includes(key))))backed++;else{unbacked++;sentences.push(sentence.trim());}
 }
 return {backed,unbacked,sentences};
}
const addStances=(a:Stances,b:Stances)=>({backed:a.backed+b.backed,unbacked:a.unbacked+b.unbacked});

/** The chapter is mostly proposals and neither its cited originals nor its prose show the user's stance. */
export function wikiChapterUnconfirmed(section:StatusSection):boolean {
 if(!generated(section)||!section.claims?.length)return false;
 return unconfirmedProposals(sourceCounts(section.claims),section.claims.length,userStances(section));
}

/** How a source reads inside a sentence ("包含你的决定 2 条、AI 建议 3 条"). */
const SOURCE_PHRASES:Record<Exclude<WikiClaimSource,"other">,[(count:number)=>string,(count:number)=>string]>={
 decision:[count=>`你的决定 ${count} 条`,count=>`${count} of your decisions`],
 report:[count=>`你报告的进展 ${count} 条（实现未核对）`,count=>`${count} progress reports of yours (implementation not verified)`],
 plan:[count=>`计划 ${count} 条`,count=>`${count} plans`],
 preference:[count=>`你的偏好 ${count} 条`,count=>`${count} of your preferences`],
 aiProposal:[count=>`AI 建议 ${count} 条`,count=>`${count} AI proposals`],
 proposal:[count=>`未确认的建议 ${count} 条`,count=>`${count} unconfirmed proposals`],
};

/** One plain sentence about where a chapter's statements come from. A chapter that
 * is mostly proposals says so without counts; the absence of a decision is what was
 * found in the cited messages, not a statement about the whole conversation. */
function sourceLine(claims:WikiClaim[],zh:boolean,stances:Stances=NO_STANCES):string|undefined {
 const counts=sourceCounts(claims);
 const parts=SOURCE_ORDER.filter(source=>counts.get(source)).map(source=>SOURCE_PHRASES[source as Exclude<WikiClaimSource,"other">][zh?0:1](counts.get(source)!));
 if(!parts.length&&!stances.unbacked)return undefined;
 if(unconfirmedProposals(counts,claims.length,stances))return zh?"多为 AI 建议，相关原文里没有看到你的确认":"Mostly AI proposals; the cited messages show no decision of yours";
 const included=parts.length?zh?`包含${/^[A-Za-z]/u.test(parts[0])?" ":""}${parts.join("、")}`:`Includes ${parts.join(", ")}`:"";
 if(!stances.unbacked)return included;
 const unbacked=zh?`正文${parts.length?"另有":"有"} ${stances.unbacked} 处写到你的表态，引用原文里没有核对到`:`the text names your stance in ${stances.unbacked} ${parts.length?"more ":""}place${stances.unbacked>1?"s":""} the cited messages do not show`;
 return included?`${included}${zh?"；":"; "}${unbacked}`:zh?unbacked:unbacked[0].toUpperCase()+unbacked.slice(1);
}

/** Status line of one generated chapter: the source axis, then the user's own
 * review axis once the user has acted. "Not reviewed" on every chapter is noise;
 * the document status still counts reviewed chapters. Keeping a draft is an
 * editorial choice, never fact confirmation. */
export function wikiChapterStatus(section:StatusSection,zh:boolean):string|undefined {
 if(!generated(section)||!section.claims?.length)return undefined;
 const source=sourceLine(section.claims,zh,userStances(section));if(!source)return undefined;
 return wikiDraftKept(section as FocusSection)?`${source}${zh?"。你已保留这一章的整理稿（不代表事实已确认）":". You kept this draft (not a confirmation of the facts)"}`:source;
}

/** The sentences naming the user's stance that no cited message backs, so a reader can be taken to each. */
export function wikiUnbackedStances(section:StatusSection):string[] {
 if(!generated(section)||!section.claims?.length)return [];
 return userStances(section).sentences;
}

/** What a reader should know before trusting a chapter, without counts: how many AI proposals it holds changes
 * nothing for them. Only a chapter that is mostly unconfirmed proposals, prose naming the user's stance that no
 * cited message backs, or a draft the user kept says anything. */
/** A learning record leaves out "mostly AI proposals": there the AI explains, and unmarked text is its explanation. */
export function wikiChapterNotice(section:StatusSection,zh:boolean,learning=false):string|undefined {
 if(!generated(section)||!section.claims?.length)return undefined;
 const counts=sourceCounts(section.claims),stances=userStances(section),parts:string[]=[];
 // Marked sentences already say what is decided; unmarked text is the AI's by the legend, so "mostly proposals" repeats it.
 const marked=section.claims.some(claim=>claim.holderMark&&claim.holder);
 if(!marked&&!learning&&unconfirmedProposals(counts,section.claims.length,stances))parts.push(zh?"多为 AI 建议，相关原文里没有看到你的确认":"Mostly AI proposals; the cited messages show no decision of yours");
 else if(stances.unbacked)parts.push(zh?`正文有 ${stances.unbacked} 处写到你的表态，引用原文里没有核对到`:`The text names your stance in ${stances.unbacked} place${stances.unbacked>1?"s":""} the cited messages do not show`);
 if(wikiDraftKept(section as FocusSection))parts.push(zh?"你已保留这一章的整理稿（不代表事实已确认）":"You kept this draft (not a confirmation of the facts)");
 return parts.length?parts.join(zh?"。":". "):undefined;
}

/** A two-word tag for crowded chapter headers; the full source line goes in its tooltip.
 * Counts cover only extracted claims, so they are detail, never the headline. */
export function wikiChapterStatusTag(section:StatusSection,zh:boolean):{label:string;detail:string}|undefined {
 const detail=wikiChapterStatus(section,zh);if(!detail)return undefined;
 const counts=sourceCounts(section.claims!),stances=userStances(section);
 const label=counts.get("decision")?zh?"含用户决定":"Includes user decisions":counts.get("report")?zh?"含用户报告":"Includes user reports":stances.unbacked?zh?"提到你的表态":"Mentions your stance":unconfirmedProposals(counts,section.claims!.length,stances)?zh?"多为 AI 建议":"Mostly AI proposals":undefined;
 return label?{label,detail}:undefined;
}

/** Document-level counts across generated chapters, with the review axis summarised. */
export function wikiDocumentStatus(sections:StatusSection[],zh:boolean):string|undefined {
 const written=sections.filter(section=>!section.origin),chapters=written.filter(generated);
 const source=sourceLine(chapters.flatMap(section=>section.claims??[]),zh,chapters.map(userStances).reduce(addStances,NO_STANCES));if(!source)return undefined;
 const kept=chapters.filter(section=>wikiDraftKept(section as FocusSection)).length,edited=written.length-chapters.length;
 const review=[kept?zh?`已保留 ${kept}/${chapters.length} 章整理稿`:`${kept} of ${chapters.length} drafts kept`:"",edited?zh?`修改过 ${edited} 章`:`${edited} chapters edited`:""].filter(Boolean);
 return `${source}${zh?"。":". "}${review.length?review.join(zh?"，":", "):zh?"还没有逐章核对":"No chapter reviewed yet"}`;
}

/** A short form for crowded headers: user-sourced counts, all proposals as one
 * number, and the review state in two words. The full line stays in a tooltip. */
export function wikiDocumentStatusBrief(sections:StatusSection[],zh:boolean):string|undefined {
 const written=sections.filter(section=>!section.origin),chapters=written.filter(generated);
 const counts=sourceCounts(chapters.flatMap(section=>section.claims??[]));
 const proposals=(counts.get("aiProposal")??0)+(counts.get("proposal")??0)+(counts.get("plan")??0);
 const parts=[
  counts.get("decision")?zh?`用户决定 ${counts.get("decision")}`:`${counts.get("decision")} user decisions`:"",
  counts.get("report")?zh?`用户报告 ${counts.get("report")}`:`${counts.get("report")} user reports`:"",
  proposals?zh?`建议 ${proposals}`:`${proposals} proposals`:"",
 ].filter(Boolean);
 if(!parts.length)return undefined;
 const kept=chapters.filter(section=>wikiDraftKept(section as FocusSection)).length,edited=written.length-chapters.length;
 const review=kept||edited?zh?`已处理 ${kept+edited}/${written.length} 章`:`${kept+edited}/${written.length} handled`:zh?"未核对":"not reviewed";
 return [...parts,review].join(" · ");
}
