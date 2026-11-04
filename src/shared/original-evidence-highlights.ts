import type { FocusEvidence, FocusSession } from "./focus-session";
import type { ConversationMessage } from "./types";
import { sourceMessageSignature } from "./source-signature";
import { wikiQuoteRange } from "./wiki-claims";
import { chapterEvidence, evidenceSnapshotKey } from "./evidence-identity";
import {sourceQuoteText} from "./source-quote-text";

interface Interval { start: number; end: number }
const normalize = (value: string) => value.normalize("NFKC").toLowerCase();
const stop = /^(?:ai|the|and|for|with|from|this|that|will|have|project|user|产品|项目|用户|我们|这个|一个|可以|需要|进行|相关|功能|方案|内容|使用|实现|支持|目前|当前|以及|通过|其中|主要|核心|设计|介绍|说明|建议)$/u;
function terms(value: string): Set<string> {
  const words = normalize(sourceQuoteText(value)).match(/[a-z][a-z\d_+#.-]*|[\p{Script=Han}]+/gu) ?? [];
  return new Set(words.flatMap(word => /\p{Script=Han}/u.test(word)
    ? Array.from({length: Math.max(0, word.length - 1)}, (_, index) => word.slice(index, index + 2)) : [word]).filter(word => !stop.test(word)));
}

/** Lexical relevance selects passages to read; it never verifies a generated claim. */
function relevance(value: string, subject: Set<string>): number {
  if (!subject.size) return 0;
  const found = terms(value), matches = [...subject].filter(term => found.has(term));
  const identifier = matches.some(term => /^[a-z][a-z\d_+#.-]{1,}$/u.test(term));
  if (!identifier && matches.length < Math.min(2, subject.size)) return 0;
  return matches.length / Math.sqrt(Math.max(1, found.size));
}

/** Sentence offsets always come from the original, never from a normalized quote. */
function sentences(content: string, range: Interval): Interval[] {
  const result: Interval[] = [];
  const text = content.slice(range.start, range.end);
  let start = 0;
  for (const match of text.matchAll(/[。！？!?]+[”’"'）)*_~]*|\.(?=[*_~]*(?:\s|$))[*_~]*|\n|$/gu)) {
    const end = match.index! + match[0].length;
    const value = text.slice(start, end);
    if (value.trim() && !/^\s*(?:#{1,6}\s|`{3,}|~{3,}|\|?\s*:?-{3,})/u.test(value)) {
      const part={ start: range.start + start, end: range.start + end };
      if(value.length<=260)result.push(part);
      else {
        // Long unbroken paragraphs used to lose every highlight. Select whole
        // clauses, retaining an adjacent condition rather than cutting a phrase.
        const clauses:Interval[]=[];let from=part.start;
        for(const cut of value.matchAll(/[，,；;]|$/gu)){
          const to=part.start+cut.index!+cut[0].length;
          if(content.slice(from,to).trim())clauses.push({start:from,end:to});from=to;
        }
        for(const [index,clause] of clauses.entries()){
          const previous=clauses[index-1];
          const conditional=previous&&/^(?:\s*[*_>-]*\s*)(?:如果|假如|若|当|仅当|只有|除非|if\b|unless\b|when\b|only if\b)/iu.test(content.slice(previous.start,previous.end));
          result.push(conditional&&clause.end-previous.start<=260?{start:previous.start,end:clause.end}:clause);
        }
      }
    }
    start = end;
  }
  return result;
}

function sentenceContext(content: string, part: Interval): Interval {
  let start = part.start, end = part.end;
  const boundary=(at:number)=>/[。！？!?\n]/u.test(content[at]??"")||content[at]==="."&&!/\d/u.test(content[at+1]??"");
  while (start > 0 && part.start - start < 100 && !boundary(start-1)) start--;
  if (!/[。！？.!?\n][”’"'）)]*\s*$/u.test(content.slice(start, end))) {
    while (end < content.length && end - part.end < 100 && !boundary(end)) end++;
    if (/[。！？.!?]/u.test(content[end] ?? "")) end++;
  }
  return end - start <= 240 ? { start, end } : part;
}

/** Prefer retained claim quotations and the current topic over generic lead-ins.
 * Every returned string remains a literal slice of the selected original version. */
export function originalEvidenceHighlightTexts(session: FocusSession, ref: FocusEvidence, message: ConversationMessage, explicit?: string, scope?: {sectionId?:string; references?:FocusEvidence[]; focus?:string}): string[] {
  const identities = [message.id, message.platformMessageId];
  if (ref.conversationId !== message.conversationId || !identities.includes(ref.messageId)) return [];
  const expected = ref.sourceSignature ?? (!ref.sourceVersionId || ref.sourceVersionId === session.sourceVersionIds?.[ref.conversationId] ? session.sourceSignatures?.[ref.conversationId]?.[ref.messageId] : undefined);
  if (expected && expected !== sourceMessageSignature(message.content)) return [];
  const section = scope?.sectionId ? session.sections.find(item => item.id === scope.sectionId) : undefined;
  const candidates = scope?.sectionId ? section ? chapterEvidence(session, section) : [] : scope?.references ?? session.evidence;
  const related = candidates.filter(item => item.conversationId === ref.conversationId && identities.includes(item.messageId) && evidenceSnapshotKey(session, item) === evidenceSnapshotKey(session, ref));
  if (scope?.sectionId && !related.length) return [];
  const ids = new Set([...related.map(item => item.id), ref.id]);
  const claims = (scope?.sectionId ? section ? [section] : [] : session.sections).flatMap(item => item.origin || item.userEdited ? [] : item.claims ?? []);
  const records = scope?.sectionId ? [] : [...session.projectState?.modules ?? [], ...session.projectState?.decisions ?? [], ...session.projectState?.constraints ?? [], ...session.projectState?.actions ?? [], ...session.projectState?.history ?? []];
  const grounded = [...claims, ...records].filter(item => item.evidenceIds.some(id => ids.has(id)) && wikiQuoteRange(message.content, item.quote));
  const focus = scope?.focus?.trim() || section?.title || "";
  const subject = terms(focus);
  if (message.role === "user" && !explicit && !grounded.length && !subject.size) return [];
  // An unmatched explicit quotation must not borrow another claim's highlight.
  if (explicit && !wikiQuoteRange(message.content, explicit)) return [];
  const rankedGrounded=grounded.map(item=>({quote:item.quote,score:relevance(("text" in item ? item.text : item.title)+" "+item.quote,subject)}));
  const matchingGrounded=rankedGrounded.some(item=>item.score>0)?rankedGrounded.filter(item=>item.score>0):rankedGrounded;
  const anchors = explicit ? [{ quote: explicit, priority: 100 }]
    : grounded.length ? matchingGrounded.map(item => ({quote: item.quote, priority: 60 + item.score * 10}))
    : subject.size && wikiQuoteRange(message.content, ref.excerpt) ? [{quote: message.content, priority: 0}]
    : (related.length ? related : [ref]).map(item => ({quote: item.excerpt, priority: 0}));
  const scored: Array<Interval & {score:number}> = [];
  for (const anchor of anchors) {
    const range = wikiQuoteRange(message.content, anchor.quote);
    if (!range) continue;
    const parts = sentences(message.content, range);
    const broad = range.end - range.start > 220 || parts.length > 2;
    for (const part of broad ? parts : [range]) {
      const value = message.content.slice(part.start, part.end).trim();
      if (!value || value.length > 260) continue;
      const relatedness = relevance(value, subject);
      const signal = /决定|确认|必须|不得|不能|仅|只支持|不支持|尚未|未完成|因为|原因|关键|校验|验证|风险|限制|\b(?:must|never|only|because|decided|confirm|not yet|validate|risk)\b/iu.test(value);
      if ((subject.size && !relatedness && (broad || !anchor.priority)) || (broad && !subject.size && !signal && !anchor.priority)) continue;
      const selected = broad ? part : sentenceContext(message.content, part);
      scored.push({...selected, score: anchor.priority + relatedness * 20 + (signal ? 1 : 0)});
    }
  }
  const selected: Interval[] = [];
  let length = 0;
  for (const range of scored.sort((a,b) => b.score - a.score || (a.end-a.start) - (b.end-b.start) || a.start-b.start)) {
    if (selected.length >= 3) break;
    if (selected.some(previous => range.start < previous.end && range.end > previous.start) || length + range.end - range.start > 540) continue;
    selected.push(range); length += range.end - range.start;
  }
  return selected.sort((a,b) => a.start-b.start).map(range => message.content.slice(range.start, range.end).trim()).filter(Boolean);
}

export interface EvidenceHighlight { start:number; end:number; kind:"quote"|"context"|"related"; claimIndex?:number }
export interface EvidenceClaim { text:string; quote:string; evidenceIds:string[]; workStatus?:string }
type HighlightScope = {sectionId?:string;references?:FocusEvidence[];focus?:string};

/** Keep source offsets through rendering; the excerpt disambiguates repeated quotes. */
export function evidenceQuoteRange(content:string,quote:string,excerpt:string):Interval|undefined {
  const first=wikiQuoteRange(content,quote);if(!first)return;
  const anchor=wikiQuoteRange(content,excerpt);if(!anchor)return first;
  const matches=[first];let offset=first.start+1;
  while(offset<content.length){const next=wikiQuoteRange(content.slice(offset),quote);if(!next)break;const range={start:offset+next.start,end:offset+next.end};matches.push(range);offset=range.start+1;}
  const distance=(range:Interval)=>Math.max(anchor.start-range.end,range.start-anchor.end,0);
  return matches.sort((a,b)=>distance(a)-distance(b)||Math.abs(a.start-anchor.start)-Math.abs(b.start-anchor.start))[0];
}

export function originalEvidenceClaims(session:FocusSession,ref:FocusEvidence,message:ConversationMessage,scope?:HighlightScope):EvidenceClaim[]{
  const identities=[message.id,message.platformMessageId];
  if(ref.conversationId!==message.conversationId||!identities.includes(ref.messageId))return [];
  const section=scope?.sectionId?session.sections.find(item=>item.id===scope.sectionId):undefined;
  const candidates=scope?.sectionId?section?chapterEvidence(session,section):[]:scope?.references??session.evidence;
  const ids=new Set(candidates.filter(item=>item.conversationId===ref.conversationId&&identities.includes(item.messageId)&&evidenceSnapshotKey(session,item)===evidenceSnapshotKey(session,ref)).map(item=>item.id));
  const claims=(scope?.sectionId?section?[section]:[]:session.sections).flatMap(item=>item.origin||item.userEdited?[]:item.claims??[]);
  const records=scope?.sectionId?[]:[...session.projectState?.modules??[],...session.projectState?.decisions??[],...session.projectState?.constraints??[],...session.projectState?.actions??[],...session.projectState?.history??[]];
  return [...claims,...records.map(item=>({...item,text:"text" in item?item.text:item.title}))].filter(item=>item.evidenceIds.some(id=>ids.has(id)));
}

export function originalEvidenceHighlights(session:FocusSession,ref:FocusEvidence,message:ConversationMessage,explicit?:string,scope?:HighlightScope):EvidenceHighlight[]{
  const identities=[message.id,message.platformMessageId];
  const expected=ref.sourceSignature??(!ref.sourceVersionId||ref.sourceVersionId===session.sourceVersionIds?.[ref.conversationId]?session.sourceSignatures?.[ref.conversationId]?.[ref.messageId]:undefined);
  if(ref.conversationId!==message.conversationId||!identities.includes(ref.messageId)||expected&&expected!==sourceMessageSignature(message.content))return [];
  if(scope?.sectionId){const section=session.sections.find(item=>item.id===scope.sectionId);if(!section||!chapterEvidence(session,section).some(item=>evidenceSnapshotKey(session,item)===evidenceSnapshotKey(session,ref)&&identities.includes(item.messageId)))return [];}
  const claims=originalEvidenceClaims(session,ref,message,scope);
  const anchors=explicit!==undefined?[{quote:explicit,claimIndex:claims.findIndex(item=>item.quote===explicit)}]:claims.map((item,claimIndex)=>({quote:item.quote,claimIndex}));
  const result:EvidenceHighlight[]=[];
  for(const anchor of anchors){const range=evidenceQuoteRange(message.content,anchor.quote,ref.excerpt);if(!range)continue;
    if(sourceQuoteText(anchor.quote).length<12){const context=sentenceContext(message.content,range);if(context.start<range.start)result.push({start:context.start,end:range.start,kind:"context",claimIndex:anchor.claimIndex});if(context.end>range.end)result.push({start:range.end,end:context.end,kind:"context",claimIndex:anchor.claimIndex});}
    result.push({...range,kind:"quote",claimIndex:anchor.claimIndex});
  }
  if(explicit!==undefined||claims.length)return result;
  // Lexical suggestions remain available only as unverified reading hints.
  return originalEvidenceHighlightTexts(session,ref,message,undefined,scope).flatMap(text=>{const range=evidenceQuoteRange(message.content,text,ref.excerpt);return range?[{...range,kind:"related" as const}]:[];});
}

export function evidenceRoleWarnings(claim:EvidenceClaim,messages:ConversationMessage[],refs:FocusEvidence[],accepted=false):Array<"assistant-decision"|"pasted-ai"|"unproven-completion">{
  const sources=messages.filter(message=>refs.some(ref=>claim.evidenceIds.includes(ref.id)&&ref.conversationId===message.conversationId&&[message.id,message.platformMessageId].includes(ref.messageId)&&(!ref.sourceSignature||ref.sourceSignature===sourceMessageSignature(message.content)))&&wikiQuoteRange(message.content,claim.quote));
  const warnings:Array<"assistant-decision"|"pasted-ai"|"unproven-completion">=[];
  if(sources.length&&(accepted||/用户(?:已)?(?:决定|确认|选择|采用)|已确认|\b(?:decided|confirmed|adopted)\b/iu.test(claim.text+" "+(claim.workStatus??"")))&&sources.every(message=>message.role==="assistant"))warnings.push("assistant-decision");
  const clean=(text:string)=>sourceQuoteText(text).normalize("NFKC").replace(/\s/gu,"");const quote=clean(claim.quote);
  if(quote.length>=20&&sources.some(message=>message.role==="user"&&messages.some(earlier=>earlier.conversationId===message.conversationId&&earlier.role==="assistant"&&earlier.messageIndex<message.messageIndex&&clean(earlier.content).includes(quote))))warnings.push("pasted-ai");
  const completion=/(?:已(?:经)?(?:全部|正式|基本)?(?:实现|完成|通过|发布|上线|接入|定型)|完成了|实现了|建立了|\b(?:implemented|completed|tests? passed|released|established|shipped)\b)/iu;
  const qualified=/(?:尚未|还未|未完成|没有完成|未实现|尚未实现|not yet|not completed|not implemented)/iu;
  if(completion.test(claim.text)&&!qualified.test(claim.text)&&sources.some(message=>message.role==="assistant"||/建议|计划|将|可以先|\b(?:suggest|plan|will|could)\b/iu.test(claim.quote)))warnings.push("unproven-completion");
  return warnings;
}
