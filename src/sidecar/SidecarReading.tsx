import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, BookOpen, Check, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, CornerDownLeft, X } from "lucide-react";
import type { ConversationMessage } from "../shared/types";
import type { MemoryHit } from "./context-engine";
import { getMessagesForConversation } from "../storage/messages";
import { readerQuestionIndex } from "../canvas/reader-position";
import { platformName } from "../shared/platforms";
import { readingInsertText } from "./reading-insert";
import { SidecarMessageContent } from "./SidecarMessageContent";
import { sendComposerReference } from "./host";
import { queryPattern } from "./search-excerpt";

const HIGHLIGHT = "atlas-reading-match";
/** How long a success notice stays. */
const NOTICE_MS = 4000;
type Highlights = { set(name: string, value: unknown): void; delete(name: string): void };
const highlights = () => (globalThis as { CSS?: { highlights?: Highlights } }).CSS?.highlights;
const HighlightClass = (globalThis as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight;

/** One question turn: the question and every reply to it, in the order said. */
interface ReadingTurn { id: string; messages: ConversationMessage[] }

/** A conversation's question turns, each message under the question it answers. */
function readingTurns(messages: ConversationMessage[]): ReadingTurn[] {
  const index = readerQuestionIndex(messages), turns = new Map<string, ConversationMessage[]>();
  for (const message of messages) {
    const id = index.get(message.id) ?? message.id;
    turns.set(id, [...turns.get(id) ?? [], message]);
  }
  return [...turns].map(([id, rows]) => ({ id, messages: rows }));
}

/** The searched words marked in place, without touching the rendered markup: React owns those nodes. */
function markTerms(root: HTMLElement, query: string): Range[] {
  const pattern = queryPattern(query);
  if (!pattern) return [];
  const ranges: Range[] = [], walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.textContent ?? "";
    for (const match of text.matchAll(new RegExp(pattern.source, "giu"))) {
      const range = document.createRange();
      range.setStart(node, match.index!); range.setEnd(node, match.index! + match[0].length);
      ranges.push(range);
    }
  }
  return ranges;
}

/** A search result read in the sidebar: the question turn holding the match, the AI page beside it left where it is.
 * Steps through this conversation's matches and its questions; inserting and the full Reader are small actions below. */
export function SidecarReading({ hits, start, query, zh, canInsert, conversationId, onBack, onOpenReader }: {
  /** This conversation's matches, best first. */
  hits: MemoryHit[]; start: number; query: string; zh: boolean; canInsert: boolean; conversationId: string;
  onBack: () => void; onOpenReader: (hit: MemoryHit) => void;
}) {
  const l = (cn: string, en: string) => zh ? cn : en;
  const [matchAt, setMatchAt] = useState(Math.min(Math.max(start, 0), hits.length - 1));
  const hit = hits[matchAt], conversation = hit.conversation;
  const [messages, setMessages] = useState<ConversationMessage[]>();
  const [failed, setFailed] = useState(false);
  const [turnId, setTurnId] = useState<string>();
  // What happened on the last insertion, shown over the actions until it is closed or, when it went well, a moment later.
  const [notice, setNotice] = useState<{ text: string; failed: boolean; inserted?: string }>();
  // Text selected inside the question turn: inserting quotes only that.
  const [selected, setSelected] = useState("");
  const body = useRef<HTMLDivElement>(null), layer = useRef<HTMLElement>(null);
  useEffect(() => { layer.current?.focus({ preventScroll: true }); }, []);
  useEffect(() => {
    let live = true; setMessages(undefined); setFailed(false);
    void getMessagesForConversation(conversation.id, { cache: false }).then(rows => { if (live) setMessages(rows); }).catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [conversation.id]);
  const turns = useMemo(() => readingTurns(messages ?? []), [messages]);
  const matchTurn = useMemo(() => turns.findIndex(turn => turn.messages.some(message => message.id === hit.message.id)), [turns, hit]);
  // A step to another match reads its turn; a step between questions leaves the match where it was.
  useEffect(() => { setTurnId(turns[matchTurn]?.id); setNotice(undefined); }, [turns, matchTurn]);
  const at = Math.max(0, turns.findIndex(turn => turn.id === turnId));
  // One object per turn shown: a render for another reason (a notice) does not scroll back to the match.
  const turn = useMemo(() => turns[at] ?? (messages ? undefined : { id: hit.message.id, messages: [hit.message] }), [turns, at, messages, hit]);
  const showsMatch = turn?.messages.some(message => message.id === hit.message.id);

  useLayoutEffect(() => {
    const root = body.current;
    if (!root || !turn) return;
    const ranges = markTerms(root, query), registry = highlights();
    if (registry && HighlightClass && ranges.length) registry.set(HIGHLIGHT, new HighlightClass(...ranges));
    // Open at the match: its first marked words, else its message; another question opens at its top.
    const target = showsMatch ? root.querySelector<HTMLElement>(`[data-message="${CSS.escape(hit.message.id)}"]`) : undefined;
    const first = target ? ranges.find(range => target.contains(range.startContainer)) : undefined;
    const rect = first?.getBoundingClientRect?.() ?? target?.getBoundingClientRect?.();
    root.scrollTop = rect && (rect.top || rect.bottom) ? Math.max(0, root.scrollTop + rect.top - root.getBoundingClientRect().top - 72) : 0;
    return () => { registry?.delete(HIGHLIGHT); };
  }, [turn, hit, query, showsMatch]);

  useEffect(() => {
    const read = () => {
      const selection = document.getSelection(), root = body.current;
      const inside = selection && !selection.isCollapsed && root && selection.rangeCount > 0 && root.contains(selection.getRangeAt(0).commonAncestorContainer);
      setSelected(inside ? selection.toString().trim() : "");
    };
    document.addEventListener("selectionchange", read);
    return () => document.removeEventListener("selectionchange", read);
  }, []);
  useEffect(() => { setSelected(""); }, [turn]);
  // A success says so briefly; a failure stays until it is closed.
  useEffect(() => {
    if (!notice || notice.failed) return;
    const timer = setTimeout(() => setNotice(current => current === notice ? undefined : current), NOTICE_MS);
    return () => clearTimeout(timer);
  }, [notice]);
  const failure = (reason: string) => reason === "draft" ? l("输入框里已有内容，没有覆盖。清空后再引用。", "The input box has a draft; it was not replaced.")
    : reason === "edited" ? l("你已在输入框里继续写了，没有撤销。", "You have written in the input box since; nothing was removed.")
    : reason === "unavailable" ? l("没有找到输入框，请确认页面已加载完成。", "No input box was found. Make sure the page has loaded.")
    : reason === "changed" ? l("页面已切换到其他对话。", "The page switched to another chat.")
    : l("没有填入输入框，请重试。", "Could not fill the input box. Try again.");
  const insert = async () => {
    if (!turn) return;
    const text = readingInsertText(conversation, turn.messages, zh, selected);
    setNotice(undefined);
    try {
      await sendComposerReference(conversationId, text);
      setNotice({ text: selected ? l("已引用选中内容，可在分割线下继续写。", "Quoted the selection; write under the line.") : l("已引用到输入框，可在分割线下继续写。", "Quoted into the input box; write under the line."), failed: false, inserted: text });
    } catch (error) { setNotice({ failed: true, text: failure(error instanceof Error ? error.message : "") }); }
  };
  const undo = async (text: string) => {
    try { await sendComposerReference(conversationId, text, true); setNotice({ text: l("已撤销引用。", "Quote removed."), failed: false }); }
    catch (error) { setNotice({ failed: true, text: failure(error instanceof Error ? error.message : "") }); }
  };

  // The day it was said, when the platform gave one; never the day it was imported.
  const time = hit.message.sourceCreatedAt;
  const date = typeof time === "number" && Number.isFinite(time) && time > 0 && time <= 8.64e15 ? new Date(time).toLocaleDateString(zh ? "zh-CN" : "en") : "";
  const question = (index: number) => turns[index]?.messages.find(message => message.role === "user")?.content.replace(/\s+/gu, " ").trim();
  // The whole panel reads: Escape goes back to the results, not past them to close the sidebar.
  return <section className="sidecar-reading" ref={layer} tabIndex={-1} aria-label={l(`阅读：${conversation.title}`, `Reading: ${conversation.title}`)} onKeyDown={event => { if (event.key !== "Escape") return; event.stopPropagation(); onBack(); }}>
    <header className="sidecar-reading-head">
      <div className="sidecar-reading-bar">
        <button type="button" className="sidecar-reading-back" onClick={onBack}><ArrowLeft size={15} aria-hidden="true"/>{l("结果", "Results")}</button>
        {hits.length > 1 ? <div className="sidecar-reading-matches" role="group" aria-label={l("本对话的匹配", "Matches in this chat")}>
          <button type="button" aria-label={l("上一处匹配", "Previous match")} disabled={matchAt === 0} onClick={() => setMatchAt(matchAt - 1)}><ChevronUp size={15} aria-hidden="true"/></button>
          <span aria-live="polite">{l(`第 ${matchAt + 1} / ${hits.length} 处`, `${matchAt + 1} / ${hits.length}`)}</span>
          <button type="button" aria-label={l("下一处匹配", "Next match")} disabled={matchAt === hits.length - 1} onClick={() => setMatchAt(matchAt + 1)}><ChevronDown size={15} aria-hidden="true"/></button>
        </div> : null}
      </div>
      <strong title={conversation.title}>{conversation.title}</strong>
      <small>{[platformName(conversation.platform, zh ? "zh-CN" : "en"), date, turns.length > 1 ? l(`第 ${at + 1} / ${turns.length} 问`, `Question ${at + 1} of ${turns.length}`) : ""].filter(Boolean).join(" · ")}</small>
    </header>
    <div className="sidecar-reading-body" ref={body}>
      {failed ? <p role="alert" className="sidecar-reading-empty">{l("这段对话暂时无法读取，可在完整 Reader 中打开。", "This chat could not be read here. Open it in the full Reader.")}</p>
        : !turn ? <p role="status" className="sidecar-reading-empty">{l("正在载入…", "Loading…")}</p>
        : turn.messages.map(message => <article key={message.id} data-message={message.id} data-role={message.role} data-match={message.id === hit.message.id && showsMatch || undefined}>
          <small>{message.role === "user" ? l("我", "Me") : l("AI 回复", "AI reply")}{message.id === hit.message.id && showsMatch ? <span className="sidecar-reading-match-label"> · {l("匹配", "Match")}</span> : null}</small>
          <div className="sidecar-reading-content"><SidecarMessageContent message={message} sourceUrl={conversation.url ?? ""} zh={zh}/></div>
        </article>)}
    </div>
    <footer className="sidecar-reading-foot">
      {turns.length > 1 ? <nav className="sidecar-reading-turns" aria-label={l("前后问题", "Nearby questions")}>
        <button type="button" disabled={at === 0} title={question(at - 1)} onClick={() => setTurnId(turns[at - 1]?.id)}><ChevronLeft size={14} aria-hidden="true"/><span>{l("上一问", "Previous")}</span></button>
        {!showsMatch && matchTurn >= 0 ? <button type="button" className="sidecar-reading-to-match" onClick={() => setTurnId(turns[matchTurn].id)}>{l("回到匹配", "Back to match")}</button> : null}
        <button type="button" disabled={at >= turns.length - 1} title={question(at + 1)} onClick={() => setTurnId(turns[at + 1]?.id)}><span>{l("下一问", "Next")}</span><ChevronRight size={14} aria-hidden="true"/></button>
      </nav> : null}
      <div className="sidecar-reading-actions">
        {/* Pressed without taking the selection away: the selection is what it quotes. */}
        {canInsert ? <button type="button" className={selected ? "is-selection" : undefined} disabled={!turn || !messages} title={selected ? l("只把选中的内容引用到 AI 输入框，不会发送", "Quote only the selection into the AI's input box; nothing is sent") : l("把这一问的问答引用到 AI 输入框，末尾加分割线，可在下面继续写；不会发送。选中正文可只引用一段", "Quote this question and its answer into the AI's input box, with a line to write under; nothing is sent. Select text to quote only part")} onMouseDown={event => event.preventDefault()} onClick={() => void insert()}><CornerDownLeft size={14} aria-hidden="true"/>{selected ? l("引用选中内容", "Quote selection") : l("引用到输入框", "Quote into input")}</button> : null}
        <button type="button" onClick={() => onOpenReader(hit)}><BookOpen size={14} aria-hidden="true"/>{l("完整 Reader", "Full Reader")}</button>
      </div>
      {notice ? <div role={notice.failed ? "alert" : "status"} className="sidecar-reading-toast" data-failed={notice.failed || undefined}>
        {notice.failed ? null : <Check size={14} aria-hidden="true"/>}
        <span>{notice.text}</span>
        {notice.inserted ? <button type="button" className="sidecar-reading-toast-undo" onClick={() => void undo(notice.inserted!)}>{l("撤销", "Undo")}</button> : null}
        <button type="button" className="sidecar-reading-toast-close" aria-label={l("关闭提示", "Dismiss")} onClick={() => setNotice(undefined)}><X size={13} aria-hidden="true"/></button>
      </div> : null}
    </footer>
  </section>;
}
