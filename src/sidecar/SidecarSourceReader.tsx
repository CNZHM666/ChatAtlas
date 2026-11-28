import { ArrowLeft } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ReaderGuide } from "../canvas/components/ReaderGuide";
import { evidenceTextLocator } from "../canvas/evidence-highlight";
import { evidencePresentation } from "../shared/evidence-presentation";
import type { FocusSession } from "../shared/focus-session";
import { readableSourceMessages } from "../shared/source-message-delta";
import { sourceMessageSignature } from "../shared/source-signature";
import type { ConversationMessage } from "../shared/types";
import { readSessionSource } from "../storage/source-versions";

export type SidecarSource = { title: string; messageId: string; quote?: string } & (
  | { messages: ConversationMessage[] }
  | { project: FocusSession; conversationId: string; sourceVersionId?: string; signature?: string });

export function SidecarSourceReader({ source, zh, onBack }: { source: SidecarSource; zh: boolean; onBack: () => void }) {
  const [messages, setMessages] = useState<ConversationMessage[]>();
  const [earlier, setEarlier] = useState(2);
  const [later, setLater] = useState(3);
  const scroller = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const target = useRef<HTMLElement>(null);
  const position = messages?.findIndex(item => item.id === source.messageId &&
    (!("signature" in source) || !source.signature || source.signature === sourceMessageSignature(item.content))) ?? -1;

  useEffect(() => {
    let live = true;
    const read = "messages" in source ? Promise.resolve(source.messages) : readSessionSource(source.project, source.conversationId, source.messageId, source.sourceVersionId);
    void read.then(items => { if (live) setMessages(readableSourceMessages(items)); })
      .catch(() => { if (live) setMessages([]); });
    return () => { live = false; };
  }, [source]);
  useLayoutEffect(() => { heading.current?.focus({ preventScroll: true }); }, []);
  useLayoutEffect(() => {
    const message = target.current, body = scroller.current;
    if (!message || !body) return;
    const prose = message.querySelector<HTMLElement>(".sidecar-reading-content");
    const quote = source.quote && evidencePresentation(source.quote);
    const locate = quote && prose ? evidenceTextLocator(prose) : undefined;
    const range = locate && quote && !locate(quote, 1) ? locate(quote) : undefined;
    const firstLine = range?.getClientRects?.()[0];
    body.scrollTop += (firstLine ?? message.getBoundingClientRect()).top - body.getBoundingClientRect().top - 10;
  }, [messages, source]);

  const start = Math.max(0, position - earlier);
  const end = position + later + 1;
  return <section className="native-source-reader" aria-label={zh ? "对话原文" : "Original conversation"} onKeyDown={event => {
    if (event.key === "Escape") { event.stopPropagation(); onBack(); }
  }}>
    <header>
      <button type="button" className="sidecar-wiki-action" onClick={onBack}><ArrowLeft size={14} aria-hidden="true"/>{zh ? "返回" : "Back"}</button>
      <h2 ref={heading} tabIndex={-1} title={source.title}>{source.title || (zh ? "对话原文" : "Original conversation")}</h2>
    </header>
    <div className="sidecar-reading-body native-source-messages" ref={scroller} tabIndex={0}>
      {!messages ? <p role="status">{zh ? "正在读取对话…" : "Loading conversation…"}</p>
        : position < 0 ? <p role="status">{zh ? "这条引用的原话在本地不可用。" : "The cited message is unavailable locally."}</p>
          : <>
            {start > 0 && <button type="button" className="native-tool" onClick={() => setEarlier(value => value + 8)}>{zh ? "更早的消息" : "Earlier messages"}</button>}
            {messages.slice(start, end).map(message => <article key={message.id} data-role={message.role} ref={message.id === source.messageId ? target : undefined}>
              <small>{message.role === "user" ? zh ? "你" : "You" : zh ? "AI 回复" : "AI reply"}</small>
              <div className="sidecar-reading-content"><ReaderGuide content={message.content} zh={zh} complete hideCitationAnnotations/></div>
            </article>)}
            {end < messages.length && <button type="button" className="native-tool" onClick={() => setLater(value => value + 8)}>{zh ? "更多消息" : "More messages"}</button>}
          </>}
    </div>
  </section>;
}
