import { useContext, useMemo, useState } from "react";
import type { FocusEvidence, FocusSection, FocusSession } from "../../shared/focus-session";
import { ChevronDown, Quote } from "lucide-react";
import { wikiEvidenceItems } from "../wiki-evidence";
import { evidencePresentation } from "../evidence-presentation";
import { readSessionSource } from "../../storage/source-versions";
import type { ConversationMessage } from "../../shared/types";
import { SourceMessageContent } from "./SourceMessageContent";
import { WikiClaimSources } from "./WikiClaimSources";
import { ProjectExampleContext } from "../project-example-context";
import { WorkspaceEvidenceContext } from "../workspace-evidence-context";
import { wikiClaimSourceLabel } from "../../shared/wiki-chapter-status";
import { wikiQuoteRange } from "../../shared/wiki-claims";
import { WikiClaimMarkerContext } from "../wiki-claim-marker-context";

type EvidenceStatus = "supported" | "uncertain" | "unreviewed" | "updated" | "missing";
const labels = { supported: ["原文支持", "Source supports claim"], uncertain: ["上下文不足", "Insufficient context"], unreviewed: ["未校验原文", "Not checked against source"], updated: ["来源有更新", "Source updated"], missing: ["缺少来源", "Source unavailable"] };

export function WikiEvidence({ section, evidence, zh, onLocate, sourceRoles, updatedConversationIds = [], session, embedded=false }: {
  section: FocusSection; evidence: FocusEvidence[]; zh: boolean; onLocate: (ref: FocusEvidence) => void;
  sourceRoles?: FocusSession["sourceRoles"]; updatedConversationIds?: string[];
  session?: FocusSession; embedded?:boolean;
}) {
  const example = useContext(ProjectExampleContext);
  const panel = useContext(WorkspaceEvidenceContext), markers = useContext(WikiClaimMarkerContext);
  const [all, setAll] = useState(false);
  const [opened, setOpened] = useState<Record<number, boolean>>({});
  // Read retained originals only on expansion. Different versions never share a lookup.
  const loadOriginal = useMemo(() => {
    if (example) return async (ref: FocusEvidence) => example.message(ref);
    if (!session) return undefined;
    const reads = new Map<string, Promise<ConversationMessage[]>>();
    return async (ref: FocusEvidence) => {
      const key = JSON.stringify([ref.conversationId, ref.sourceVersionId, ref.messageId]);
      if (!reads.has(key)) reads.set(key, readSessionSource(session, ref.conversationId, ref.messageId, ref.sourceVersionId));
      return (await reads.get(key)!).find(message => message.id === ref.messageId);
    };
  }, [session, example]);
  if (section.userEdited || section.origin || !section.claims?.length && !section.evidenceReview) return null;
  const claims = wikiEvidenceItems(section, evidence).map(claim => {
    const refs = claim.sources.flatMap(source => source.refs);
    const status: EvidenceStatus = !refs.length ? "missing" : refs.some(ref => updatedConversationIds.includes(ref.conversationId)) ? "updated" : claim.verification ?? "unreviewed";
    // Who said it (source axis) is shown beside the machine source check, never merged with it.
    const label = [wikiClaimSourceLabel(claim.source, zh), labels[status][zh ? 0 : 1]].filter(Boolean).join(" · ");
    return { ...claim, status, label };
  });
  // Decisions and reports open at the user's own message, so checking them needs no scrolling through the AI reply.
  const openClaim = (claim: typeof claims[number]) => {
    // Inside a Wiki page, the list joins the same point-by-point navigation as the prose markers.
    const point = markers?.points.find(item => item.claim === claim.text);
    if (point) { markers!.open(point.key); return; }
    const refs = claim.sources.flatMap(source => source.refs), first = refs.find(ref => ref.id === claim.userEvidenceId) ?? refs[0];
    if (first) panel?.open(first, { references: refs, quote: wikiQuoteRange(first.excerpt, claim.quote) ? claim.quote : undefined, claim: claim.text });
  };
  if(embedded&&!claims.length)return null;
  const Container=embedded?"div":"details";
  const pending = claims.filter(claim => claim.status !== "supported").length;
  return <Container className="wiki-evidence">{!embedded?<summary><ChevronDown size={16} aria-hidden="true" /><span>{zh ? "关键结论依据" : "Key claim evidence"}</span>{claims.length ? <small>{zh ? `${claims.length} 条` : `${claims.length} claims`}</small> : null}<small className="wiki-evidence-status">{pending ? zh ? `${pending} 条未经原文校验` : `${pending} not checked against sources` : !claims.length ? zh ? "暂缺可定位依据" : "No anchored evidence" : null}</small></summary>:null}
    {!claims.length ? <p className="wiki-evidence-empty">{zh ? "这页尚未保存可定位的结论依据，原始讨论仍可从来源中阅读。" : "No traceable claim evidence has been saved for this page. Original discussions remain available in Sources."}</p> : <>
      <ul>{(all ? claims : claims.slice(0, 3)).map((claim, index) => <li key={index}>{panel ? <button type="button" className="wiki-claim-panel-link" disabled={!claim.sources.some(source=>source.refs.length)} onClick={()=>openClaim(claim)}><span>{evidencePresentation(claim.text)}</span><small>{claim.label}</small><Quote size={16} aria-hidden="true" /></button> : <details className="wiki-claim" onToggle={event => { const open = event.currentTarget.open; setOpened(current => current[index] === open ? current : { ...current, [index]: open }); }}><summary><span>{evidencePresentation(claim.text)}</span><small className={`wiki-claim-status is-${claim.status}`}>{claim.label}</small><ChevronDown size={14} aria-hidden="true" /></summary><div className="wiki-claim-detail">
        {claim.status === "updated" ? <p className="wiki-claim-note">{zh ? "以下依据来自整理时的原文；讨论有更新，当前结论需要重新核对。" : "These passages reflect the original analysis. The discussion has changed and the current claim needs review."}</p> : claim.status === "uncertain" ? <p className="wiki-claim-note">{zh ? "现有上下文不足以支持完整结论，可回看前后讨论。" : "The available context does not establish the whole claim. Review the surrounding discussion."}</p> : null}
        {!claim.sources.length ? <SourceMessageContent content={claim.quote} zh={zh} /> : null}
        {claim.sources.length ? opened[index] ? <WikiClaimSources sources={claim.sources} quote={claim.quote} zh={zh} onLocate={onLocate} sourceRoles={sourceRoles} loadOriginal={loadOriginal} /> : null : <p className="wiki-claim-note">{zh ? "原始来源暂不可定位，不能据此确认结论。" : "The original source cannot be located, so this claim remains unverified."}</p>}
      </div></details>}</li>)}</ul>
      {claims.length > 3 ? <button className="wiki-evidence-more" type="button" aria-expanded={all} onClick={() => setAll(!all)}>{all ? zh ? "收起更多依据" : "Show fewer claims" : zh ? `查看其余 ${claims.length - 3} 条` : `Show ${claims.length - 3} more claims`}</button> : null}
    </>}
  </Container>;
}
