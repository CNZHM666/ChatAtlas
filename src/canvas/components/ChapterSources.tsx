import { sourceQuestion } from "../../shared/source-question";
import { readableSourceText } from "../../shared/source-text-display";
import { useContext, useEffect, useRef, useState } from "react";
import {ambiguousEvidenceVersion,evidenceVersion,evidenceSnapshotKey,evidenceReadingGroups,uniqueEvidenceMessages} from "../../shared/evidence-identity";
import { ProjectExampleContext } from "../project-example-context";
import { ArrowUpRight } from "lucide-react";
import type { FocusEvidence, FocusSession } from "../../shared/focus-session";
import type { Conversation, ConversationMessage } from "../../shared/types";
import { readSessionSource } from "../../storage/source-versions";
import { discussionExcerpt } from "../../shared/discussion-context";
import { wikiQuoteRange } from "../../shared/wiki-claims";
import { ReaderMarkdown } from "./ReaderConversation";
import { WorkspaceDisclosureTitle } from "./WorkspaceDisclosureTitle";
import { WorkspaceEvidenceContext } from "../workspace-evidence-context";
import { platformName } from "../../shared/platforms";

/** A reading entry for this page's references, never a source-selection control. */
export function ChapterSources({ session, refs, conversations, zh, onLocate, compact=false }: { session: FocusSession; refs: FocusEvidence[]; conversations: Conversation[]; zh: boolean; onLocate: (ref: FocusEvidence) => void; compact?:boolean }) {
  const example=useContext(ProjectExampleContext);
  const panel = useContext(WorkspaceEvidenceContext);

  const unique = uniqueEvidenceMessages(refs,session), cited = [...new Set(unique.map(ref => ref.conversationId))];
  // Sources are grouped by the AI they were discussed with, in order of first citation, so a reader sees which AI said what.
  const platformOf = (id: string) => conversations.find(source => source.id === id)?.platform ?? "";
  const platforms = [...new Set(cited.map(platformOf))];
  const ids = platforms.flatMap(platform => cited.filter(id => platformOf(id) === platform));
  const lookup = (ref: FocusEvidence) => evidenceSnapshotKey(session,ref);
  const [originals, setOriginals] = useState<Record<string, ConversationMessage[]>>({});
  const key = JSON.stringify([session.id, session.sourceVersionIds, unique.map(ref => [ref.id,evidenceSnapshotKey(session,ref)])]);
  const request = useRef({ session, refs: unique }); request.current = { session, refs: unique };
  useEffect(() => {  let live = true; const current = request.current; setOriginals({}); const groups = [...new Map(current.refs.map(ref => [evidenceSnapshotKey(current.session,ref), ref])).entries()]; void Promise.all(groups.map(async ([key,ref]) => [key, ambiguousEvidenceVersion(current.session,ref)?[]:example?example.knowledge(current.session).messages.filter(message=>message.conversationId===ref.conversationId):await readSessionSource(current.session, ref.conversationId, ref.messageId, evidenceVersion(current.session,ref)).catch(() => [])] as const)).then(rows => { if (live) setOriginals(Object.fromEntries(rows)); }); return () => { live = false; }; }, [key, example]);
  return <div className="chapter-source-conversations">{ids.map((id, index) => {
    const source = conversations.find(source => source.id === id), citations = unique.filter(ref => ref.conversationId === id);
    const platform = platformOf(id), opensGroup = index === 0 || platformOf(ids[index - 1]) !== platform, count = ids.filter(other => platformOf(other) === platform).length;
    const heading = opensGroup && (!compact || platforms.length > 1) ? <h3 className="chapter-source-platform" key={`platform:${platform}`}><span>{platform ? platformName(platform, zh ? "zh-CN" : "en") : zh ? "未知来源" : "Unknown source"}</span><small>{zh ? `${count} 个对话` : `${count} ${count > 1 ? "conversations" : "conversation"}`}</small></h3> : null;
    const question=sourceQuestion(originals[lookup(citations[0])]??[],citations[0].messageId)||(zh?"用户问题待定位":"User question unavailable");
    const questions=evidenceReadingGroups(session,citations,new Map(Object.entries(originals))).map(group=>({ref:group.reference,turn:group.turn}));
    return [heading, <section key={id}>
      {!compact ? <button type="button" className="chapter-source-open" title={question} onClick={() => panel ? panel.open(citations[0], {references:citations}) : onLocate(citations[0])}><span><strong>{question}</strong><small>{[source?.title ? zh ? `《${source.title}》` : source.title : "", `${citations.length} ${zh ? "条引用" : "references"}`].filter(Boolean).join(" · ")}</small></span><ArrowUpRight size={16} /></button> : null}
      {!compact && !panel ? <details><WorkspaceDisclosureTitle label={zh ? "引用片段" : "Cited passages"} count={citations.length}/>{citations.map((ref, index) => {
        const message = originals[lookup(ref)]?.find(message => message.id === ref.messageId && message.conversationId === id);
        const range = message && wikiQuoteRange(message.content, ref.excerpt);
        const excerpt = message && range ? discussionExcerpt(message.content, range) : ref.excerpt;
        return <div className="chapter-source-passage" key={ref.id}><button type="button" onClick={() => onLocate(ref)}>{zh ? `引用 ${index + 1}` : `Reference ${index + 1}`}<ArrowUpRight size={13} /></button><div className="chapter-source-text"><ReaderMarkdown content={excerpt} zh={zh} hideImages /></div></div>;
      })}</details> : compact || citations.length > 1 ? <div className="chapter-source-links">{questions.map(({ref,turn},index)=><button type="button" key={ref.id} onClick={()=>panel?panel.open(ref,{references:citations}):onLocate(ref)}><small>{index+1}</small><span title={readableSourceText(turn?.find(message=>message.role==="user")?.content||ref.excerpt).replace(/\s+/g," ")}>{readableSourceText(turn?.find(message=>message.role==="user")?.content||ref.excerpt).replace(/\s+/g," ")}</span><ArrowUpRight size={14}/></button>)}</div> : null}
    </section>];
  })}{!ids.length ? <p className="muted">{zh ? "本章暂无来源" : "No sources for this chapter"}</p> : null}</div>;
}
