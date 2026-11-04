import { WorkspaceBackButton } from "./WorkspaceBackButton";
import { useMemo, useRef } from "react";
import type { Conversation, ConversationGraph, ConversationGraphNode, ConversationMessage } from "../../shared/types";
import { episodeMessages, matchingEpisodes } from "../reader-path";
import { usePreferences } from "../preferences";
import { QuestionReader } from "./QuestionReader";
import { ReaderLocator } from "./ReaderLocator";
import { platformName } from "../../shared/platforms";

export function ConversationCompositionReader({ node, graph, conversation, messages, onClose }: {
  node: ConversationGraphNode;
  graph: ConversationGraph;
  conversation: Conversation;
  messages: ConversationMessage[];
  onClose: () => void;
}) {
  const { locale } = usePreferences();
  const zh = locale === "zh-CN";
  const scrollRef = useRef<HTMLDivElement>(null);
  const refs = node.evidenceRefs ?? [];
  const ordered = useMemo(() => [...messages].sort((a, b) => a.messageIndex - b.messageIndex), [messages]);
  const episodes = matchingEpisodes(refs, graph);
  const fallback = refs.length && !episodes.length ? episodeMessages(ordered, refs, [], graph) : [];
  const anchors = episodes.map((episode) => ({ id: `composition-${episode.id}`, title: episode.title }));
  return <aside className="chapter-reader composition-reader" aria-label={zh ? "对话知识阅读" : "Conversation knowledge reader"}>
    <WorkspaceBackButton className="chapter-reader-back" onClick={onClose} label={zh ? "返回对话画布" : "Back to conversation canvas"} />
    <div className="chapter-reader-scroll" ref={scrollRef}><div className="chapter-reader-content">
      <header className="chapter-reader-header"><h1>{node.title}</h1></header>
      {node.description && node.description !== node.title ? <p className="composition-reader-description">{node.description}</p> : null}
      {episodes.length ? <div className="chapter-reader-sections">{episodes.map((episode) => {
        const ids = new Set(episode.messageIds);
        const sectionMessages = ordered.filter((message) => ids.has(message.id));
        return <section id={`composition-${episode.id}`} key={episode.id} className="chapter-reader-section"><h2>{episode.title}</h2>{episode.contextHeader ? <p className="chapter-reader-context">{episode.contextHeader}</p> : null}<QuestionReader messages={sectionMessages} zh={zh} /></section>;
      })}</div> : fallback.length ? <section className="chapter-reader-section"><QuestionReader messages={fallback} zh={zh} /></section> : null}
      <div className="chapter-reader-source"><span>{zh ? "来源" : "Source"}</span><p>{conversation.title} · {platformName(conversation.platform, zh ? "zh-CN" : "en")}</p></div>
    </div></div>
    <ReaderLocator anchors={anchors} scrollRef={scrollRef} />
  </aside>;
}
