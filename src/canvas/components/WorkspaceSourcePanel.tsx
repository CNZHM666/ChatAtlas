import { useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { wikiHolderReadingLabel, wikiHolderTitle, type WikiHolder } from "../../shared/wiki-holder";
import { ArrowLeft, ArrowUp, ArrowUpRight, CheckCircle2, ChevronLeft, ChevronRight, X } from "lucide-react";
import type { ConversationMessage } from "../../shared/types";
import type { FocusEvidence, FocusSession } from "../../shared/focus-session";
import { readSessionSource } from "../../storage/source-versions";
import { sourceMessageSignature } from "../../shared/source-signature";
import { messageTurn } from "../../shared/message-turns";
import { wikiQuoteRange } from "../../shared/wiki-claims";
import { sourceQuoteText } from "../../shared/source-quote-text";
import { pastedMaterial } from "../../shared/source-text-display";
import { evidenceAttentionText, listItems } from "../../shared/claim-meaning";
import { derivedSentenceRanges, evidenceListGroups, listItemRanges, meaningTerms, namedSourceLists, similarSentenceRanges } from "../claim-highlight";
import { exactSourceSentence, narrowQuotePassages } from "../narrow-quote";
import { evidenceConditionDescription, evidenceConditionDescriptionMatches, evidenceConditions, evidenceConditionsMatch } from "../evidence-conditions";
import { ProjectExampleContext } from "../project-example-context";
import { SourceMessageContent } from "./SourceMessageContent";
import { WorkspacePaneResize } from "./WorkspacePaneResize";
import { chapterEvidence, evidenceSnapshotKey, evidenceVersion, evidenceReadingGroups,ambiguousEvidenceVersion } from "../../shared/evidence-identity";
import { invalidateMessageReadCache, messageReadCacheRevision } from "../../storage/message-read-cache";
import "../workspace-source-panel.css";
import { originalEvidenceHighlights, originalEvidenceClaims, evidenceRoleWarnings, type EvidenceHighlight } from "../../shared/original-evidence-highlights";
import { evidenceTextLocator, evidenceTextRange, evidenceSourceRanges } from "../evidence-highlight";
import { needsConfirmation, type EvidencePoint, type WorkspaceEvidenceOptions } from "../workspace-evidence-context";
import {evidenceReadingIdentity,markEvidenceRead} from "../../storage/evidence-reading";
import { wikiQuoteAsksOnlyForFeedback } from "../../shared/wiki-said-in-quote";
const noMessages:ConversationMessage[]=[];
const sharedSourceCache = new Map<string, { revision: number; messages: ConversationMessage[] }>();
const MAX_SHARED_SOURCE_CACHE = 16;

function readSharedSourceCache(key: string): ConversationMessage[] | undefined {
  const hit = sharedSourceCache.get(key);
  if (!hit || hit.revision !== messageReadCacheRevision()) return undefined;
  sharedSourceCache.delete(key);
  sharedSourceCache.set(key, hit);
  return hit.messages;
}

function writeSharedSourceCache(key: string, messages: ConversationMessage[]) {
  sharedSourceCache.delete(key);
  sharedSourceCache.set(key, { revision: messageReadCacheRevision(), messages });
  while (sharedSourceCache.size > MAX_SHARED_SOURCE_CACHE) {
    sharedSourceCache.delete(sharedSourceCache.keys().next().value!);
  }
}

const visibleTerms=(text:string)=>meaningTerms(sourceQuoteText(text.replace(/<[^>]*>/gu," ")));
const overlap=(own:Set<string>,theirs:Set<string>)=>{let shared=0;for(const term of own)if(theirs.has(term))shared++;return {shared,cover:shared/Math.max(1,Math.min(own.size,theirs.size))};};
/** Trust a saved quote unless it is clearly pointing at an unrelated passage (empty feedback prompt,
 * wrong numeric condition, or virtually zero overlap while another sentence directly states the claim). */
function quoteSupports(claim:string,quote:string,content:string){
  if(wikiQuoteAsksOnlyForFeedback(quote)&&!wikiQuoteRange(quote,claim))return false;
  const conditions=evidenceConditions(claim);
  if(conditions.length&&(!evidenceConditionsMatch(conditions,sourceQuoteText(quote))||!evidenceConditionDescriptionMatches(meaningTerms(evidenceConditionDescription(claim)),visibleTerms(quote))))return false;
  const own=meaningTerms(claim),theirs=visibleTerms(quote);
  if(own.size<3)return true;
  const fit=overlap(own,theirs);
  if(fit.shared>=3&&fit.cover>=0.25&&fit.shared/own.size>=0.35)return true;
  if(content.split(/(?<=[。！？!?；;])|\n/u).some(sentence=>{const near=overlap(own,visibleTerms(sentence));return near.cover>=0.6&&near.shared>=Math.max(3,fit.shared+2);}))return false;
  if(fit.shared>=2&&fit.cover>=0.2)return true;
  if(/(?:^|\n)[ >\t]*(?:`{3,}|~{3,})/u.test(content)){
    const lines=sourceQuoteText(content).split("\n").filter(line=>meaningTerms(line).size);
    for(let first=0;first<lines.length;first++){
      const window=lines.slice(first,first+12).join("\n");if(window.length>2400)continue;
      const near=overlap(own,visibleTerms(window));
      if(near.cover>=.6&&near.shared>=Math.min(6,own.size)&&near.shared/own.size>=.35)return false;
    }
  }
  return true;
}
/** Reads the same retained originals as Reader; never generates source text or dates. */
/** Four clear status options matching the chapter status filter bar. */
const editableHolders: WikiHolder[] = ["decided", "open", "earlier", "ai"];
const ANSWERS: Array<[WikiHolder, string, string]> = editableHolders.map(holder => [holder, wikiHolderReadingLabel(holder, true), wikiHolderReadingLabel(holder, false)]);
/** An answer keeps or sets the sentence's status, or takes the reader to rewrite it: a sentence that misstates its
 * original is fixed in the text, not by marking it 未定. */
type Answer = [WikiHolder | "edit" | undefined, string, string];
type Question = { ask: [string, string]; why?: [string, string]; comparison?: { source: string; wording: string }; answers: Answer[] };
const clip = (text: string, size = 28) => { const chars = Array.from(text.trim()); return chars.length > size ? chars.slice(0, size).join("") + "…" : chars.join(""); };
/** The one question a point is flagged for, worded after what was found, with the words of the original that raised it. */
function questionOf(point: EvidencePoint, canEdit: boolean, originalLocated:boolean): Question {
  const keep = point.holder, attention = point.attention, cue = attention?.cue ? clip(attention.cue) : "";
  const fix: Answer[] = canEdit ? [["edit", "改这句", "Rewrite it"]] : [["open", "标为未定", "Mark open"]];
  if (attention?.kind === "settled") return { ask: ["这句是你的决定吗？", "Is this your decision?"], why: ["写成了已决定，原文里只有 AI 的建议", "Written as decided; the original only has an AI proposal"],
    comparison: attention.claimExcerpt ? { source: "", wording: attention.claimExcerpt } : undefined,
    answers: [["decided", "是我的决定", "Yes, mine"], ["ai", "只是建议", "Just a suggestion"]] };
  switch (attention?.kind) {
    case "negation": return {
      ask: attention.subject ? [`核对「${attention.subject}」的版本范围`, `Check the release scope for “${attention.subject}”`] : ["核对这项限制", "Check this restriction"],
      why: ["这两处对适用范围的表述可能有差异。", "These passages may describe different conditions or scope."],
      comparison: { source: attention.subject && cue ? `${attention.subject} · ${cue}` : attention.cue ?? "", wording: attention.claimExcerpt ?? point.claim },
      answers: [[undefined, "保留正文", "Keep Wiki text"], ...(canEdit ? fix : [])],
    };
    case "tentative": return { ask: [cue ? `原话只是在考虑：「${cue}」` : "原话只是在考虑或建议", cue ? `The original only considers it: "${cue}"` : "The original only considers it"], why: ["这句写得更肯定", "This sentence states it firmly"], answers: [["ai", "改成建议", "Make it a suggestion"], ["decided", "确实已定", "It is decided"]] };
    case "missing": return { ask: originalLocated?["已在来源中定位到引用","The quote was located in this source"]:["原文里没找到这句的原话", "This sentence's quote isn't in the original"], why: ["请确认它的来源", "Check where it comes from"], answers: [[keep, "来源没问题", "Source is fine"], ...fix] };
    case "approximate": return { ask: ["下面的原文说的是同一件事吗？", "Does the original below say the same thing?"], why: ["它是按措辞对上的，不是逐字原话", "It was matched by wording, not word for word"], answers: [[keep, "是同一件事", "Same thing"], ...fix] };
    case "partial": return { ask: ["原文只支持这句的一部分", "The original supports only part of this"], why: attention.reason ? [attention.reason, attention.reason] : undefined, answers: [[keep, "没问题", "It's right"], ...fix] };
    case "unsupported": return { ask: ["原文没有说这句", "The original doesn't say this"], why: attention.reason ? [attention.reason, attention.reason] : undefined, answers: [[keep, "来源没问题", "Source is fine"], ...fix] };
    default: return { ask: ["这句和原话意思一致吗？", "Does this say what the original says?"], answers: [[keep, "一致", "Yes"], ...fix] };
  }
}
/** A point to confirm asks its one question. Any other shows the status it keeps (recorded, once answered) as a quiet
 * line, whose link offers every status. */
function HolderQuestion({ point, zh, asked, canEdit, originalLocated, onAnswer, onSkip }: { point: EvidencePoint; zh: boolean; asked: boolean; canEdit: boolean; originalLocated:boolean; onAnswer: (answer: Answer[0]) => void; onSkip?: () => void }) {
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [point.key]);
  const l = ([cn, en]: [string, string]) => zh ? cn : en;
  const current = point.holder;
  if (!asked && !open) return <div className="workspace-source-holder-bar" role="group" aria-label={zh ? "结论状态" : "Claim status"}>
    <span className="workspace-source-holder-label">{point.checked ? (zh ? "已核对" : "Checked") : (zh ? "状态" : "Status")}</span>
    <div className="workspace-source-holder-pills">
      {ANSWERS.map(([holder, cn, en]) => <button key={holder} type="button" aria-pressed={current === holder} className={`is-holder-${holder}`} title={wikiHolderTitle(holder, zh)} onClick={() => onAnswer(holder)}>{zh ? cn : en}</button>)}
    </div>
  </div>;
  const question: Question = asked&&!open ? questionOf(point, canEdit,originalLocated) : { ask: ["这句的状态", "This sentence's status"], answers: ANSWERS };
  return <div className={`workspace-source-holder${asked && !open ? " is-review-card" : ""}`} role="group" aria-label={l(question.ask)}><span>{l(question.ask)}{question.why ? <small>{l(question.why)}</small> : null}</span>
    {question.comparison?<dl className="workspace-source-comparison">
      {question.comparison.source?<><dt>{zh?"原话线索":"Source wording"}</dt><dd>{question.comparison.source}</dd></>:null}
      <dt>{zh?"Wiki 正文":"Wiki text"}</dt><dd>{question.comparison.wording}</dd>
    </dl>:null}
    <div className="workspace-source-holder-actions">{question.answers.map(([holder, cn, en], index) => <button key={cn} type="button" aria-pressed={point.checked&&current===holder||undefined} className={`is-holder-${holder??"keep"}${asked&&!open&&index===0?" is-primary":""}`} title={!holder||holder==="edit"?undefined:wikiHolderTitle(holder, zh)} onClick={() => { setOpen(false); onAnswer(holder); }}>{zh ? cn : en}</button>)}
      {(asked&&!open&&onSkip)||(asked&&point.attention?.kind!=="negation") ? <span className="workspace-source-holder-secondary">
        {asked&&!open&&onSkip?<button type="button" className="workspace-source-holder-more" onClick={onSkip}>{zh?"跳过":"Skip"}</button>:null}
        {asked&&point.attention?.kind!=="negation"?<button type="button" className="workspace-source-holder-more" onClick={()=>setOpen(!open)}>{open?(zh?"返回核对":"Back to review"):(zh?"改状态":"Change")}</button>:null}
      </span> : null}
    </div></div>;
}
/** Which mark shows where two overlap: the quote over close wording over its surrounding sentence; the lines (cue,
 * rest of the exchange) above them all, since they only underline. */
const HIGHLIGHT_PRIORITY:Record<string,number>={"atlas-original-context":0,"atlas-original-related":1,"atlas-original-support":1,"atlas-original-similar":2,"atlas-original-proof":3,"atlas-original-cue":4};
export function WorkspaceSourcePanel({ session, reference, references, onSelect, claim, quote: savedQuote, sourcePassages, tableTarget, sectionId, readerError, zh, onClose, onReader, embedded=false, returnLabel, points, pointIndex, onPoint, onHolder, next, mode, locationRevision, onEditClaim, onToolsHost, showSourceTitle = false }: {
  session: FocusSession; reference: FocusEvidence; references?: FocusEvidence[]; claim?: string; quote?: string; conversationTitle?: string; zh: boolean;
  sourcePassages?: WorkspaceEvidenceOptions["sourcePassages"];
  onSelect: (ref: FocusEvidence) => void; onClose: () => void; onReader?: () => void; embedded?:boolean; returnLabel?:string;
  readerError?: string; sectionId?:string; tableTarget?:string;
  showSourceTitle?: boolean;
  /** Point-by-point mode: step through claims; references are only this point's originals. */
  points?: EvidencePoint[]; pointIndex?: number; onPoint?: (index: number) => void; locationRevision?:number;
  onToolsHost?: (element: HTMLDivElement | null) => void;
  /** Switches the status the sentence is marked with: a wrong status is a wrong mark, fixed here, not by editing prose. */
  onHolder?: (point: EvidencePoint, holder: WikiHolder|undefined) => boolean|void;
  /** A workspace check going on past this chapter: shown at its last point, it moves on to the next chapter to check. */
  next?: { label: string; onNext: () => void };
  /** "check": stepping through the points to confirm; otherwise the reader opened one sentence's source, which shows
   * the original and asks only when that sentence itself needs an answer. */
  mode?: "check" | "view";
  /** Takes the reader to rewrite a sentence that misstates its original. */
  onEditClaim?: (point: EvidencePoint) => void;
}) {
  const point = points && pointIndex !== undefined ? points[pointIndex] : undefined;
  // Asking: the question says what is wrong, so the kind chip, the flag banner and the no-literal-match line go.
  // Checking at all: the question or the recorded status says it, so none of them shows, an answered point included.
  const checking = Boolean(point && onHolder);
  const example = useContext(ProjectExampleContext);
  const version=evidenceVersion(session,reference);
  const conversationId=reference.conversationId,snapshot=evidenceSnapshotKey(session,reference);
  const signatures=session.sourceSignatures?.[conversationId],roles=session.sourceRoles?.[conversationId],order=session.sourceMessageOrder?.[conversationId];
  const revision = useMemo(()=>JSON.stringify([session.id,conversationId,version,snapshot,signatures,roles,order]),
    [session.id,conversationId,version,snapshot,signatures,roles,order]);
  const sharedCacheKey = version ? revision : undefined;
  const [loaded, setLoaded] = useState<{key:string;messages:ConversationMessage[];reference:FocusEvidence} | undefined>(() => {
    const warm = !example && sharedCacheKey ? readSharedSourceCache(sharedCacheKey) : undefined;
    return warm ? { key: revision, messages: warm, reference } : undefined;
  }), [loading, setLoading] = useState(() => !(!example && sharedCacheKey && readSharedSourceCache(sharedCacheKey))), [error, setError] = useState(""), [context, setContext] = useState(false);
  const [contextExtra, setContextExtra] = useState<{ key: string; before: number; after: number }>();
  const [claimExpanded, setClaimExpanded] = useState(false);
  const [scrolledAway, setScrolledAway] = useState(false);
  const prepended = useRef<{ message: HTMLElement; top: number }>();
  useEffect(() => { setClaimExpanded(false); setScrolledAway(false); }, [claim, point?.key, context]);
  const cache=useRef(new Map<string,ConversationMessage[]>());
  const [highlights,setHighlights]=useState<Array<{top:number;left:number;width:number;height:number;kind:EvidenceHighlight["kind"]|"support"}>>([]),[retry,setRetry]=useState(0);
  const [overlay, setOverlay] = useState(() => window.matchMedia?.("(max-width:940px)").matches ?? false);
  const [conditionMissing,setConditionMissing]=useState(false);
  const [renderRevision,setRenderRevision]=useState(0);
  const [missingTable,setMissingTable]=useState("");
  const manualPosition=useRef("");
  const registeredHighlights = useRef(new Map<string, Highlight>());
  const clearSourceHighlights = () => {
    if (typeof Highlight === "undefined" || !globalThis.CSS?.highlights) return;
    for (const [name, highlight] of registeredHighlights.current) {
      if (CSS.highlights.get(name) === highlight) CSS.highlights.delete(name);
    }
    registeredHighlights.current.clear();
  };
  useEffect(() => clearSourceHighlights, []);
  const panel = useRef<HTMLElement>(null), body = useRef<HTMLDivElement>(null), targetBody = useRef<HTMLDivElement>(null), turnAnchor = useRef<HTMLElement>(null), contentRoot=useRef<HTMLDivElement>(null), endSpacer=useRef<HTMLDivElement>(null);
  // Keep the last committed source visible while another conversation loads. Never label it as the new proof.
  const committedReference=useRef(reference);
  if(loaded?.key===revision)committedReference.current=reference;
  const current=loaded?.key===revision?reference:committedReference.current;
  const messages=loaded?.messages??noMessages;
  useEffect(() => { const workspace = panel.current?.closest(".focus-workspace, .focus-preview"); if (!workspace) return; const update = () => setOverlay(workspace.getBoundingClientRect().width < 940); update(); if (typeof ResizeObserver === "undefined") return; const observer = new ResizeObserver(update); observer.observe(workspace); return () => observer.disconnect(); }, []);
  useEffect(() => {
    let alive = true; setError("");
    const cached = cache.current.get(revision) ?? (!example && sharedCacheKey ? readSharedSourceCache(sharedCacheKey) : undefined);
    if(cached){cache.current.set(revision,cached);setLoaded({key:revision,messages:cached,reference});setLoading(false);return;}
    setLoading(true);
    // Refresh live sources once on entry; message changes reuse the loaded snapshot.
    if(!example&&!version)invalidateMessageReadCache(reference.conversationId);
    const read = ambiguousEvidenceVersion(session,reference)?Promise.resolve([]):example ? Promise.resolve(example.knowledge(session).messages.filter(message => message.conversationId === reference.conversationId)) : readSessionSource(session, reference.conversationId, reference.messageId, version);
    void read.then(value => { if (alive) {cache.current.set(revision,value);while(cache.current.size>8)cache.current.delete(cache.current.keys().next().value!);if(!example&&sharedCacheKey&&value.length)writeSharedSourceCache(sharedCacheKey,value);setLoaded({key:revision,messages:value,reference});} }).catch(() => { if (alive) setError(zh ? "原文读取失败，请重试。" : "Could not load the original. Retry loading."); }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
    // Message selection in the same immutable source does not reread or remount it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revision, example, retry]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    if (overlay || embedded) panel.current?.querySelector<HTMLButtonElement>(".workspace-source-close")?.focus({ preventScroll: true });
    return () => { if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, [overlay,embedded]);
  useEffect(() => { if(embedded)return;const base = panel.current?.closest(".focus-workspace, .focus-preview")?.querySelector<HTMLElement>(".project-reading-base, .focus-preview-scroll"); if (!base) return; const previous = base.inert; base.inert = overlay || [...document.querySelectorAll(".ai-context-backdrop")].some(element=>!element.closest("[hidden]")); return () => { base.inert = previous; }; }, [embedded, overlay]);
  const target = messages.find(message => message.id === current.messageId || message.platformMessageId === current.messageId);
  const quotes = useMemo(() => {
    const currentIds = sourcePassages && target ? new Set((references ?? [current]).filter(ref =>
      ref.conversationId === target.conversationId && (ref.messageId === target.id || ref.messageId === target.platformMessageId)
      && evidenceSnapshotKey(session, ref) === evidenceSnapshotKey(session, current)).map(ref => ref.id)) : undefined;
    const originals = currentIds ? sourcePassages!.filter(item => currentIds.has(item.referenceId)).map(item => item.quote) : savedQuote ? [savedQuote] : [];
    if (claim && target && !sourcePassages && !originals.some(quote => wikiQuoteRange(target.content, quote))) {
      const exact = exactSourceSentence(claim, target.content);
      if (exact) return [exact];
    }
    return [...new Set(originals.flatMap(original => {
      if (!claim) return [original];
      if (wikiQuoteAsksOnlyForFeedback(original) && !wikiQuoteRange(original, claim)) return [];
      const narrowed = narrowQuotePassages(claim, original);
      return target && !narrowed.some(part => wikiQuoteRange(target.content, part)) && wikiQuoteRange(target.content, original) ? [original] : narrowed;
    }))];
  }, [claim, savedQuote, sourcePassages, references, current, target, session]);
  const quote = quotes[0];
  const excerpt = quote || current.excerpt;
  const located = target && wikiQuoteRange(target.content, excerpt);
  const locatedStart=located?.start,locatedEnd=located?.end;
  const stale = Boolean(target && current.sourceSignature && current.sourceSignature !== sourceMessageSignature(target.content));
  const section=sectionId?session.sections.find(item=>item.id===sectionId):undefined;
  const pointMode=Boolean(point);
  const scopedReferences=useMemo(()=>tableTarget?[reference]:pointMode?references??[reference]:sectionId?section?chapterEvidence(session,section):[]:references??[reference],
    [tableTarget,pointMode,sectionId,section,session,references,reference]);
  const sourceClaims=useMemo(()=>!tableTarget&&target?originalEvidenceClaims(session,current,target,{sectionId,references:scopedReferences}):[],[tableTarget,target,session,current,sectionId,scopedReferences]);
  // Every quote of the claims citing this original is marked; the claims themselves are highlighted in the document.
  // A saved quote that shares almost nothing with its claim points at the wrong passage (a component block below
  // the heading that says it): it is not marked or scrolled to; the sentences closest to the claim are, headings included.
  const quoteFits=useMemo(()=>!quotes.length||!claim||!target||quoteSupports(claim,quotes.join("\n"),target.content),[claim,quotes,target]);
  const originalLocated = Boolean(target && quoteFits && !loading && !stale && quotes.length && quotes.every(text=>wikiQuoteRange(target.content,text)));
  const asking = Boolean(point && onHolder && mode!=="view" && needsConfirmation(point));
  const explicitQuote=quoteFits?quote:undefined;
  const [warningSources,setWarningSources]=useState<{key:string;messages:ConversationMessage[]}>();
  const hasRoleWarnings = !point && sourceClaims.length > 0;
  const warningKey=useMemo(() => hasRoleWarnings ? JSON.stringify([session.id,sourceClaims,scopedReferences,session.sourceVersionIds,session.sourceSignatures,session.sourceRoles]) : "",
    [hasRoleWarnings, session.id, sourceClaims, scopedReferences, session.sourceVersionIds, session.sourceSignatures, session.sourceRoles]);
  useEffect(()=>{
    if (!warningKey) return;
    let alive=true;const ids=new Set(sourceClaims.flatMap(item=>item.evidenceIds));
    const refs=scopedReferences.filter(ref=>ids.has(ref.id)),unique=[...new Map(refs.map(ref=>[evidenceSnapshotKey(session,ref),ref])).values()];
    if(!unique.length)return;
    void Promise.all(unique.map(async ref=>{
      const resolved=evidenceVersion(session,ref),key=JSON.stringify([session.id,ref.conversationId,resolved,evidenceSnapshotKey(session,ref),session.sourceSignatures?.[ref.conversationId],session.sourceRoles?.[ref.conversationId],session.sourceMessageOrder?.[ref.conversationId]]);
      try{const value=cache.current.get(key)??(ambiguousEvidenceVersion(session,ref)?[]:example?example.knowledge(session).messages.filter(message=>message.conversationId===ref.conversationId):await readSessionSource(session,ref.conversationId,ref.messageId,resolved));if(alive)cache.current.set(key,value);return value;}catch{return undefined;}
    })).then(results=>{if(alive)setWarningSources({key:warningKey,messages:results.flatMap(value=>value??[])});});
    return()=>{alive=false;};
  // The serialized key binds all original versions and claim identities.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[warningKey,example]);
  const roleMessages=warningSources?.key===warningKey?warningSources.messages:messages;
  // Point mode leads with the quoted passage; the whole message and conversation are opt-in.
  // Both ways in show the same thing: the whole question and reply, the cited words highlighted.
  const turn = useMemo(()=>target ? messageTurn(messages,target) : [],[messages,target]);
  const targetIndex = target ? messages.indexOf(target) : -1;
  const extra = contextExtra?.key === revision ? contextExtra : { key: revision, before: 0, after: 0 };
  const contextStart = Math.max(0, targetIndex - 2 - extra.before);
  const contextEnd = Math.min(messages.length, targetIndex + 3 + extra.after);
  const shown = useMemo(() => context ? messages.slice(contextStart, contextEnd) : turn, [context, messages, contextStart, contextEnd, turn]);
  const positionKey = JSON.stringify([revision, target?.id, claim, quote, tableTarget, locationRevision, context]);
  const extendContext = (direction: "before" | "after") => {
    manualPosition.current = positionKey;
    const anchor = direction === "before" ? body.current?.querySelector<HTMLElement>("[data-message-id]") : undefined;
    if (anchor) prepended.current = { message: anchor, top: anchor.getBoundingClientRect().top };
    setContextExtra({ ...extra, [direction]: extra[direction] + 4 });
  };
  const scrollBackToTarget = () => {
    const host = body.current, node = targetBody.current;
    if (!host || !node) return;
    const bounds = host.getBoundingClientRect(), rect = node.getBoundingClientRect();
    host.scrollTo?.({ top: Math.max(0, host.scrollTop + rect.top - bounds.top - 48), behavior: "smooth" });
    setScrolledAway(false);
  };
  useLayoutEffect(() => {
    const anchor = prepended.current;
    if (anchor && body.current) body.current.scrollTop += anchor.message.getBoundingClientRect().top - anchor.top;
    prepended.current = undefined;
  }, [contextStart]);
  const proofEntries = useMemo<Array<{id:string;marks:EvidenceHighlight[]}>>(()=>{
    if (tableTarget || !target || !quoteFits) return [];
    const refs=scopedReferences.filter(ref=>evidenceSnapshotKey(session,ref)===evidenceSnapshotKey(session,current)&&[target.id,target.platformMessageId].includes(ref.messageId));
    const selected=refs.some(ref=>ref.id===current.id)?current:refs[0];
    const inputs = quotes.length ? quotes : claim ? wikiQuoteRange(target.content, claim) ? [claim] : [] : [undefined];
    const marks=selected?inputs.flatMap(quote=>originalEvidenceHighlights(session,selected,target,quote,{sectionId,references:scopedReferences,focus:claim||section?.title,allowStale:stale})):[];
    return marks.length ? [{id:target.id,marks}] : [];
  },[scopedReferences,session,current,quotes,quoteFits,sectionId,section,claim,target,tableTarget,stale]);
  const hasRelatedProofs = useMemo(()=>proofEntries.some(proof=>proof.marks.some(mark=>mark.kind==="related")),[proofEntries]);
  useEffect(()=>{
    const root=contentRoot.current;if(loading||!root)return;
    let timer=0;
    // Debounce lazy code-highlighting / long-text commits so rapid point switching stays smooth.
    const observer=new MutationObserver(records=>{
      if(!records.some(record=>record.addedNodes.length||record.removedNodes.length))return;
      if(timer)window.clearTimeout(timer);
      timer=window.setTimeout(()=>{timer=0;setRenderRevision(value=>value+1);},80);
    });
    observer.observe(root,{childList:true,subtree:true});
    return()=>{observer.disconnect();if(timer)window.clearTimeout(timer);};
  },[loading,target,context]);
  useEffect(() => {
    setHighlights([]);setConditionMissing(false);if(loading||!targetBody.current||!target){clearSourceHighlights();return;}
    const root=targetBody.current,host=body.current;if(!host){clearSourceHighlights();return;}
    if(tableTarget){
      clearSourceHighlights();
      if(loaded?.key!==revision||root.querySelector('.reader-long-text[aria-busy="true"]'))return;
      const matches=[...root.querySelectorAll<HTMLTableElement>("table[data-wiki-original-table]")]
        .filter(node=>node.dataset.wikiOriginalTable===tableTarget);
      const atQuote=matches.length>1&&locatedStart!==undefined&&locatedEnd!==undefined?matches.filter(node=>{
        const start=node.dataset.readerSourceStart,end=node.dataset.readerSourceEnd;
        return start!==undefined&&end!==undefined&&Number(start)<locatedEnd&&Number(end)>locatedStart;
      }):[];
      const table=matches.length===1?matches[0]:atQuote.length===1?atQuote[0]:undefined;
      setMissingTable(table?"":positionKey);
      table?.setAttribute("data-atlas-table-active","true");
      const anchor=table??root;
      const stop=()=>{manualPosition.current=positionKey;};
      const events=["wheel","touchstart","pointerdown","keydown"];
      const position=()=>{
        if(manualPosition.current===positionKey)return;
        const rect=anchor.getBoundingClientRect(),bounds=host.getBoundingClientRect(),lead=20;
        if(endSpacer.current){
          const below=endSpacer.current.getBoundingClientRect().top-rect.top;
          endSpacer.current.style.height=`${Math.max(0,host.clientHeight-lead-below-16)}px`;
        }
        if(rect.height)host.scrollTop=Math.max(0,host.scrollTop+rect.top-bounds.top-lead);
      };
      for(const event of events)host.addEventListener(event,stop,{passive:true});
      position();
      const frame=requestAnimationFrame(position);
      return()=>{cancelAnimationFrame(frame);for(const event of events)host.removeEventListener(event,stop);table?.removeAttribute("data-atlas-table-active");};
    }
    const messageRoots=Array.from(contentRoot.current?.querySelectorAll<HTMLElement>("[data-source-content]")??[]);
    const turnIds=new Set(turn.map(message=>message.id));
    const neighbouringRoots=messageRoots.filter(element=>element!==root&&turnIds.has(element.dataset.sourceContent??""));
    const matchedProofs = proofEntries.flatMap(proof=>{const messageRoot=messageRoots.find(item=>item.dataset.sourceContent===proof.id),message=shown.find(item=>item.id===proof.id);return messageRoot&&message?evidenceSourceRanges(messageRoot,message.content,proof.marks):[];});
    const required=evidenceConditions(claim??""),proofText=matchedProofs.filter(proof=>proof.highlight.kind==="quote").map(proof=>proof.range.toString()).join("\n");
    const proofComplete=!required.length||evidenceConditionsMatch(required,proofText)&&evidenceConditionDescriptionMatches(meaningTerms(evidenceConditionDescription(claim??"")),meaningTerms(proofText));
    const items = point?.listedItems ?? (claim ? listItems(claim) : []);
    const savedRanges = matchedProofs.filter(proof => proof.highlight.kind === "quote").map(proof => proof.range);
    const sourceLists = required.length ? [] : namedSourceLists(root, [items, ...evidenceListGroups(claim ?? "")], savedRanges);
    const proofs = proofComplete ? matchedProofs.filter(proof => !sourceLists.some(source => source.overlaps(proof.range))) : [];
    const derivedFrom=quote?quoteFits?[claim,quote]:[claim]:claim?[claim]:[current.excerpt,...sourceClaims.flatMap(item=>[item.text,item.quote])];
    const itemMarks = sourceLists.length ? sourceLists.flatMap(source => source.exact) : listItemRanges(root, items);
    const similar = sourceLists.length ? sourceLists.flatMap(source => source.similar) : (proofs.length || items.length && itemMarks.length === items.length
      ? [] : derivedSentenceRanges(root, derivedFrom, Math.max(3, items.length)));
    const directLocated=proofs.length||similar.length||itemMarks.length;
    // Also highlight a linked confirming reply in the same exchange (e.g. AI proposes -> User confirms).
    const linkedNeighbourIds = new Set((references ?? []).filter(ref => ref.conversationId === target.conversationId && ref.messageId !== target.id && ref.messageId !== target.platformMessageId).map(ref => ref.messageId));
    const support = neighbouringRoots.flatMap(element => {
      const msgId = element.dataset.sourceContent ?? "";
      const msg = turn.find(item => item.id === msgId);
      if (msg && (linkedNeighbourIds.has(msg.id) || msg.platformMessageId && linkedNeighbourIds.has(msg.platformMessageId)) && msg.content.trim().length <= 240) {
        const whole = evidenceTextRange(element, msg.content.trim());
        if (whole) return [whole];
      }
      return claim ? similarSentenceRanges(element,[claim],directLocated ? 1 : 2,"strict",false) : [];
    });
    const cueText=mode==="view"?undefined:point?.attention?.subject??point?.attention?.cue;
    const cue=cueText&&contentRoot.current?evidenceTextLocator(contentRoot.current)(cueText):undefined;
    const ranges=[...(cue?[cue]:[]),...proofs.map(proof=>proof.range),...itemMarks,...similar,...support];
    setConditionMissing(!proofs.length&&!similar.length&&!itemMarks.length&&required.length>0);
    const titles=new Map<HTMLElement,string>();
    for(const proof of proofs){const element=proof.range.startContainer.parentElement?.closest<HTMLElement>("[data-reader-source-start]");if(!element)continue;if(!titles.has(element))titles.set(element,element.title);const record=sourceClaims[proof.highlight.claimIndex??-1];element.title=proof.highlight.kind==="related"?(zh?"相关段落（未核对）":"Related passage (unverified)"):record?`${(proof.highlight.claimIndex??0)+1}. ${record.text}`:claim??"";}
    const range=!claim&&quoteFits?evidenceTextRange(root,excerpt):undefined;
    // Focus the primary quote proof for this claim first; fall back to topmost item/similar range.
    const primaryQuoteRanges = proofs.filter(proof=>proof.highlight.kind==="quote"&&root.contains(proof.range.startContainer)).map(proof=>proof.range);
    const quoted = primaryQuoteRanges.length ? primaryQuoteRanges : [...itemMarks, ...similar];
    const topmost=quoted.reduce<Range|undefined>((first,item)=>!first||item.compareBoundaryPoints(Range.START_TO_START,first)<0?item:first,undefined);
    const focusedRange=cue??topmost??similar[0]??proofs[0]?.range??support[0];
    host.toggleAttribute("data-related-focus", Boolean(!cue && !directLocated && support.length));
    let interrupted=manualPosition.current===positionKey,frame=0,settling=true;
    const settled=setTimeout(()=>{settling=false;},500);
    const geometry=()=>{
      const bounds=host.getBoundingClientRect();
      if(ranges.length&&!(typeof Highlight!=="undefined"&&globalThis.CSS?.highlights))setHighlights([...proofs.map(proof=>({range:proof.range,kind:proof.highlight.kind})),...[...itemMarks,...(cue?[cue]:[])].map(range=>({range,kind:"quote" as const})),...similar.map(range=>({range,kind:"related" as const})),...support.map(range=>({range,kind:"support" as const}))].flatMap(proof=>Array.from(proof.range.getClientRects?.()??[]).map(item=>({top:item.top-bounds.top+host.scrollTop,left:item.left-bounds.left+host.scrollLeft,width:item.width,height:item.height,kind:proof.kind}))));
    };
    const position=()=>{
      if(interrupted){geometry();return;}
      // The cited words land a quarter of the way down, with the question above them still in reach; the question
      // itself only when no words are marked. The tail spacer is only as tall as that landing needs.
      const anchor=claim?root:turnAnchor.current??root;
      const proofRect=focusedRange?.getBoundingClientRect?.(),marked=Boolean(proofRect&&proofRect.height>0);
      const rect=marked?proofRect!:range?.getBoundingClientRect?.()??anchor.getBoundingClientRect(),bounds=host.getBoundingClientRect(),lead=marked?Math.round(host.clientHeight*.25):24;
      if(endSpacer.current){const below=endSpacer.current.getBoundingClientRect().top-rect.top;endSpacer.current.style.height=`${Math.max(0,host.clientHeight-lead-below-16)}px`;}
      if(rect.height)host.scrollTop=Math.max(0,host.scrollTop+rect.top-bounds.top-lead);
      geometry();
    };
    // Keep the question in view for nearby proof; reveal deep topic passages.
    // Settle initial layout briefly; user input immediately disables further automatic anchoring.
    const stop=()=>{interrupted=true;manualPosition.current=positionKey;};
    for(const event of ["wheel","touchstart","pointerdown","keydown"])host.addEventListener(event,stop,{passive:true});
    position();
    frame=requestAnimationFrame(()=>{if(!interrupted)position();});
    const observer=typeof ResizeObserver!=="undefined"?new ResizeObserver(()=>{if(settling&&!interrupted)position();else geometry();}):undefined;observer?.observe(contentRoot.current??root);observer?.observe(host);
    // Solid: the original's own words (quote, named items). Light with a dashed line: close in wording. Red: what was flagged.
    if(typeof Highlight!=="undefined"&&globalThis.CSS?.highlights){
      const groups:Array<[string,Range[]]>=[["atlas-original-proof",[...proofs.filter(proof=>proof.highlight.kind==="quote").map(proof=>proof.range),...itemMarks]],["atlas-original-context",proofs.filter(proof=>proof.highlight.kind==="context").map(proof=>proof.range)],["atlas-original-related",proofs.filter(proof=>proof.highlight.kind==="related").map(proof=>proof.range)],["atlas-original-similar",similar],["atlas-original-support",support],["atlas-original-cue",cue?[cue]:[]]];
      const nextRegistered=new Map<string,Highlight>();
      for(const [name,selected] of groups){
        if(!selected.length){
          const prev=registeredHighlights.current.get(name);
          if(prev&&CSS.highlights.get(name)===prev)CSS.highlights.delete(name);
          continue;
        }
        const highlight=new Highlight(...selected);
        highlight.priority=HIGHLIGHT_PRIORITY[name]??0;
        CSS.highlights.set(name,highlight);
        nextRegistered.set(name,highlight);
      }
      for(const [name,prev] of registeredHighlights.current){
        if(!nextRegistered.has(name)&&CSS.highlights.get(name)===prev)CSS.highlights.delete(name);
      }
      registeredHighlights.current=nextRegistered;
    }
    return()=>{host.removeAttribute("data-related-focus");cancelAnimationFrame(frame);clearTimeout(settled);for(const event of ["wheel","touchstart","pointerdown","keydown"])host.removeEventListener(event,stop);observer?.disconnect();for(const [element,title] of titles)element.title=title;};
  }, [loading, target, excerpt, quote, quoteFits, context, proofEntries, shown, sourceClaims, zh, claim, point, current.excerpt, renderRevision, positionKey, mode, turn, tableTarget, loaded?.key, revision, locatedStart, locatedEnd, references]);
  const {groups,currentGroup}=useMemo(()=>{
    const originals=new Map<string,ConversationMessage[]>();
    for(const ref of scopedReferences){
      const identity=evidenceSnapshotKey(session,ref);
      const key=JSON.stringify([session.id,ref.conversationId,evidenceVersion(session,ref),identity,
        session.sourceSignatures?.[ref.conversationId],session.sourceRoles?.[ref.conversationId],session.sourceMessageOrder?.[ref.conversationId]]);
      const source=cache.current.get(key);
      if(source)originals.set(identity,source);
    }
    const groups=evidenceReadingGroups(session,scopedReferences,originals);
    const direct=groups.findIndex(group=>group.references.some(ref=>ref.id===current.id));
    const currentGroup=direct>=0?direct:groups.findIndex(group=>group.key===evidenceReadingGroups(session,[current],originals)[0]?.key);
    return {groups,currentGroup};
  // Cache writes become visible after the loaded transcript or warning sources commit.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[scopedReferences,session,current,loaded,warningSources]);
  const available=groups.map(group=>group.reference);
  const sourceIndex=currentGroup;
  const unavailable=loading||Boolean(error)||loaded?.key!==revision||!target;
  const reading=useMemo(()=>evidenceReadingIdentity(session.id,evidenceSnapshotKey(session,current),current.messageId,excerpt,claim,turn),[session,current,excerpt,claim,turn]);
  // Seen is recorded by moving on or answering, never by a button of its own: only an original actually shown and
  // located counts. A failed save is no reason to stop the check.
  const markSeen=()=>{if(!unavailable&&!stale&&quoteFits&&located&&!example)void markEvidenceRead(reading,true).catch(()=>undefined);};
  const go=(index:number)=>{markSeen();onPoint?.(index);};
  const answer=(holder:Answer[0])=>{
    if(!point||!onHolder)return;
    // Rewriting is done in the text: the point stays to confirm until the sentence changes.
    if(holder==="edit"){markSeen();onEditClaim?.(point);return;}
    if(onHolder(point,holder)===false)return;
    const nextPoint=points&&pointIndex!==undefined&&(asking||mode==="check")
      ? mode==="check" ? points.findIndex((candidate,index)=>index!==pointIndex&&needsConfirmation(candidate)) : pointIndex+1
      : -1;
    if(nextPoint>=0&&nextPoint<(points?.length??0))go(nextPoint);else markSeen();
  };
  const checkMode=mode==="check";
  const roleName=(message:ConversationMessage|undefined)=>!message?"":message.role==="user"?pastedMaterial(message.content)?zh?"你粘贴的资料":"Pasted material":zh?"你的提问":"Your question":message.role==="assistant"?zh?"AI 回复":"AI reply":"";
  const totalCheck = checkMode ? points?.length ?? 0 : 0;
  const remaining=points?.filter(needsConfirmation).length??0;
  const reviewedCount = Math.max(0, totalCheck - remaining);
  const claimAnchorText = !tableTarget ? (point?.claim ?? claim)?.trim() : undefined;
  const skipToNext = () => {
    if (!points || pointIndex === undefined) return;
    const after = points.findIndex((candidate, idx) => idx > pointIndex && needsConfirmation(candidate));
    const wrap = points.findIndex((candidate, idx) => idx < pointIndex && needsConfirmation(candidate));
    const targetIdx = after >= 0 ? after : wrap;
    if (targetIdx >= 0) go(targetIdx);
  };
  const position=checkMode?remaining?(zh?`待核对 ${reviewedCount + 1} / ${totalCheck}`:`Review ${reviewedCount + 1} of ${totalCheck}`):(zh?"本章已核对":"Chapter reviewed")
    :point&&points&&points.length>1?mode!=="view"&&remaining?zh?`待确认 ${pointIndex!+1} / ${points.length}`:`To confirm ${pointIndex!+1} / ${points.length}`:zh?`第 ${pointIndex!+1} / ${points.length} 处`:`${pointIndex!+1} of ${points.length}`:zh?"出处":"Source";
  return <aside ref={panel} className={`workspace-source-panel is-card${embedded ? " is-embedded" : overlay ? " is-overlay" : ""}${context ? " is-context" : ""}${checkMode ? " is-check-mode" : ""}`} role={embedded ? "region" : overlay ? "dialog" : "complementary"} aria-modal={!embedded&&overlay || undefined} aria-label={zh ? "原文依据" : "Original evidence"} onKeyDown={event => {
    if (event.key === "Escape") { event.stopPropagation(); onClose(); }
    if (event.altKey && point && points && points.length > 1 && onPoint && pointIndex !== undefined) {
      if (event.key === "ArrowLeft" && pointIndex > 0) { event.preventDefault(); go(pointIndex - 1); }
      else if (event.key === "ArrowRight" && pointIndex < points.length - 1) { event.preventDefault(); go(pointIndex + 1); }
    }
    if (!embedded && overlay && event.key === "Tab") { const nodes = Array.from(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled),select:not(:disabled),[tabindex="0"]') ?? []); const first = nodes[0], last = nodes.at(-1); if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); } }
  }}><WorkspacePaneResize enabled={!embedded&&!overlay} zh={zh}/>
    {onToolsHost ? <div className="wiki-source-dock" ref={onToolsHost}/> : null}
    <header className="workspace-source-card-head">
      <div className="workspace-source-switch" role="group" aria-label={zh?"原文范围":"How much of the original"}>
        <button type="button" aria-pressed={!context} onClick={()=>setContext(false)}>{sectionId||tableTarget?(zh?"来源":"Source"):(zh?"原话":"Quote")}</button>
        <button type="button" aria-pressed={context} disabled={unavailable} onClick={()=>{if(!context){setContextExtra(undefined);setContext(true);}}}>{zh?"前后文":"Context"}</button>
      </div>
      <div className="workspace-source-tools">
        {point&&points&&points.length>1&&onPoint?<nav className="workspace-source-points" aria-label={zh?"结论导航":"Claim navigation"}><button type="button" disabled={pointIndex===0} aria-label={zh?"上一处依据":"Previous claim"} title={zh?"上一处":"Previous"} onClick={()=>go(pointIndex!-1)}><ChevronLeft size={16} aria-hidden="true"/></button><button type="button" disabled={pointIndex===points.length-1} aria-label={zh?"下一处依据":"Next claim"} title={zh?"下一处":"Next"} onClick={()=>go(pointIndex!+1)}><ChevronRight size={16} aria-hidden="true"/></button></nav>:null}
        {onReader?<button type="button" className="workspace-source-reader" disabled={unavailable} aria-label={zh?"在阅读器中打开整段对话":"Open the conversation in the reader"} title={zh?"在阅读器中打开整段对话":"Open the conversation in the reader"} onClick={onReader}><ArrowUpRight size={16} aria-hidden="true"/></button>:null}
        <button className="workspace-source-close" type="button" aria-label={returnLabel||(zh ? "关闭原文面板" : "Close original evidence")} title={returnLabel||(zh?"关闭":"Close")} onClick={onClose}>{returnLabel?<><ArrowLeft size={16} aria-hidden="true"/><span>{returnLabel}</span></>:<X size={17} aria-hidden="true" />}</button>
      </div>
    </header>
    {checkMode && totalCheck > 0 ? <div className="workspace-source-check-progress" aria-hidden="true"><span style={{ width: `${Math.round((reviewedCount / totalCheck) * 100)}%` }} /></div> : null}
    <div className="workspace-source-rule"><span aria-live="polite">{position}</span>{point?.label&&!checking?<span className={`workspace-source-kind is-${point.source}${point.approximate?" is-approximate":""}`}>{point.label}</span>:null}{target&&!loading?<span className="workspace-source-rule-role">{roleName(target)}</span>:null}
      {available.length > 1 && sourceIndex >= 0 ? <nav className="workspace-source-navigation" aria-label={zh ? "依据消息导航" : "Evidence navigation"}><button type="button" disabled={loading || sourceIndex === 0} aria-label={zh ? "上一条依据" : "Previous evidence"} onClick={() => onSelect(available[sourceIndex - 1])}><ChevronLeft size={14} aria-hidden="true"/></button><span>{point ? zh ? "原话" : "Original" : zh ? "原文" : "Original"} {sourceIndex + 1} / {available.length}</span><button type="button" disabled={loading || sourceIndex === available.length - 1} aria-label={zh ? "下一条依据" : "Next evidence"} onClick={() => onSelect(available[sourceIndex + 1])}><ChevronRight size={14} aria-hidden="true"/></button></nav> : null}
    </div>
    {claimAnchorText ? <button type="button" className={`workspace-source-claim-anchor${claimExpanded ? " is-expanded" : ""}`} onClick={() => setClaimExpanded(value => !value)} title={claimExpanded ? (zh ? "点击收起" : "Collapse") : (zh ? "点击展开完整结论" : "Expand full claim")}>
      <small>{checkMode ? (zh ? "核对结论" : "Reviewing") : (zh ? "对应结论" : "Claim")}</small>
      <span>{claimAnchorText}</span>
    </button> : null}
    {showSourceTitle && <p className="workspace-source-title">{current.title}</p>}
    {checkMode&&!remaining?<div className="workspace-source-check-done" role="status">
      <CheckCircle2 size={16} aria-hidden="true"/>
      <div><strong>{zh ? "本章核对完成" : "Chapter reviewed"}</strong><small>{zh ? "已同步至项目决策与续聊上下文" : "Synced to project decisions and continuation context"}</small></div>
      {next?<button type="button" className="workspace-source-next-chapter" onClick={next.onNext}>{next.label}</button>:null}
    </div>:null}
    {point?.attention&&!checking?<p className="workspace-source-attention">{evidenceAttentionText(point.attention,zh)}</p>:null}
    {point?.source === "decision" && available.length > 1 ? <p className="workspace-source-point-note">{zh ? "包含 AI 的提议和你的确认，用“原话”箭头切换。" : "Includes the AI proposal and your confirmation; switch with the Original arrows."}</p> : null}
    {!point&&!loading&&!stale&&target?sourceClaims.filter(item=>!explicitQuote||item.quote===explicitQuote).flatMap((item,index)=>evidenceRoleWarnings(item,roleMessages,scopedReferences).filter(warning=>warning!=="assistant-decision").map(warning=><p key={`${index}-${warning}`} className="workspace-source-notice">{item.text}: {warning==="pasted-ai"?zh?"引文是用户粘贴的 AI 内容，不能单独证明已采纳":"The user pasted AI content; this alone does not establish adoption":zh?"依据是计划或建议，不能证明已完成":"The evidence is a plan or suggestion; it does not establish completion"}</p>)):null}
    {!point&&!loading&&hasRelatedProofs?<p className="workspace-source-related-label">{zh?"相关段落（未核对）":"Related passages (unverified)"}</p>:null}
    {conditionMissing&&!loading?<p className="workspace-source-related-label">{zh?"未找到同时对应数字条件和描述的原文，请结合上下文核对。":"No passage matching both the numeric condition and description was found; check the surrounding context."}</p>:null}
    <div ref={body} className="workspace-source-body" tabIndex={0} aria-busy={loading} onScroll={() => {
      if (!context || !body.current || !targetBody.current) { if (scrolledAway) setScrolledAway(false); return; }
      const hostRect = body.current.getBoundingClientRect(), targetRect = targetBody.current.getBoundingClientRect();
      const outOfView = targetRect.bottom < hostRect.top + 30 || targetRect.top > hostRect.bottom - 30;
      if (outOfView !== scrolledAway) setScrolledAway(outOfView);
    }}>{highlights.map(({kind,...rect},index)=><span key={index} className={`workspace-source-highlight is-${kind}`} aria-hidden="true" style={rect}/>)}
      <div ref={contentRoot} className="workspace-source-content">{readerError && !loading && !error ? <p className="workspace-source-notice" role="alert">{readerError}</p>:null}
      {context && target && contextStart > 0 ? <button className="workspace-context-more" type="button" onClick={() => extendContext("before")}>{zh ? "展开更早的消息" : "Show earlier messages"}</button> : null}
      {loading && !loaded ? <p role="status">{zh ? "读取原始消息…" : "Loading original messages…"}</p> : error ? <div role="alert"><p>{error}</p><button type="button" onClick={()=>{cache.current.delete(revision);setRetry(value=>value+1);}}>{zh?"重新读取":"Retry loading"}</button></div> : !target ? <div className="workspace-source-unavailable"><strong>{zh ? "来源待定位" : "Source unavailable"}</strong><p>{zh ? "当前无法读取对应原始消息。以下仅为已保存的历史摘录。" : "The original message is unavailable. Only the saved historical excerpt follows."}</p><SourceMessageContent content={reference.excerpt} zh={zh} /></div> : <>
        {stale ? <p className="workspace-source-notice">{zh ? "来源版本与引用已有变化，请核对；不视为当前结论的有效证明。" : "Source version differs from this citation; review before relying on it."}</p> : null}
        {tableTarget ? !loading&&missingTable===positionKey?<p className="workspace-source-notice">{zh?"该消息中未能唯一定位原始表格，已打开来源消息。":"Could not uniquely locate the original table. Its source message is open."}</p>:null
          : stale?null:explicitQuote&&!wikiQuoteRange(target.content,explicitQuote)?<p className="workspace-source-notice">{zh?"该来源中未定位到此结论的引文":"This claim’s quotation was not located in this source"}</p>:!located?<p className="workspace-source-notice">{zh?"当前原文中未匹配到该引用片段，请核对消息。":"This quote was not found in the original message."}</p>:null}
        {shown.map((message, idx) => { const msgIndex = context ? contextStart + idx + 1 : undefined; const isTarget = message.id === target.id; const date = message.createdAt && Number.isFinite(message.createdAt) && message.createdAt > 946684800000 ? message.createdAt : undefined; return <section key={message.id} ref={message.id===turn[0]?.id?turnAnchor:undefined} data-message-id={message.id} className={`workspace-source-message${message.role === "user" ? " is-user-message" : " is-ai-message"}${isTarget ? " is-source-target" : ""}`}><div className="workspace-source-message-meta"><strong>{message.role === "user" ? pastedMaterial(message.content) ? zh ? "你粘贴的资料" : "Pasted material" : zh ? "用户" : "User" : message.role === "assistant" ? zh ? "AI 回复" : "AI reply" : message.role === "system" ? zh ? "系统" : "System" : message.role === "tool" ? zh ? "工具" : "Tool" : message.role}</strong>{msgIndex ? <span className="workspace-source-turn-index">#{msgIndex}</span> : null}{context && isTarget ? <span className="workspace-source-target-badge">{zh ? "当前引用" : "Cited"}</span> : null}{date ? <time dateTime={new Date(date).toISOString()}>{new Date(date).toLocaleString(zh ? "zh-CN" : "en")}</time> : null}</div><div data-source-content={message.id} ref={isTarget ? targetBody : undefined}><SourceMessageContent locatable message={message} zh={zh} /></div></section>; })}
      </>}
      {context && target && contextEnd < messages.length ? <button className="workspace-context-more" type="button" onClick={() => extendContext("after")}>{zh ? "展开后续的消息" : "Show later messages"}</button> : null}
    </div><div ref={endSpacer} className="workspace-source-tail" aria-hidden="true"/>
    {context && scrolledAway ? <button type="button" className="workspace-source-back-to-quote" onClick={scrollBackToTarget}><ArrowUp size={13} aria-hidden="true"/><span>{zh ? "回到原话" : "Back to quote"}</span></button> : null}
    </div>{loading && loaded ? <p className="workspace-source-pending" role="status">{zh?"正在切换原文…":"Loading next source…"}</p>:null}
    {point&&onHolder?<div className={`workspace-source-ask${asking?" is-asking":""}`}><HolderQuestion point={point} zh={zh} asked={asking} canEdit={Boolean(onEditClaim)} originalLocated={originalLocated} onAnswer={answer} onSkip={checkMode && remaining > 1 ? skipToNext : undefined}/></div>:null}
  </aside>;
}
/** A scope claim marks its items in the original: the legend then explains the solid marks. */

