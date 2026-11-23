import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight, Compass, FileText, FolderGit2, GraduationCap, History, MessageSquare, Search, Trash2, X } from "lucide-react";
import type { FocusSession } from "../../shared/focus-session";
import { clearHomeHistory, listHiddenHistorySessionIds, listHomeResults, type HomeResult } from "../../storage/home-results";
import { groupFocusVersions } from "../focus-versions";

const KINDS = {
  answer: [MessageSquare, "历史问答", "Answer"], search: [Search, "找回对话", "Search"],
  discovery: [Compass, "发现主题", "Topic discovery"], project: [FolderGit2, "项目", "Project"],
  review: [GraduationCap, "历史内容", "Saved content"], summary: [FileText, "讨论总结", "Summary"],
} as const;

type HistoryRow = { id: string; title: string; date: number; kind: keyof typeof KINDS; detail?: string } & (
  { record: HomeResult } | { sessionId: string; version?: string }
);

function resultDetail(record: HomeResult, zh: boolean) {
  if ("answer" in record) return record.answer.sections.some(section => section.reviewIssue
    || section.evidenceReview?.status === "partial" || section.evidenceReview?.status === "unanchored")
    ? zh ? "待核对" : "Needs verification" : undefined;
  if (record.status === "failed") return zh ? "可重试" : "Retry available";
  if (record.status === "started") return zh ? "未完成" : "Incomplete";
  if (record.kind === "search") return zh ? `${record.matchCount ?? 0} 条匹配` : `${record.matchCount ?? 0} matches`;
  return zh ? `${record.candidates?.length ?? 0} 个主题` : `${record.candidates?.length ?? 0} topics`;
}

function calendarDay(at: number) {
  const day = new Date(at);
  day.setHours(0, 0, 0, 0);
  return day.getTime();
}

export function HomeResultHistory({ sessions, zh, onResult, onSession, readOnly = false }: {
  sessions: FocusSession[]; zh: boolean; onResult: (record: HomeResult) => void; onSession: (id: string) => void; readOnly?: boolean;
}) {
  const [records, setRecords] = useState<HomeResult[]>([]), [hiddenIds, setHiddenIds] = useState(new Set<string>());
  const [query, setQuery] = useState(""), [error, setError] = useState(false), [ready, setReady] = useState(readOnly);
  const [confirmClear, setConfirmClear] = useState(false), [clearing, setClearing] = useState(false), [clearError, setClearError] = useState("");
  const search = useRef<HTMLInputElement>(null), clearButton = useRef<HTMLButtonElement>(null), cancelButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (readOnly) return;
    let live = true;
    void Promise.allSettled([listHomeResults(), listHiddenHistorySessionIds()]).then(([results, hidden]) => {
      if (!live) return;
      if (results.status === "fulfilled") setRecords(results.value);
      if (hidden.status === "fulfilled") setHiddenIds(new Set(hidden.value));
      setError(results.status === "rejected" || hidden.status === "rejected");
      setReady(true);
    });
    return () => { live = false; };
  }, [readOnly]);
  useEffect(() => { if (confirmClear) cancelButton.current?.focus(); }, [confirmClear]);

  const historySessions = useMemo(() => sessions.filter(session => !session.deletedAt && !session.historyHiddenAt && !hiddenIds.has(session.id)), [sessions, hiddenIds]);
  const rows = useMemo<HistoryRow[]>(() => {
    if (!ready) return [];
    const versions = new Map<string, string>();
    for (const { versions: group } of groupFocusVersions(sessions.filter(session => session.mode === "work" && !session.deletedAt))) {
      if (group.length > 1) group.forEach((session, index) => versions.set(session.id, zh ? `第 ${group.length - index} 版` : `Version ${group.length - index}`));
    }
    const saved = records.map(record => ({ id: record.id, title: record.question, date: record.createdAt, kind: record.kind ?? "answer", detail: resultDetail(record, zh), record }));
    const documents = historySessions.map((session): HistoryRow => ({ id: session.id, title: session.title, date: session.createdAt,
      kind: session.mode === "work" ? "project" : session.mode === "review" ? "review" : "summary",
      detail: session.status === "preview" ? zh ? "待确认" : "Preview" : undefined, sessionId: session.id, version: versions.get(session.id) }));
    return [...saved, ...documents].sort((a, b) => (b.date - a.date) || b.id.localeCompare(a.id));
  }, [records, historySessions, ready, sessions, zh]);
  const needle = query.trim().normalize("NFKC").toLocaleLowerCase();
  const groups = useMemo(() => {
    const days = new Map<number, HistoryRow[]>();
    for (const row of rows) {
      if (needle && !row.title.normalize("NFKC").toLocaleLowerCase().includes(needle)) continue;
      const day = calendarDay(row.date);
      const entries = days.get(day);
      if (entries) entries.push(row); else days.set(day, [row]);
    }
    return days;
  }, [rows, needle]);
  const [dateFormat, timeFormat, timestampFormat] = useMemo(() => {
    const locale = zh ? "zh-CN" : "en";
    return [new Intl.DateTimeFormat(locale, { dateStyle: "long" }), new Intl.DateTimeFormat(locale, { timeStyle: "short" }),
      new Intl.DateTimeFormat(locale, { dateStyle: "long", timeStyle: "short" })];
  }, [zh]);
  const date = new Date(), today = calendarDay(date.getTime());
  date.setDate(date.getDate() - 1);
  const yesterday = calendarDay(date.getTime());

  const resetQuery = () => { setQuery(""); search.current?.focus(); };
  const cancelClear = () => { setConfirmClear(false); setClearError(""); clearButton.current?.focus(); };
  const clear = async () => {
    if (clearing || !ready || error) return;
    setClearing(true);
    setClearError("");
    const ids = historySessions.map(session => session.id);
    try {
      await clearHomeHistory(records.map(record => record.id), ids);
      setRecords([]);
      setHiddenIds(previous => new Set([...previous, ...ids]));
      setConfirmClear(false);
      resetQuery();
    } catch {
      setClearError(zh ? "未能清空记录，请重试。" : "Could not clear history. Try again.");
    } finally { setClearing(false); }
  };

  const clearLabel = zh ? "清空历史记录" : "Clear history";
  const searchLabel = zh ? "搜索历史记录" : "Search history";
  return <main className="home-result-history">
    <div className="home-history-content">
      <header className="home-history-heading">
        <h1>{zh ? "历史记录" : "History"}</h1>
        <button ref={clearButton} type="button" className="home-history-clear" title={clearLabel} aria-label={clearLabel}
          aria-expanded={confirmClear} disabled={readOnly || !ready || error || clearing || !rows.length} onClick={() => confirmClear ? cancelClear() : setConfirmClear(true)}>
          <Trash2 size={16} aria-hidden="true"/><span>{clearLabel}</span>
        </button>
      </header>
      <div className="home-history-search">
        <Search size={16} aria-hidden="true"/>
        <input ref={search} type="search" aria-label={searchLabel} placeholder={zh ? "搜索记录…" : "Search history…"} value={query} onChange={event => setQuery(event.target.value)}/>
        {query && <button type="button" className="home-history-search-reset" aria-label={zh ? "清除搜索" : "Clear search"} onClick={resetQuery}><X size={15} aria-hidden="true"/></button>}
      </div>
      {confirmClear && <section className="home-history-confirm" aria-label={zh ? "确认清空历史记录" : "Confirm clearing history"} onKeyDown={event => { if (event.key === "Escape" && !clearing) cancelClear(); }}>
        <div><strong>{zh ? "清空这份历史记录？" : "Clear this history?"}</strong>
          <p>{zh ? "此列表中的记录将被清空。项目正文和来源对话仍可访问。" : "This list will be cleared. Saved projects and source conversations will remain available."}</p>
          {clearError && <p role="alert">{clearError}</p>}
        </div>
        <div className="home-history-confirm-actions">
          <button ref={cancelButton} type="button" disabled={clearing} onClick={cancelClear}>{zh ? "取消" : "Cancel"}</button>
          <button type="button" disabled={clearing} onClick={() => void clear()}>{clearing ? zh ? "清空中…" : "Clearing…" : zh ? "清空记录" : "Clear records"}</button>
        </div>
      </section>}
      {error && <p className="home-history-status" role="alert">{zh ? "部分历史记录暂时无法读取。" : "Some history could not be loaded."}</p>}
      <div className="home-history-list">
        {[...groups].map(([day, entries]) => {
          const heading = day === today ? zh ? "今天" : "Today" : day === yesterday ? zh ? "昨天" : "Yesterday"
            : Number.isFinite(day) ? dateFormat.format(day) : zh ? "日期未知" : "Date unknown";
          return <section key={day} className="home-history-day" aria-label={heading}>
            <h2 className="home-history-day-heading">{heading}</h2>
            <ul>{entries.map(row => {
              const [Icon, cn, en] = KINDS[row.kind];
              const validDate = Number.isFinite(new Date(row.date).getTime());
              const version = "sessionId" in row ? row.version : undefined;
              return <li key={JSON.stringify(["record" in row, row.id])}>
                <button type="button" className="home-history-row" onClick={() => "record" in row ? onResult(row.record) : onSession(row.sessionId)}>
                  <span className="home-history-kind" title={zh ? cn : en}><Icon size={16} aria-hidden="true"/><span className="sr-only">{zh ? cn : en}</span></span>
                  <span className="home-history-title"><strong title={row.title}>{row.title}</strong>
                    {(version || row.detail) && <small>{[version, row.detail].filter(Boolean).join(" · ")}</small>}
                  </span>
                  {validDate && <time dateTime={new Date(row.date).toISOString()} title={timestampFormat.format(row.date)}>{timeFormat.format(row.date)}</time>}
                  <ChevronRight className="home-history-arrow" size={15} aria-hidden="true"/>
                </button>
              </li>;
            })}</ul>
          </section>;
        })}
      </div>
      {!ready && <p className="home-history-status" role="status">{zh ? "读取记录…" : "Loading history…"}</p>}
      {ready && !error && !groups.size && <div className="home-history-empty">
        {needle ? <Search size={22} aria-hidden="true"/> : <History size={22} aria-hidden="true"/>}
        <h2>{needle ? zh ? "没有匹配记录" : "No matching history" : zh ? "还没有历史记录" : "No history yet"}</h2>
        {needle && <button type="button" onClick={resetQuery}>{zh ? "查看全部记录" : "Show all history"}</button>}
      </div>}
    </div>
  </main>;
}
