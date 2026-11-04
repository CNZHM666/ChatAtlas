import { useEffect, useState } from "react";
import { ArrowUpRight } from "lucide-react";
import type { FocusEvidence, FocusSession } from "../../shared/focus-session";
import type { ConversationMessage } from "../../shared/types";
import { wikiQuoteRange } from "../../shared/wiki-claims";
import { evidencePresentation } from "../evidence-presentation";
import { discussionExcerpt } from "../../shared/discussion-context";
import { SourceMessageContent } from "./SourceMessageContent";

export function WikiClaimSources({ sources, quote, zh, onLocate, sourceRoles, loadOriginal }: {
  sources: Array<{ title: string; refs: FocusEvidence[] }>; quote: string; zh: boolean;
  onLocate: (ref: FocusEvidence) => void; sourceRoles?: FocusSession["sourceRoles"];
  loadOriginal?: (ref: FocusEvidence) => Promise<ConversationMessage | undefined>;
}) {
  const [originals, setOriginals] = useState<Array<ConversationMessage | undefined>>();
  const key = JSON.stringify(sources);
  useEffect(() => {
    if (!loadOriginal) return;
    let alive = true;
    const refs = (JSON.parse(key) as typeof sources).flatMap(source => source.refs);
    Promise.all(refs.map(ref => loadOriginal(ref).catch(() => undefined))).then(result => { if (alive) setOriginals(result); });
    return () => { alive = false; };
  }, [loadOriginal, key]);
  let ordinal = 0;
  return <ul className="wiki-claim-sources">{sources.flatMap(source => source.refs.map((ref, position) => {
    const original = originals?.[ordinal++], text = original?.content ?? ref.excerpt;
    const range = wikiQuoteRange(text, quote), role = original?.role ?? sourceRoles?.[ref.conversationId]?.[ref.messageId];
    const located = range ? { ...ref, excerpt: text.slice(range.start, range.end) } : ref;
    const context = discussionExcerpt(text, range);
    const date = original?.createdAt && Number.isFinite(original.createdAt) && original.createdAt > 946684800000 ? original.createdAt : undefined;
    return <li key={JSON.stringify([ref.conversationId, ref.messageId, ref.sourceVersionId, ref.sourceSignature])}>
      <div className="wiki-source-heading"><span>{evidencePresentation(source.title)}{source.refs.length > 1 ? <small> · {zh ? `片段 ${position + 1}` : `Passage ${position + 1}`}</small> : null}</span>
        {role === "assistant" || role === "user" ? <small>{role === "assistant" ? zh ? "AI 回复" : "AI reply" : zh ? "用户发言" : "User message"}</small> : null}
        {date ? <time dateTime={new Date(date).toISOString()}>{new Date(date).toLocaleDateString(zh ? "zh-CN" : "en")}</time> : null}
      </div>
      <div className="wiki-source-context"><SourceMessageContent content={context} zh={zh} /></div>
      {originals && !original ? <p className="wiki-claim-note">{zh ? "原文暂不可定位，以上保留历史摘录。" : "The original is unavailable; the retained excerpt is shown."}</p> : null}
      <button type="button" onClick={() => onLocate(located)}>{zh ? "阅读原始讨论" : "Read original discussion"}<ArrowUpRight size={13} aria-hidden="true" /></button>
    </li>;
  }))}</ul>;
}
