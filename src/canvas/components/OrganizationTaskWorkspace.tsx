import { ArrowUpRight, Check, PanelRightClose } from "lucide-react";
import { WorkspaceBackButton } from "./WorkspaceBackButton";
import { useEffect, useMemo, useState } from "react";
import type { Conversation, ConversationMessage, KnowledgeProposal, OrganizationRun, OrganizationTaskEvent, SourceRef } from "../../shared/types";
import { getMessagesForConversation } from "../../storage/messages";
import { usePreferences } from "../preferences";
import { TaskProgressMark } from "./TaskProgressMark";

const stageLabels: Record<OrganizationRun["stage"], [string, string]> = {
  preparing: ["Checking AI settings and provider access", "检查 AI 设置与服务商访问权限"], question_analysis: ["Reading questions", "提炼问题"],
  structure_planning: ["Planning structure", "规划结构"], chapter_merge: ["Merging chapters", "合并章节"],
  conversation_profiles: ["Reading conversations", "分析对话"], domain_planning: ["Finding topics", "识别主题"],
  concept_canonicalization: ["Organizing concepts", "整理概念"], relation_analysis: ["Checking relationships", "判断知识关系"],
  bridge_insight_generation: ["Building connections", "生成连接"], structure_validation: ["Checking structure", "验证结构"],
  proposal_ready: ["Ready for review", "等待确认"],
};

function SourceLink({ refs, onOpen }: { refs: SourceRef[]; onOpen: (refs: SourceRef[]) => void }) {
  const { locale } = usePreferences();
  if (!refs.length) return null;
  const count = new Set(refs.map((ref) => `${ref.conversationId}:${ref.messageId ?? ref.questionId ?? ""}`)).size;
  return <button type="button" className="task-source-link" onClick={() => onOpen(refs)}>{locale === "zh-CN" ? `来源 ${count} 条` : `${count} ${count === 1 ? "source" : "sources"}`} <ArrowUpRight size={14} /></button>;
}

function TaskEvent({ event, onOpenSources }: { event: OrganizationTaskEvent; onOpenSources: (refs: SourceRef[]) => void }) {
  const { locale } = usePreferences();
  const zh = locale === "zh-CN";
  if (event.type === "progress") return <div className="task-minute task-minute-progress"><Check size={16} />{event.message === "question_analysis" ? zh ? `已识别 ${event.current ?? 0} 个问题` : `Identified ${event.current ?? 0} questions` : event.message === "conversation_profiles" ? zh ? `已分析 ${event.current ?? 0} / ${event.total ?? 0} 条对话` : `Analyzed ${event.current ?? 0} / ${event.total ?? 0} conversations` : event.message === "concept_found" ? zh ? `识别出 ${event.current ?? 0} 个概念` : `Identified ${event.current ?? 0} concepts` : event.message === "relation_found" ? zh ? `发现 ${event.current ?? 0} 条关系` : `Found ${event.current ?? 0} relationships` : zh ? stageLabels[event.message as OrganizationRun["stage"]]?.[1] ?? event.message : stageLabels[event.message as OrganizationRun["stage"]]?.[0] ?? event.message}</div>;
  if (event.type === "proposal_ready" || event.type === "completed") return null;
  const label = event.type === "topic_found" ? zh ? "识别主题" : "Topic found"
    : event.type === "concept_found" ? zh ? "识别概念" : "Concept found"
    : event.type === "concept_merged" ? zh ? "合并概念" : "Concept merge"
    : event.type === "relation_found" ? zh ? "发现关系" : "Relationship found"
    : event.type === "bridge_created" ? zh ? "生成连接卡片" : "Connection created"
    : event.type === "insight_created" ? zh ? "发现洞察" : "Insight found"
    : event.type === "draft_suggested" ? zh ? "建议补充" : "Suggested draft"
    : zh ? "结构调整" : "Structure revision";
  const refs = "sourceRefs" in event ? event.sourceRefs ?? [] : [];
  return <section className={`task-minute ${event.type === "draft_suggested" || event.type === "concept_merged" ? "task-minute-review" : "task-minute-discovery"}`}>
    <div className="task-minute-kicker"><span aria-hidden="true">{event.type === "draft_suggested" || event.type === "concept_merged" ? "◇" : "✦"}</span>{label}</div>
    {event.type === "relation_found" ? <><h3>{event.from} <span className="task-arrow">→</span> {event.to}</h3><p>{event.relationType}</p></> : event.type === "concept_merged" ? <><p>{event.from.join(" · ")}</p><h3>→ {event.to}</h3></> : event.type === "structure_revision" ? <p>{event.message === "no_changes" ? zh ? "这些对话暂无需要应用的知识变更。" : "No knowledge changes are needed for these conversations." : event.message}</p> : <><h3>{event.title}</h3>{"body" in event && event.body && event.body !== event.title ? <p>{event.body}</p> : null}</>}
    <SourceLink refs={refs} onOpen={onOpenSources} />
  </section>;
}

function SourceDetail({ refs, conversations, onClose, onOpenConversation }: { refs: SourceRef[]; conversations: Conversation[]; onClose: () => void; onOpenConversation: (id: string, message?: ConversationMessage) => void }) {
  const { locale } = usePreferences();
  const [messages, setMessages] = useState<Record<string, ConversationMessage[]>>({});
  useEffect(() => {
    let live = true;
    setMessages({});
    void Promise.all([...new Set(refs.map((ref) => ref.conversationId))].map(async (id) => [id, await getMessagesForConversation(id)] as const))
      .then((entries) => { if (live) setMessages(Object.fromEntries(entries)); })
      .catch(() => { if (live) setMessages(Object.fromEntries(refs.map((ref) => [ref.conversationId, []]))); });
    return () => { live = false; };
  }, [refs]);
  return <aside className="organization-source-panel" aria-label={locale === "zh-CN" ? "来源" : "Sources"}>
    <header><h2>{locale === "zh-CN" ? "来源" : "Sources"}</h2><button type="button" className="icon-button" onClick={onClose} aria-label={locale === "zh-CN" ? "关闭" : "Close"}><PanelRightClose size={18} /></button></header>
    {refs.map((ref, index) => {
      const conversation = conversations.find((item) => item.id === ref.conversationId);
      const questionId = ref.questionId?.replace(/^conversation-message-/u, "");
      const message = messages[ref.conversationId]?.find((item) => item.id === ref.messageId || item.platformMessageId === ref.messageId || item.id === questionId);
      const date = conversation?.sourceCreatedAt;
      return <article key={`${ref.conversationId}:${ref.messageId ?? ref.questionId ?? index}`}>
        {date ? <time>{locale === "zh-CN" ? "对话创建于 " : "Conversation started "}{new Intl.DateTimeFormat(locale, { year: "numeric", month: "2-digit", day: "2-digit" }).format(date)}</time> : null}
        <h3>{message?.preview || conversation?.title || ref.conversationId}</h3>
        {message && conversation ? <p>{conversation.title}</p> : null}
        <div>{messages[ref.conversationId] ? <button type="button" onClick={() => onOpenConversation(ref.conversationId, message)}>{locale === "zh-CN" ? "在 ChatAtlas 阅读" : "Read in ChatAtlas"} <ArrowUpRight size={13} /></button> : <span role="status">{locale === "zh-CN" ? "正在定位原文…" : "Locating discussion…"}</span>}</div>
      </article>;
    })}
  </aside>;
}

export function OrganizationTaskWorkspace({ run, conversations, knowledgeProposal, canvasNames = {}, sourceRefs, onSourceRefs, onBack, onApply, onApplySelected, onDiscard, onViewChanges, onRetry, onCancel, onConfigureAI, onAuthorize, onSelectSources, queuedBehindReview = false, onOpenConversation }: {
  run: OrganizationRun; conversations: Conversation[]; sourceRefs: SourceRef[] | null; onSourceRefs: (refs: SourceRef[] | null) => void;
  knowledgeProposal?: KnowledgeProposal | null; canvasNames?: Record<string, string>;
  onBack: () => void; onApply: () => void; onApplySelected?: (selection: { canvasIds: ReadonlySet<string>; conversationIds: ReadonlySet<string> }) => void; onDiscard: () => void; onViewChanges: () => void; onRetry: () => void; onCancel: () => void; onConfigureAI?: () => void; onAuthorize?: () => void; onSelectSources?: () => void; queuedBehindReview?: boolean;
  onOpenConversation: (id: string, message?: ConversationMessage) => void;
}) {
  const { locale } = usePreferences();
  const zh = locale === "zh-CN";
  const [showChanges, setShowChanges] = useState(false);
  const [readingError, setReadingError] = useState(false);
  const openPartial = async (conversationId: string, questionId: string) => {
    setReadingError(false);
    try {
      const messages = await getMessagesForConversation(conversationId);
      const question = messages.find((message) => message.id === questionId.replace(/^conversation-message-/u, ""));
      if (!question) throw new Error("Source unavailable");
      onOpenConversation(conversationId, question);
    } catch { setReadingError(true); }
  };
  const canvasIds = useMemo(() => [...new Set([...(knowledgeProposal?.canvases ?? []).map((item) => item.id), ...(knowledgeProposal?.memberships ?? []).map((item) => item.canvasId)])], [knowledgeProposal]);
  const conversationIds = useMemo(() => (run.conversationProposals ?? []).map((item) => item.conversationId), [run.conversationProposals]);
  const [selectedCanvasIds, setSelectedCanvasIds] = useState<Set<string>>(() => new Set(canvasIds));
  const [selectedConversationIds, setSelectedConversationIds] = useState<Set<string>>(() => new Set(conversationIds));
  useEffect(() => { setSelectedCanvasIds(new Set(canvasIds)); }, [canvasIds]);
  useEffect(() => { setSelectedConversationIds(new Set(conversationIds)); }, [conversationIds]);
  const partialSelection = selectedCanvasIds.size < canvasIds.length || selectedConversationIds.size < conversationIds.length;
  const selectedCount = selectedCanvasIds.size + selectedConversationIds.size;
  const toggleSelection = (id: string, conversation: boolean) => {
    const setter = conversation ? setSelectedConversationIds : setSelectedCanvasIds;
    setter((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  };
  const demoUnavailable = ["DEMO_QUOTA_EXHAUSTED", "DEMO_BUDGET_EXHAUSTED", "DEMO_UNAVAILABLE", "DEMO_NOT_CONFIGURED", "DEMO_SERVICE_NOT_DEPLOYED", "DEMO_CONNECTION_FAILED", "DEMO_SESSION_TIMEOUT", "DEMO_REQUEST_TIMEOUT", "DEMO_INVALID_RESPONSE", "DEMO_HTTP_ERROR"].includes(run.errorCode ?? "") || /体验额度已用完|Demo AI 暂时不可用|ChatAtlas AI 共享额度不足|ChatAtlas AI 服务暂时不可用/iu.test(run.error ?? "");
  const budgetCanAdjustSources = run.errorCode === "DEMO_BUDGET_EXHAUSTED" && run.targetType === "knowledge_space" && Boolean(onSelectSources);
  const failure = demoUnavailable || run.errorCode === "DEMO_SERVICE_OUTDATED"
    ? { title: zh ? "请连接自己的 AI" : "Connect your AI", detail: zh ? "这项旧任务使用的共享服务已停用。连接自己的 API 后重试，已有成果和记录保留。" : "This older task used a retired shared service. Connect your API to retry; saved results and records remain available." }
      : ["PROVIDER_TIMEOUT", "PROVIDER_BUSY", "RATE_LIMITED", "REQUEST_IN_PROGRESS", "PROVIDER_ERROR"].includes(run.errorCode ?? "")
      ? { title: zh ? "模型暂时繁忙" : "The model is busy", detail: zh ? "已自动重试，模型仍未完成。这项任务可以继续重试，已经完成的分析会复用。" : "Automatic retries did not complete. Retry this task; completed analysis will be reused." }
      : ["PAYLOAD_TOO_LARGE", "INVALID_REQUEST", "PROVIDER_INVALID_RESPONSE"].includes(run.errorCode ?? "")
      ? { title: zh ? "分析请求需要调整" : "Analysis request needs attention", detail: run.error ?? "" }
      : /Configure an AI provider first/iu.test(run.error ?? "")
    ? { title: zh ? "先连接 AI 模型" : "Connect an AI model", detail: zh ? "在 AI 设置中完成配置后，即可从这里重试整理。" : "Set up a model in AI settings, then retry this task." }
    : /provider access is missing/iu.test(run.error ?? "")
      ? { title: zh ? "需要授权模型访问" : "Model access required", detail: zh ? "授权当前服务商后，继续这项整理。" : "Allow access to the current provider, then continue." }
      : /selected conversations are no longer available/iu.test(run.error ?? "")
        ? { title: zh ? "部分来源已不可用" : "Some sources are unavailable", detail: zh ? "重新选择对话来源后再试。" : "Choose the source conversations again, then retry." }
        : { title: zh ? "整理暂时中断" : "Organization paused", detail: run.error ?? "" };
  return <div className="organization-workspace">
    <WorkspaceBackButton className="organization-back" onClick={onBack} />
    <main className="organization-main"><div className="organization-reading">
      <header className="organization-header"><div><p className="eyebrow">{run.targetType === "conversation" ? zh ? "单条对话 · 章节结构" : "Conversation · Chapters" : zh ? "知识空间 · 材料与阅读目录" : "Knowledge space · Sources and contents"}</p><h1>{run.title}</h1><div className="organization-stage"><span className={`organization-status organization-status-${run.status}`}><TaskProgressMark run={run} />{run.status === "running" ? zh ? stageLabels[run.stage][1] : stageLabels[run.stage][0] : run.status === "waiting_review" ? zh ? "等待审核" : "Ready for review" : run.status === "queued" ? zh ? "等待中" : "Queued" : run.status === "failed" ? zh ? "需要处理" : "Needs attention" : run.status === "cancelled" ? zh ? "已取消" : "Cancelled" : zh ? "已完成" : "Completed"}</span>{run.status === "running" && run.work?.total ? <span className="organization-work-count">{run.work.current}/{run.work.total}</span> : null}<span>{run.targetIds.length} {zh ? "条对话" : run.targetIds.length === 1 ? "conversation" : "conversations"}</span></div></div><div className="organization-header-progress">{run.status === "running" || run.status === "queued" ? <button type="button" className="task-cancel" onClick={onCancel}>{zh ? "取消" : "Cancel"}</button> : null}</div></header>
      {run.targetType === "conversation" && run.partialChapters?.length && ["running", "failed", "cancelled"].includes(run.status) ? <section className="organization-change-list" aria-label={zh ? "已可阅读的章节" : "Chapters ready to read"}>
        <h2>{zh ? "先读已整理的部分" : "Start reading"}</h2>
        <p>{run.status === "running" ? zh ? "目录仍在整理，章节可能调整。可以先阅读原始讨论；现有整理不会被覆盖。" : "The outline is still being organized and may change. Read the original discussion now; your saved structure is unchanged." : zh ? "整理尚未完成，以下为部分目录，可以阅读对应原文。" : "Organization is incomplete. These partial chapters link to the original discussion."}</p>
        <ol>{run.partialChapters.map((chapter) => <li key={chapter.id}><button type="button" onClick={() => void openPartial(chapter.conversationId, chapter.questionIds[0])}>{chapter.title}</button><small> · {chapter.questionIds.length} {zh ? "个问题" : "questions"}</small></li>)}</ol>
        {readingError ? <p role="alert">{zh ? "暂时无法定位原文，请重试。" : "Could not locate the discussion. Please retry."}</p> : null}
      </section> : null}
      {run.status === "waiting_review" && run.targetType === "conversation" && run.replacesUserEdited ? <p className="organization-review-warning">{zh ? "这段对话已有手动整理。应用 AI 建议将替换现有画布，请先查看建议章节；原始对话不会改变。" : "This conversation has manual edits. Applying the AI proposal will replace its canvas. Review the proposed chapters first; the original conversation remains unchanged."}</p> : null}
      {run.status === "waiting_review" && knowledgeProposal?.analysisWarnings ? <p className="organization-review-warning">{zh ? `有 ${knowledgeProposal.analysisWarnings} 项可选核对未完成。请先审核建议的概念和关系，再决定是否应用。` : `${knowledgeProposal.analysisWarnings} optional checks did not finish. Review the proposed concepts and relationships before applying.`}</p> : null}
      {run.status === "queued" && queuedBehindReview ? <p className="organization-blocked-note">{zh ? "等待前一项知识空间整理完成审核，之后会自动继续。" : "Waiting for review of the previous Knowledge Space proposal. This task will then continue automatically."}</p> : null}
      {run.status === "waiting_review" ? <section className="organization-review"><h2>◇ {zh ? "整理完成，等待确认" : "Ready for review"}</h2>{onApplySelected && canvasIds.length + conversationIds.length > 1 ? <section className="organization-select-list" aria-label={zh ? "选择要应用的变更" : "Choose changes to apply"}><h3>{zh ? "选择应用范围" : "Apply scope"}</h3>{canvasIds.map((id) => <label key={id}><input type="checkbox" checked={selectedCanvasIds.has(id)} onChange={() => toggleSelection(id, false)} /><span>{knowledgeProposal?.canvases.find((canvas) => canvas.id === id)?.title ?? canvasNames[id] ?? id}</span><small>{zh ? "知识领域" : "Knowledge domain"}</small></label>)}{conversationIds.map((id) => <label key={id}><input type="checkbox" checked={selectedConversationIds.has(id)} onChange={() => toggleSelection(id, true)} /><span>{conversations.find((item) => item.id === id)?.title ?? id}</span><small>{zh ? "对话结构" : "Conversation structure"}</small></label>)}</section> : null}{run.conversationProposals?.length ? <div className="organization-change-list"><h3>{zh ? "对话画布建议" : "Conversation canvas changes"}</h3>{run.conversationProposals.map(({ conversationId, graph, replacesUserEdited }) => <details key={conversationId}><summary><span>{conversations.find((item) => item.id === conversationId)?.title ?? conversationId}</span><small>{graph.chapters?.length ?? 0} {zh ? "个章节" : "chapters"}{replacesUserEdited ? zh ? " · 将替换手动结构" : " · replaces manual structure" : ""}</small></summary><ol>{graph.chapters?.map((chapter) => <li key={chapter.id}><span>{chapter.title}</span><small>{chapter.questionIds.length} {zh ? "个问题" : "questions"}</small></li>)}</ol></details>)}</div> : null}{run.conversationProposals?.some((item) => item.replacesUserEdited) ? <p className="organization-review-warning">{zh ? "部分对话画布已有手动编辑。应用后将使用上方的 AI 章节结构替换，请先审核。" : "Some conversation canvases have manual edits. Applying will replace their structure with the chapters above; review them first."}</p> : null}<div className="organization-summary">{[
        [zh ? "新增概念" : "Concepts", run.summary?.conceptsAdded], [zh ? "合并概念" : "Merges", run.summary?.conceptsMerged], [zh ? "新增关系" : "Relations", run.summary?.relationsAdded], ["Bridge", run.summary?.bridgesAdded], ["Insight", run.summary?.insightsAdded], ["Draft", run.summary?.draftsSuggested],
      ].filter((item) => typeof item[1] === "number" && Number(item[1]) > 0).map(([label, value]) => <div key={label}><strong>{value}</strong><span>{label}</span></div>)}</div><div className="organization-actions"><button type="button" onClick={() => { if (run.targetType === "conversation") setShowChanges((current) => !current); else onViewChanges(); }}>{zh ? "查看变更" : "View changes"}</button><button type="button" className="primary" disabled={Boolean(onApplySelected && canvasIds.length + conversationIds.length > 1 && selectedCount === 0)} onClick={() => partialSelection && onApplySelected ? onApplySelected({ canvasIds: selectedCanvasIds, conversationIds: selectedConversationIds }) : onApply()}>{partialSelection ? zh ? "应用所选" : "Apply selected" : zh ? "应用全部" : "Apply all"}</button><button type="button" onClick={onDiscard}>{zh ? "放弃" : "Discard"}</button></div>{showChanges && run.proposalGraph ? <div className="organization-change-list"><h3>{zh ? "建议章节" : "Proposed chapters"}</h3>{run.proposalGraph.chapters?.map((chapter) => <div key={chapter.id}><span>{chapter.title}</span><small>{chapter.questionIds.length} {zh ? "个问题" : "questions"}</small></div>)}</div> : null}</section> : null}
      {run.status === "failed" ? <section className="organization-error" role="alert"><div className="organization-error-mark" aria-hidden="true">!</div><div>
        <h2>{failure.title}</h2><p>{failure.detail}</p>
        {run.errorCode ? <small>{zh ? "错误代码" : "Error code"}：{run.errorCode}</small> : null}
        <div className="organization-error-actions">
          {budgetCanAdjustSources ? <button type="button" className="primary" onClick={onSelectSources}>{zh ? "调整对话来源" : "Adjust conversations"}</button> : null}
          {onAuthorize && /provider access is missing/iu.test(run.error ?? "") ? <button type="button" className="primary" onClick={onAuthorize}>{zh ? "授权访问并重试" : "Grant access and retry"}</button>
            : onConfigureAI && demoUnavailable ? <button type="button" className={budgetCanAdjustSources ? undefined : "primary"} onClick={onConfigureAI}>{zh ? "连接自己的 AI" : "Connect your own AI"}</button>
            : onConfigureAI && /provider|settings|permission|access|configure/iu.test(run.error ?? "") ? <button type="button" className="primary" onClick={onConfigureAI}>{zh ? "打开 AI 设置" : "Open AI settings"}</button>
            : onSelectSources && /selected conversations are no longer available/iu.test(run.error ?? "") ? <button type="button" className="primary" onClick={onSelectSources}>{zh ? "重新选择来源" : "Select sources again"}</button> : null}
          <button type="button" onClick={onRetry}>{zh ? "重试整理" : "Retry task"}</button>
        </div>
      </div></section> : null}
      {run.events.some((event) => event.type !== "proposal_ready" && event.type !== "completed") ? <section className="organization-activity"><div className="organization-activity-heading"><h2>{zh ? "整理发现" : "Discoveries"}</h2><span>{run.events.filter((event) => event.type !== "proposal_ready" && event.type !== "completed").length}</span></div><div className="organization-minutes">{run.events.map((event, index) => <TaskEvent key={`${event.type}:${"title" in event ? event.title : "message" in event ? event.message : index}`} event={event} onOpenSources={onSourceRefs} />)}</div></section> : null}
    </div></main>
    {sourceRefs?.length ? <SourceDetail refs={sourceRefs} conversations={conversations} onClose={() => onSourceRefs(null)} onOpenConversation={onOpenConversation} /> : null}
  </div>;
}
