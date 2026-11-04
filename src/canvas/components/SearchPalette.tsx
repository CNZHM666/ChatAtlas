import { CornerDownLeft, FileText, MessageSquareText, Search, Shapes, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CanvasCard, Conversation, MessageAnchor } from "../../shared/types";
import type { FocusSession } from "../../shared/focus-session";
import { searchAtlas, type SearchResult } from "../../search/search-index";
import { searchAnswers, searchRelatedDiscussions, searchReviewSections } from "../../search/review-search";
import { usePreferences } from "../preferences";
import type { ReviewMark } from "../../storage/review-marks";

interface SearchPaletteProps {
  cards: CanvasCard[]; conversations: Conversation[]; anchors: MessageAnchor[]; marks?: ReviewMark[]; sessions?: FocusSession[];
  onClose: () => void; onSelect: (result: SearchResult) => void;
}
const icon = { card: Shapes, conversation: FileText, anchor: MessageSquareText, message: MessageSquareText, mark: FileText, section: FileText, note: FileText };
type Filter = "all" | "answers" | "sections" | "notes";
export function SearchPalette({ cards, conversations, anchors, marks = [], sessions = [], onClose, onSelect }: SearchPaletteProps) {
  const { locale } = usePreferences(); const zh = locale === "zh-CN";
  const [query, setQuery] = useState(""); const [filter, setFilter] = useState<Filter>("all"); const [active, setActive] = useState(0);
  const [matches, setMatches] = useState<{ query: string; items: SearchResult[]; failed?: boolean }>({ query: "", items: [] });
  const input = useRef<HTMLInputElement>(null);
  const results = useMemo(() => {
    const combined = query.trim() ? [...searchAtlas(query, { cards, conversations, anchors, marks }), ...searchReviewSections(query, sessions), ...(matches.query === query ? matches.items : [])] : [];
    const unique = new Map<string, SearchResult>();
    for (const result of combined) { const key = result.kind === "message" ? result.kind + ":" + result.message.conversationId + ":" + (result.questionId ?? result.id) : result.kind + ":" + result.id; const old = unique.get(key); if (!old || old.score < result.score) unique.set(key, result); }
    return [...unique.values()].filter((result) => filter === "all" || filter === "answers" && ["message", "anchor"].includes(result.kind) || filter === "sections" && ["section", "conversation", "card"].includes(result.kind) || filter === "notes" && ["note", "mark"].includes(result.kind)).sort((a, b) => b.score - a.score).slice(0, 35);
  }, [query, cards, conversations, anchors, marks, sessions, matches, filter]);
  const loading = Boolean(query.trim().length >= 2 && matches.query !== query);
  useEffect(() => input.current?.focus(), []);
  useEffect(() => setActive(0), [query, filter]);
  useEffect(() => {
    let live = true;
    const timer = window.setTimeout(() => {
      if (query.trim().length < 2) { setMatches({ query, items: [] }); return; }
      void Promise.allSettled([searchAnswers(query, conversations), searchRelatedDiscussions(query, conversations)]).then((responses) => { if (live) setMatches({ query, items: responses.flatMap((response) => response.status === "fulfilled" ? response.value : []), failed: responses.some((response) => response.status === "rejected") }); });
    }, 180);
    return () => { live = false; window.clearTimeout(timer); };
  }, [query, conversations]);
  const labels = zh ? { card: "知识", conversation: "对话", anchor: "原文", message: "问答", mark: "标记", section: "章节", note: "笔记" } : { card: "Knowledge", conversation: "Conversation", anchor: "Source", message: "Answer", mark: "Mark", section: "Chapter", note: "Note" };
  return <div className="modal-layer" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section className="search-palette" role="dialog" aria-modal="true" aria-label={zh ? "搜索 ChatAtlas" : "Search ChatAtlas"}>
      <div className="search-input-row"><Search size={19} /><input ref={input} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={zh ? "找回答、章节或笔记…" : "Find answers, chapters or notes…"} onKeyDown={(event) => { if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setActive((index) => Math.max(0, Math.min(index + (event.key === "ArrowDown" ? 1 : -1), results.length - 1))); } if (event.key === "Enter" && results[Math.min(active, results.length - 1)]) onSelect(results[Math.min(active, results.length - 1)]); if (event.key === "Escape") onClose(); }} /><button onClick={onClose} aria-label={zh ? "关闭搜索" : "Close search"}><X size={17} /></button></div>
      <div className="search-filters" role="group" aria-label={zh ? "结果类型" : "Result type"}>{(["all", "answers", "sections", "notes"] as const).map((item, index) => <button key={item} aria-pressed={filter === item} onClick={() => setFilter(item)}>{(zh ? ["全部", "问答", "章节与知识", "笔记"] : ["All", "Answers", "Chapters & knowledge", "Notes"])[index]}</button>)}</div>
      <div className="search-results">
        {!query.trim() ? <p className="search-empty">{zh ? "可搜索原文，也会查找已整理的概念与理解。" : "Search original text and existing concepts and notes."}</p> : null}
        {loading ? <p className="search-empty" role="status">{zh ? "查找原文与相关内容…" : "Searching discussion and related content…"}</p> : query.trim() && !results.length ? <p className="search-empty">{zh ? "没有找到匹配内容，试试主题或关键概念。" : "No matches. Try a topic or key concept."}</p> : null}
        {matches.query === query && matches.failed ? <small role="status">{zh ? "部分原文暂未读取，可重开搜索重试。" : "Some discussion could not be read. Reopen search to retry."}</small> : null}
        {results.map((result, index) => { const Icon = icon[result.kind]; return <button key={result.kind + result.id} className={index === Math.min(active, results.length - 1) ? "active" : ""} onMouseEnter={() => setActive(index)} onClick={() => onSelect(result)}><span className="result-icon"><Icon size={16} /></span><span><strong>{result.title}</strong><small>{labels[result.kind]} · {result.context}</small>{result.excerpt ? <p>{result.excerpt}</p> : null}</span>{index === active ? <CornerDownLeft size={14} /> : null}</button>; })}
      </div><footer className="search-footer"><span><kbd>↑</kbd><kbd>↓</kbd> {zh ? "选择" : "Navigate"}</span><span><kbd>↵</kbd> {zh ? "打开" : "Open"}</span><span><kbd>esc</kbd> {zh ? "关闭" : "Close"}</span><small>{zh ? "本地查找，不产生 AI 用量" : "Local search · no AI usage"}</small></footer>
    </section>
  </div>;
}
