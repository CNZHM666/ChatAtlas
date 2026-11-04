import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { wikiHolderTitle, type WikiHolder } from "../../shared/wiki-holder";
import { ArrowLeft, ArrowUpRight, BookOpen, ChevronLeft, ChevronRight, X } from "lucide-react";
import type { ConversationMessage } from "../../shared/types";
import type { FocusEvidence, FocusSession } from "../../shared/focus-session";
import { readSessionSource } from "../../storage/source-versions";
import { sourceMessageSignature } from "../../shared/source-signature";
import { messageTurn } from "../../shared/message-turns";
import { wikiQuoteRange } from "../../shared/wiki-claims";
import { sourceQuoteText } from "../../shared/source-quote-text";
import { pastedMaterial } from "../../shared/source-text-display";
import { evidenceAttentionText, type EvidenceAttention } from "../../shared/claim-meaning";
import { derivedSentenceRanges, meaningTerms } from "../claim-highlight";
import { narrowQuote } from "../narrow-quote";
import { evidenceConditionDescription, evidenceConditionDescriptionMatches, evidenceConditions, evidenceConditionsMatch } from "../evidence-conditions";
import { ProjectExampleContext } from "../project-example-context";
import { SourceMessageContent } from "./SourceMessageContent";
import { WorkspacePaneResize } from "./WorkspacePaneResize";
import { chapterEvidence, evidenceSnapshotKey, evidenceVersion, evidenceReadingGroups,ambiguousEvidenceVersion } from "../../shared/evidence-identity";
import { invalidateMessageReadCache } from "../../storage/message-read-cache";
import "../workspace-source-panel.css";
import { originalEvidenceHighlights, originalEvidenceClaims, evidenceRoleWarnings, type EvidenceHighlight } from "../../shared/original-evidence-highlights";
import { projectKnowledgeView } from "../../shared/project-knowledge-view";
import { evidenceTextRange, evidenceSourceRanges } from "../evidence-highlight";
import { needsConfirmation, type EvidencePoint } from "../workspace-evidence-context";
import {evidenceReadingIdentity,markEvidenceRead} from "../../storage/evidence-reading";
const noMessages:ConversationMessage[]=[];

// Component markup (<box>, <text>) is read through, not as one block of HTML with no words.
const visibleTerms=(text:string)=>meaningTerms(sourceQuoteText(text.replace(/<[^>]*>/gu," ")));
const overlap=(own:Set<string>,theirs:Set<string>)=>{let shared=0;for(const term of own)if(theirs.has(term))shared++;return {shared,cover:shared/Math.max(1,Math.min(own.size,theirs.size))};};
/** Whether a saved quote can be trusted to show where its claim comes from. It cannot when it shares almost nothing
 * with the claim while another sentence of the original plainly states it: a quote cut from the example under the
 * heading that makes the point. A quote in another language than its claim shares little, and with no such sentence
 * it is still the best guide. */
function quoteSupports(claim:string,quote:string,content:string){
  const conditions=evidenceConditions(claim);
  if(!evidenceConditionsMatch(conditions,sourceQuoteText(quote)))return false;
  if(conditions.length&&!evidenceConditionDescriptionMatches(meaningTerms(evidenceConditionDescription(claim)),visibleTerms(quote)))return false;
  const own=meaningTerms(claim),theirs=visibleTerms(quote);
  if(own.size<3)return true;
  const fit=overlap(own,theirs);
  if(fit.shared>=3&&fit.cover>=QUOTE_FIT)return true;
  if(content.split(/(?<=[。！？!?；;])|\n/u).some(sentence=>{const near=overlap(own,visibleTerms(sentence));return near.cover>=CLAIM_SENTENCE.cover&&near.shared>=CLAIM_SENTENCE.shared;}))return false;
  // A numbered code list/vertical flow may state the claim only across lines.
  // Do not keep an unrelated saved quote just because no single line is long.
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
const QUOTE_FIT=.25,CLAIM_SENTENCE={cover:.6,shared:3};
/** Reads the same retained originals as Reader; never generates source text or dates. */
/** The status a reader answers about: the user's own words and material count as not decided, like the AI's. */
const shownHolder = (holder: WikiHolder | undefined): WikiHolder | undefined => holder === "user" || holder === "material" ? "ai" : holder;
const ANSWERS: Array<[WikiHolder, string, string]> = [["decided", "已定", "Decided"], ["open", "未定", "Open"], ["earlier", "旧方案", "Earlier"], ["ai", "AI 建议", "AI suggestion"]];
type Question = { ask: [string, string]; why?: [string, string]; answers: Array<[WikiHolder, string, string]> };
/** Why a point was flagged, in a few words under its question. */
const WHY: Partial<Record<EvidenceAttention["kind"], [string, string]>> = {
  missing: ["没找到引用的原话", "The quoted words were not found"],
  negation: ["原话里有否定，结论里没有", "The quote says not to; the claim does not"],
  tentative: ["原话只是在考虑，结论写得更肯定", "The quote only considers it; the claim is firmer"],
  approximate: ["原文是按措辞匹配到的", "Matched to the original by wording"],
  partial: ["AI 核对：原文只支持一部分", "AI check: the original supports only part"],
  unsupported: ["AI 核对：原文不支持这句", "AI check: the original does not support it"],
};
/** The one question a point is flagged for, with two answers; each answer is the status the sentence keeps. Written
 * as decided with no confirmation: is it your decision? Still open: is it settled now? Any other flag: does the
 * sentence say what the original says? Saying it does not keeps it as it is; saying it does not marks it 未定. */
function questionOf(point: EvidencePoint): Question {
  const keep = point.holder ?? "ai";
  if (point.attention?.kind === "settled") return { ask: ["这句是你的决定吗？", "Is this your decision?"], answers: [["decided", "是", "Yes"], ["ai", "不是", "No"]] };
  if (!point.attention && point.holder === "open") return { ask: ["这件事定了吗？", "Is this settled now?"], answers: [["decided", "定了", "Settled"], ["open", "还没定", "Not yet"]] };
  return { ask: ["这句和原话意思一致吗？", "Does this say what the original says?"], ...(point.attention && WHY[point.attention.kind] ? { why: WHY[point.attention.kind] } : {}), answers: [[keep, "一致", "Yes"], ["open", "不一致", "No"]] };
}
/** A point to confirm asks its one question. Any other shows the status it keeps (recorded, once answered) behind a
 * link, which asks the same two-answer question again, with the two remaining statuses as quiet extras. */
function HolderQuestion({ point, zh, asked, onAnswer }: { point: EvidencePoint; zh: boolean; asked: boolean; onAnswer: (holder: WikiHolder) => void }) {
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [point.key]);
  const l = ([cn, en]: [string, string]) => zh ? cn : en;
  const current = shownHolder(point.holder), named = ANSWERS.find(([holder]) => holder === current);
  if (!asked && !open) return <p className="workspace-source-holder-done">{point.checked ? zh ? "已记录：" : "Recorded: " : zh ? "状态：" : "Status: "}<b>{named ? zh ? named[1] : named[2] : ""}</b>
    <button type="button" className="workspace-source-holder-change" onClick={() => setOpen(true)}>{zh ? "改" : "Change"}</button></p>;
  const question = questionOf(point), offered = new Set(question.answers.map(([holder]) => holder));
  const others = asked ? [] : ANSWERS.filter(([holder]) => !offered.has(holder));
  return <div className="workspace-source-holder" role="group" aria-label={l(question.ask)}><span>{l(question.ask)}{question.why ? <small>{l(question.why)}</small> : null}</span>
    <div>{question.answers.map(([holder, cn, en]) => <button key={cn} type="button" aria-pressed={!asked && current === holder || undefined} className={`is-holder-${holder}`} onClick={() => onAnswer(holder)}>{zh ? cn : en}</button>)}
      {others.map(([holder, cn, en]) => <button key={holder} type="button" aria-pressed={current === holder} className={`is-holder-${holder} is-quiet`} title={wikiHolderTitle(holder, zh)} onClick={() => onAnswer(holder)}>{zh ? cn : en}</button>)}</div></div>;
}
export function WorkspaceSourcePanel({ session, reference, references, onSelect, claim, quote: savedQuote, sectionId, readerError, zh, onClose, onReader, embedded=false, returnLabel, points, pointIndex, onPoint, onHolder, next }: {
  session: FocusSession; reference: FocusEvidence; references?: FocusEvidence[]; claim?: string; quote?: string; conversationTitle?: string; zh: boolean;
  onSelect: (ref: FocusEvidence) => void; onClose: () => void; onReader?: () => void; embedded?:boolean; returnLabel?:string;
  readerError?: string; sectionId?:string;
  /** Point-by-point mode: step through claims; references are only this point's originals. */
  points?: EvidencePoint[]; pointIndex?: number; onPoint?: (index: number) => void;
  /** Switches the status the sentence is marked with: a wrong status is a wrong mark, fixed here, not by editing prose. */
  onHolder?: (point: EvidencePoint, holder: WikiHolder) => void;
  /** A workspace check going on past this chapter: shown at its last point, it moves on to the next chapter to check. */
  next?: { label: string; onNext: () => void };
}) {
  const point = points && pointIndex !== undefined ? points[pointIndex] : undefined;
  const quote = useMemo(() => savedQuote && claim ? narrowQuote(claim, savedQuote) : savedQuote, [claim, savedQuote]);
  // Asking: the question says what is wrong, so the kind chip, the flag banner and the no-literal-match line go.
  const asking = Boolean(point && point.holder && onHolder && needsConfirmation(point));
  // Checking at all: the question or the recorded status says it, so none of them shows, an answered point included.
  const checking = Boolean(point && point.holder && onHolder);
  const example = useContext(ProjectExampleContext);
  const [loaded, setLoaded] = useState<{key:string;messages:ConversationMessage[];reference:FocusEvidence}>(), [loading, setLoading] = useState(true), [error, setError] = useState(""), [context, setContext] = useState(false);
  const cache=useRef(new Map<string,ConversationMessage[]>());
  const [highlights,setHighlights]=useState<Array<{top:number;left:number;width:number;height:number;kind:EvidenceHighlight["kind"]}>>([]),[retry,setRetry]=useState(0);
  const [overlay, setOverlay] = useState(() => window.matchMedia?.("(max-width:940px)").matches ?? false);
  const [similarShown,setSimilarShown]=useState(false);
  const [conditionMissing,setConditionMissing]=useState(false);
  const [renderRevision,setRenderRevision]=useState(0);
  const manualPosition=useRef("");
  const panel = useRef<HTMLElement>(null), body = useRef<HTMLDivElement>(null), targetBody = useRef<HTMLDivElement>(null), turnAnchor = useRef<HTMLElement>(null), contentRoot=useRef<HTMLDivElement>(null), endSpacer=useRef<HTMLDivElement>(null);
  const version=evidenceVersion(session,reference);
  const revision = JSON.stringify([session.id, reference.conversationId, version,evidenceSnapshotKey(session,reference), session.sourceSignatures?.[reference.conversationId],session.sourceRoles?.[reference.conversationId],session.sourceMessageOrder?.[reference.conversationId]]);
  // Keep the last committed source visible while another conversation loads. Never label it as the new proof.
  const committedReference=useRef(reference);
  if(loaded?.key===revision)committedReference.current=reference;
  const current=loaded?.key===revision?reference:committedReference.current;
  const messages=loaded?.messages??noMessages;
  useEffect(() => { const workspace = panel.current?.closest(".focus-workspace, .focus-preview"); if (!workspace) return; const update = () => setOverlay(workspace.getBoundingClientRect().width < 940); update(); if (typeof ResizeObserver === "undefined") return; const observer = new ResizeObserver(update); observer.observe(workspace); return () => observer.disconnect(); }, []);
  useEffect(() => {
    let alive = true; setError("");
    const cached=cache.current.get(revision);
    if(cached){setLoaded({key:revision,messages:cached,reference});setLoading(false);return;}
    setLoading(true);
    // Refresh live sources once on entry; message changes reuse the loaded snapshot.
    if(!example&&!version)invalidateMessageReadCache(reference.conversationId);
    const read = ambiguousEvidenceVersion(session,reference)?Promise.resolve([]):example ? Promise.resolve(example.knowledge(session).messages.filter(message => message.conversationId === reference.conversationId)) : readSessionSource(session, reference.conversationId, reference.messageId, version);
    void read.then(value => { if (alive) {cache.current.set(revision,value);while(cache.current.size>8)cache.current.delete(cache.current.keys().next().value!);setLoaded({key:revision,messages:value,reference});} }).catch(() => { if (alive) setError(zh ? "原文读取失败，请重试。" : "Could not load the original. Retry loading."); }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
    // Message selection in the same immutable source does not reread or remount it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revision, example, retry]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    if (overlay || embedded) panel.current?.querySelector<HTMLButtonElement>(".workspace-source-close")?.focus({ preventScroll: true });
    return () => { if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, [overlay,embedded]);
  useEffect(() => { if(embedded)return;const base = panel.current?.closest(".focus-workspace, .focus-preview")?.querySelector<HTMLElement>(".project-reading-base, .focus-preview-scroll"); if (!base) return; const previous = base.inert; base.inert = overlay || [...document.querySelectorAll(".ai-context-backdrop")].some(element=>!element.closest("[hidden]")); return () => { base.inert = previous; }; });
  const target = messages.find(message => message.id === current.messageId || message.platformMessageId === current.messageId);
  const excerpt = quote || current.excerpt;
  const located = target && wikiQuoteRange(target.content, excerpt);
  const stale = Boolean(target && current.sourceSignature && current.sourceSignature !== sourceMessageSignature(target.content));
  const section=sectionId?session.sections.find(item=>item.id===sectionId):undefined;
  const scopedReferences=useMemo(()=>sectionId ? section?chapterEvidence(session,section):[] : references??[reference],[sectionId,section,session,references,reference]);
  const sourceClaims=useMemo(()=>target?originalEvidenceClaims(session,current,target,{sectionId,references:scopedReferences}):[],[target,session,current,sectionId,scopedReferences]);
  // Every quote of the claims citing this original is marked; the claims themselves are highlighted in the document.
  // A saved quote that shares almost nothing with its claim points at the wrong passage (a component block below
  // the heading that says it): it is not marked or scrolled to; the sentences closest to the claim are, headings included.
  const quoteFits=useMemo(()=>!quote||!claim||!target||quoteSupports(claim,quote,target.content),[claim,quote,target]);
  const explicitQuote=quoteFits?quote:undefined;
  const [warningSources,setWarningSources]=useState<{key:string;messages:ConversationMessage[];complete:boolean}>();
  const warningKey=JSON.stringify([session.id,sourceClaims,scopedReferences,session.sourceVersionIds,session.sourceSignatures,session.sourceRoles]);
  useEffect(()=>{
    let alive=true;const ids=new Set(sourceClaims.flatMap(item=>item.evidenceIds));
    const refs=scopedReferences.filter(ref=>ids.has(ref.id)),unique=[...new Map(refs.map(ref=>[evidenceSnapshotKey(session,ref),ref])).values()];
    if(!unique.length)return;
    void Promise.all(unique.map(async ref=>{
      const resolved=evidenceVersion(session,ref),key=JSON.stringify([session.id,ref.conversationId,resolved,evidenceSnapshotKey(session,ref),session.sourceSignatures?.[ref.conversationId],session.sourceRoles?.[ref.conversationId],session.sourceMessageOrder?.[ref.conversationId]]);
      try{const value=cache.current.get(key)??(ambiguousEvidenceVersion(session,ref)?[]:example?example.knowledge(session).messages.filter(message=>message.conversationId===ref.conversationId):await readSessionSource(session,ref.conversationId,ref.messageId,resolved));if(alive)cache.current.set(key,value);return value;}catch{return undefined;}
    })).then(results=>{if(alive)setWarningSources({key:warningKey,messages:results.flatMap(value=>value??[]),complete:results.every(value=>value!==undefined)});});
    return()=>{alive=false;};
  // The serialized key binds all original versions and claim identities.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[warningKey,example]);
  const acceptedClaims=useMemo(()=>new Set(projectKnowledgeView(session).facts.filter(fact=>fact.adoption==="accepted").map(fact=>JSON.stringify([fact.claim.text,fact.claim.quote]))),[session]);
  const roleMessages=warningSources?.key===warningKey?warningSources.messages:messages;
  const roleSourcesComplete=warningSources?.key===warningKey&&warningSources.complete;
  // Point mode leads with the quoted passage; the whole message and conversation are opt-in.
  // Both ways in show the same thing: the whole question and reply, the cited words highlighted.
  const shown = useMemo(()=>context ? messages : target ? messageTurn(messages,target) : [],[context,messages,target]);
  const proofKey = useMemo(()=>JSON.stringify(shown.map(message=>{
    const refs=scopedReferences.filter(ref=>evidenceSnapshotKey(session,ref)===evidenceSnapshotKey(session,current)&&[message.id,message.platformMessageId].includes(ref.messageId));
    const selected=refs.some(ref=>ref.id===current.id)?current:refs[0];
    const marks=selected&&message.id===target?.id&&quoteFits?originalEvidenceHighlights(session,selected,message,explicitQuote,{sectionId,references:scopedReferences,focus:claim||section?.title}):[];
    return {id:message.id,marks};
  })),[shown,scopedReferences,session,current,explicitQuote,quoteFits,sectionId,section,claim,target]);
  useEffect(()=>{
    const root=contentRoot.current;if(loading||!root)return;
    let frame=0;
    // Lazy syntax highlighting and long-message formatting replace text nodes.
    // Rebuild ranges after that commit instead of retaining detached DOM ranges.
    const observer=new MutationObserver(()=>{if(!frame)frame=requestAnimationFrame(()=>{frame=0;setRenderRevision(value=>value+1);});});
    observer.observe(root,{childList:true,subtree:true,characterData:true});
    return()=>{observer.disconnect();cancelAnimationFrame(frame);};
  },[loading,target,context]);
  useEffect(() => {
    setHighlights([]);setConditionMissing(false);if(loading||!targetBody.current||!target)return;
    const root=targetBody.current,host=body.current;if(!host)return;
    const messageRoots=Array.from(contentRoot.current?.querySelectorAll<HTMLElement>("[data-source-content]")??[]);
    const matchedProofs = (JSON.parse(proofKey) as Array<{id:string;marks:EvidenceHighlight[]}>).flatMap(proof=>{const messageRoot=messageRoots.find(item=>item.dataset.sourceContent===proof.id),message=shown.find(item=>item.id===proof.id);return messageRoot&&message?evidenceSourceRanges(messageRoot,message.content,proof.marks):[];});
    const required=evidenceConditions(claim??""),proofText=matchedProofs.filter(proof=>proof.highlight.kind==="quote").map(proof=>proof.range.toString()).join("\n");
    const proofComplete=!required.length||evidenceConditionsMatch(required,proofText)&&evidenceConditionDescriptionMatches(meaningTerms(evidenceConditionDescription(claim??"")),meaningTerms(proofText));
    const proofs=proofComplete?matchedProofs:[];
    // No literal quote in this original (a paraphrase, a quote cut differently): its sentences closest in wording to the
    // claims are marked instead, so the reader still lands on the passage, labelled as close in meaning.
    // Matched against the conclusion, the quote it was written from and the other conclusions citing this original; the
    // cited message first, then the whole turn (a point drawn from the question rather than the reply).
    // A conclusion opened with its own quote never borrows another conclusion's words.
    const derivedFrom=quote?quoteFits?[claim,quote]:[claim]:claim?[claim]:[current.excerpt,...sourceClaims.flatMap(item=>[item.text,item.quote])];
    const similar=proofs.length?[]:(()=>{const own=derivedSentenceRanges(root,derivedFrom);return own.length||!contentRoot.current?own:derivedSentenceRanges(contentRoot.current,derivedFrom);})();
    setSimilarShown(similar.length>0);
    const ranges=[...proofs.map(proof=>proof.range),...similar];
    setConditionMissing(!ranges.length&&evidenceConditions(claim??"").length>0);
    const titles=new Map<HTMLElement,string>();
    for(const proof of proofs){const element=proof.range.startContainer.parentElement?.closest<HTMLElement>("[data-reader-source-start]");if(!element)continue;if(!titles.has(element))titles.set(element,element.title);const record=sourceClaims[proof.highlight.claimIndex??-1];element.title=proof.highlight.kind==="related"?(zh?"相关段落（未核对）":"Related passage (unverified)"):record?`${(proof.highlight.claimIndex??0)+1}. ${record.text}`:claim??"";}
    // A quote that does not state the claim is no place to scroll to.
    const range=quoteFits?evidenceTextRange(root,excerpt):undefined;
    const focusedRange=proofs.find(proof=>proof.highlight.kind==="quote"&&root.contains(proof.range.startContainer))?.range??ranges.find(item=>root.contains(item.startContainer))??ranges[0];
    const positionKey=JSON.stringify([revision,target.id,claim,quote]);
    let interrupted=manualPosition.current===positionKey,frame=0,settling=true;
    const settled=setTimeout(()=>{settling=false;},500);
    const geometry=()=>{
      const bounds=host.getBoundingClientRect();
      if(ranges.length&&!(typeof Highlight!=="undefined"&&globalThis.CSS?.highlights))setHighlights([...proofs.map(proof=>({range:proof.range,kind:proof.highlight.kind})),...similar.map(range=>({range,kind:"related" as const}))].flatMap(proof=>Array.from(proof.range.getClientRects?.()??[]).map(item=>({top:item.top-bounds.top+host.scrollTop,left:item.left-bounds.left+host.scrollLeft,width:item.width,height:item.height,kind:proof.kind}))));
    };
    const position=()=>{
      if(interrupted){geometry();return;}
      // The cited words land a quarter of the way down, with the question above them still in reach; the question
      // itself only when no words are marked. The tail spacer is only as tall as that landing needs.
      const anchor=turnAnchor.current??root;
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
    const registered=new Map<string,Highlight>();
    if(similar.length&&typeof Highlight!=="undefined"&&globalThis.CSS?.highlights){const highlight=new Highlight(...similar);CSS.highlights.set("atlas-original-proof",highlight);registered.set("atlas-original-proof",highlight);}
    if(typeof Highlight!=="undefined"&&globalThis.CSS?.highlights)for(const kind of ["quote","context","related"] as const){const selected=proofs.filter(proof=>proof.highlight.kind===kind);if(!selected.length)continue;const name=kind==="quote"?"atlas-original-proof":`atlas-original-${kind}`,highlight=new Highlight(...selected.map(proof=>proof.range));CSS.highlights.set(name,highlight);registered.set(name,highlight);}
    return()=>{cancelAnimationFrame(frame);clearTimeout(settled);for(const event of ["wheel","touchstart","pointerdown","keydown"])host.removeEventListener(event,stop);observer?.disconnect();for(const [name,highlight] of registered)if(CSS.highlights.get(name)===highlight)CSS.highlights.delete(name);for(const [element,title] of titles)element.title=title;};
  }, [loading, target, excerpt, quote, quoteFits, context, proofKey, shown, sourceClaims, zh, claim, point, current.excerpt, renderRevision, revision]);
  const originals=new Map<string,ConversationMessage[]>();
  for(const ref of scopedReferences){const resolved=evidenceVersion(session,ref);const key=JSON.stringify([session.id,ref.conversationId,resolved,evidenceSnapshotKey(session,ref),session.sourceSignatures?.[ref.conversationId],session.sourceRoles?.[ref.conversationId],session.sourceMessageOrder?.[ref.conversationId]]);const source=cache.current.get(key);if(source)originals.set(evidenceSnapshotKey(session,ref),source);}
  const groups=evidenceReadingGroups(session,scopedReferences,originals);
  const available=groups.map(group=>group.reference);
  const sourceIndex=groups.findIndex(group=>group.references.some(ref=>ref.id===current.id)||group.key===evidenceReadingGroups(session,[current],originals)[0]?.key);
  const unavailable=loading||Boolean(error)||loaded?.key!==revision||!target;
  const reading=useMemo(()=>evidenceReadingIdentity(session.id,evidenceSnapshotKey(session,current),current.messageId,excerpt,claim,target?messageTurn(messages,target):[]),[session,current,excerpt,claim,target,messages]);
  // Seen is recorded by moving on or answering, never by a button of its own: only an original actually shown and
  // located counts. A failed save is no reason to stop the check.
  const markSeen=()=>{if(!unavailable&&!stale&&quoteFits&&located&&!example)void markEvidenceRead(reading,true).catch(()=>undefined);};
  const go=(index:number)=>{markSeen();onPoint?.(index);};
  const answer=(holder:WikiHolder)=>{
    if(!point||!onHolder)return;
    // Every answer is recorded, the same status included: an answered point is not asked about again.
    onHolder(point,holder);
    // Answered: the next point that needs an answer follows.
    if(points&&pointIndex!==undefined&&pointIndex<points.length-1)go(pointIndex+1);else markSeen();
  };
  return <aside ref={panel} className={`workspace-source-panel${embedded ? " is-embedded" : overlay ? " is-overlay" : ""}${context ? " is-context" : ""}`} role={embedded ? "region" : overlay ? "dialog" : "complementary"} aria-modal={!embedded&&overlay || undefined} aria-label={zh ? "原文依据" : "Original evidence"} onKeyDown={event => {
    if (event.key === "Escape") { event.stopPropagation(); onClose(); }
    if (!embedded && overlay && event.key === "Tab") { const nodes = Array.from(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled),select:not(:disabled),[tabindex="0"]') ?? []); const first = nodes[0], last = nodes.at(-1); if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); } }
  }}><WorkspacePaneResize enabled={!embedded&&!overlay} zh={zh}/><header className={point?"is-point":"is-point is-message"}>{point?<div className="workspace-source-point-head">
      <div className="workspace-source-point-row">{point.label&&!checking?<span className={`workspace-source-kind is-${point.source}${point.approximate?" is-approximate":""}`}>{point.label}</span>:null}{points&&points.length>1&&onPoint?<nav className="workspace-source-points" aria-label={zh?"结论导航":"Claim navigation"}><button type="button" disabled={pointIndex===0} aria-label={zh?"上一处依据":"Previous claim"} onClick={()=>go(pointIndex!-1)}><ChevronLeft size={16} aria-hidden="true"/></button><span aria-live="polite">{points.some(item=>item.attention||item.holder==="open")?zh?`待确认 ${pointIndex!+1} / ${points.length}`:`To confirm ${pointIndex!+1} / ${points.length}`:zh?`第 ${pointIndex!+1} / ${points.length} 处`:`${pointIndex!+1} of ${points.length}`}</span><button type="button" disabled={pointIndex===points.length-1} aria-label={zh?"下一处依据":"Next claim"} onClick={()=>go(pointIndex!+1)}><ChevronRight size={16} aria-hidden="true"/></button></nav>:null}</div>
      {!point.placed&&!(similarShown&&!loading)&&!checking?<small className="workspace-source-origin">{zh?"正文中没有逐字对应的位置":"No literal position in the prose"}</small>:null}
    </div>:<div className="workspace-source-point-head"><div className="workspace-source-point-row">{available.length > 1 && sourceIndex >= 0 ? <nav className="workspace-source-points" aria-label={zh ? "依据消息导航" : "Evidence navigation"}><button type="button" disabled={loading || sourceIndex === 0} aria-label={zh ? "上一条依据" : "Previous evidence"} onClick={() => onSelect(available[sourceIndex - 1])}><ChevronLeft size={16} aria-hidden="true"/></button><span aria-live="polite">{point ? zh ? "原话" : "Original" : zh ? "原文" : "Original"} {sourceIndex + 1} / {available.length}</span><button type="button" disabled={loading || sourceIndex === available.length - 1} aria-label={zh ? "下一条依据" : "Next evidence"} onClick={() => onSelect(available[sourceIndex + 1])}><ChevronRight size={16} aria-hidden="true"/></button></nav> : <span className="workspace-source-single">{zh ? "原文" : "Original"}</span>}</div></div>}<button className="workspace-source-close" type="button" aria-label={returnLabel||(zh ? "关闭原文面板" : "Close original evidence")} onClick={onClose}>{returnLabel?<><ArrowLeft size={16} aria-hidden="true"/><span>{returnLabel}</span></>:<X size={19} aria-hidden="true" />}</button></header>
    {next&&point&&points&&pointIndex===points.length-1?<button type="button" className="workspace-source-next-chapter" onClick={next.onNext}>{next.label}</button>:null}
    {point?.attention&&!checking?<p className="workspace-source-attention">{evidenceAttentionText(point.attention,zh)}</p>:null}
    {point?.holder&&onHolder?<HolderQuestion point={point} zh={zh} asked={asking} onAnswer={answer}/>:null}
    {point && available.length > 1 && sourceIndex >= 0 ? <nav className="workspace-source-navigation" aria-label={zh ? "依据消息导航" : "Evidence navigation"}><button type="button" disabled={loading || sourceIndex === 0} aria-label={zh ? "上一条依据" : "Previous evidence"} onClick={() => onSelect(available[sourceIndex - 1])}><ChevronLeft size={16} aria-hidden="true"/></button><span aria-live="polite">{point ? zh ? "原话" : "Original" : zh ? "原文" : "Original"} {sourceIndex + 1} / {available.length}</span><button type="button" disabled={loading || sourceIndex === available.length - 1} aria-label={zh ? "下一条依据" : "Next evidence"} onClick={() => onSelect(available[sourceIndex + 1])}><ChevronRight size={16} aria-hidden="true"/></button></nav> : null}
    
    {point?.source === "decision" && available.length > 1 ? <p className="workspace-source-point-note">{zh ? "包含 AI 的提议和你的确认，用“原话”箭头切换。" : "Includes the AI proposal and your confirmation; switch with the Original arrows."}</p> : null}
    
    {!point&&!loading&&!stale&&target?sourceClaims.filter(item=>!explicitQuote||item.quote===explicitQuote).flatMap((item,index)=>evidenceRoleWarnings(item,roleMessages,scopedReferences,acceptedClaims.has(JSON.stringify([item.text,item.quote]))).filter(warning=>warning!=="assistant-decision"||roleSourcesComplete).map(warning=><p key={`${index}-${warning}`} className="workspace-source-notice">{item.text}: {warning==="assistant-decision"?zh?"引文来自助手消息，可能是建议而非用户决定":"The quotation comes from an assistant message; it may be advice rather than a user decision":warning==="pasted-ai"?zh?"引文是用户粘贴的 AI 内容，不能单独证明已采纳":"The user pasted AI content; this alone does not establish adoption":zh?"依据是计划或建议，不能证明已完成":"The evidence is a plan or suggestion; it does not establish completion"}</p>)):null}
    {!point&&!loading&&(JSON.parse(proofKey) as Array<{marks:EvidenceHighlight[]}>).some(proof=>proof.marks.some(mark=>mark.kind==="related"))?<p className="workspace-source-related-label">{zh?"相关段落（未核对）":"Related passages (unverified)"}</p>:null}
    {/* One line for both sides lacking a literal match: three notices stacked read as three problems. */}
    {conditionMissing&&!loading?<p className="workspace-source-related-label">{zh?"未找到同时对应数字条件和描述的原文，请结合上下文核对。":"No passage matching both the numeric condition and description was found; check the surrounding context."}</p>:similarShown&&!loading?<p className="workspace-source-related-label">{zh?"按措辞找到的相近原文，请核对对应关系":"Similar wording is highlighted; confirm it matches this claim"}</p>:null}
    <div ref={body} className="workspace-source-body" tabIndex={0} aria-busy={loading}>{highlights.map(({kind,...rect},index)=><span key={index} className={`workspace-source-highlight is-${kind}`} aria-hidden="true" style={rect}/>)}
      <div ref={contentRoot} className="workspace-source-content">{readerError && !loading && !error ? <p className="workspace-source-notice" role="alert">{readerError}</p>:null}
      {loading && !loaded ? <p role="status">{zh ? "读取原始消息…" : "Loading original messages…"}</p> : error ? <div role="alert"><p>{error}</p><button type="button" onClick={()=>{cache.current.delete(revision);setRetry(value=>value+1);}}>{zh?"重新读取":"Retry loading"}</button></div> : !target ? <div className="workspace-source-unavailable"><strong>{zh ? "来源待定位" : "Source unavailable"}</strong><p>{zh ? "当前无法读取对应原始消息。以下仅为已保存的历史摘录。" : "The original message is unavailable. Only the saved historical excerpt follows."}</p><SourceMessageContent content={reference.excerpt} zh={zh} /></div> : <>
        {stale ? <p className="workspace-source-notice">{zh ? "来源版本与引用已有变化，请核对；不视为当前结论的有效证明。" : "Source version differs from this citation; review before relying on it."}</p> : explicitQuote&&!wikiQuoteRange(target.content,explicitQuote)?<p className="workspace-source-notice">{zh?"该来源中未定位到此结论的引文":"This claim’s quotation was not located in this source"}</p>:!located ? <p className="workspace-source-notice">{zh ? "当前原文中未匹配到该引用片段，请核对消息。" : "This quote was not found in the original message."}</p> : null}
        {shown.map(message => { const date = message.createdAt && Number.isFinite(message.createdAt) && message.createdAt > 946684800000 ? message.createdAt : undefined; return <section key={message.id} ref={message.id===messageTurn(messages,target)[0]?.id?turnAnchor:undefined} data-message-id={message.id} className={`workspace-source-message${message.role === "user" ? " is-user-message" : " is-ai-message"}${message.id === target.id ? " is-source-target" : ""}`}><div className="workspace-source-message-meta"><strong>{message.role === "user" ? pastedMaterial(message.content) ? zh ? "你粘贴的资料" : "Pasted material" : zh ? "用户" : "User" : message.role === "assistant" ? zh ? "AI 回复" : "AI reply" : message.role === "system" ? zh ? "系统" : "System" : message.role === "tool" ? zh ? "工具" : "Tool" : message.role}</strong>{date ? <time dateTime={new Date(date).toISOString()}>{new Date(date).toLocaleString(zh ? "zh-CN" : "en")}</time> : null}</div><div data-source-content={message.id} ref={message.id === target.id ? targetBody : undefined}><SourceMessageContent locatable message={message} zh={zh} /></div></section>; })}
      </>}
    </div><div ref={endSpacer} className="workspace-source-tail" aria-hidden="true"/></div>{loading && loaded ? <p className="workspace-source-pending" role="status">{zh?"正在切换原文…":"Loading next source…"}</p>:null}<footer>{onReader?<button type="button" className="workspace-source-reader" disabled={unavailable} onClick={onReader}><BookOpen size={16} aria-hidden="true"/>{zh?"查看前后文":"See the conversation"}<ArrowUpRight size={15} aria-hidden="true"/></button>:<button type="button" aria-pressed={context} disabled={unavailable} onClick={()=>setContext(!context)}><BookOpen size={16} aria-hidden="true"/>{context?zh?"只看这条":"This message":zh?"查看前后文":"See the conversation"}</button>}</footer>
  </aside>;
}

