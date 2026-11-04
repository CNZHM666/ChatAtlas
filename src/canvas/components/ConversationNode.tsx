import { useState } from "react";
import { ChevronDown, ChevronRight, GitBranch, Minus, Pencil, Plus, Trash2 } from "lucide-react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import type { ConversationGraphNode } from "../../shared/types";
import { useConversationCanvasActions } from "../conversation-canvas-context";
import { usePreferences } from "../preferences";
import { SemanticCard } from "./SemanticCard";

export type ConversationFlowNode = Node<ConversationGraphNode & Record<string, unknown>, "conversation-node">;

export function ConversationNode({ data, selected }: NodeProps<ConversationFlowNode>) {
  const { editable, collapsedIds, toggleCollapsed, renameNode, createBranch, deleteNode, selectNode } = useConversationCanvasActions();
  const { t, locale } = usePreferences();
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(data.title);
  const [creationOpen, setCreationOpen] = useState(false);
  const collapsed = data.kind === "chapter" ? Boolean(data.chapterCollapsed) : collapsedIds.has(data.id);
  const finishRename = () => {
    const next = draft.trim();
    if (next) renameNode(data.id, next);
    else setDraft(data.title);
    setRenaming(false);
  };

  return (
    <SemanticCard kind={data.kind} selected={selected} className="conversation-node">
      <Handle id="left-target" type="target" position={Position.Left} className="conversation-handle" />
      <Handle id="right-target" type="target" position={Position.Right} className="conversation-handle alternate-handle" />
      <Handle id="top-target" type="target" position={Position.Top} className="conversation-handle alternate-handle" />
      <Handle id="bottom-target" type="target" position={Position.Bottom} className="conversation-handle alternate-handle" />
      <div className="conversation-node-kicker">
        <span>{data.kind === "chapter" ? String((data.chapterOrder as number | undefined ?? 0) + 1).padStart(2, "0") : data.kind === "conversation-root" ? t("conversationRoot") : data.kind === "bridge" ? t("bridgeCard") : data.kind === "insight" ? "💡 洞察" : data.kind === "draft" ? "✎ 待补充" : data.kind === "topic" ? t("topicCard") : t("questionCard")}</span>
      </div>
      {renaming ? (
        <input
          className="conversation-node-title-input nodrag"
          value={draft}
          autoFocus
          onChange={(event) => setDraft(event.target.value)}
          onBlur={finishRename}
          onKeyDown={(event) => {
            if (event.key === "Enter") finishRename();
            if (event.key === "Escape") { setDraft(data.title); setRenaming(false); }
          }}
        />
      ) : <h2 title={data.kind === "question" ? data.title : undefined}>{data.kind === "question" ? data.displayTitle ?? data.title : data.title}</h2>}
      {data.kind !== "question" && data.kind !== "chapter" && data.description ? <p>{data.description}</p> : null}
      {data.kind === "chapter" ? <span className="chapter-count">{data.chapterQuestionCount as number} {locale === "zh-CN" ? "个问题" : "questions"}</span> : null}
      {data.kind === "chapter" && editable ? <span className="chapter-card-actions nodrag">
        {(data.chapterQuestionCount as number) > 0 ? <button type="button" className="node-action" aria-label={collapsed ? t("expandBranch") : t("collapseBranch")} aria-expanded={!collapsed} onClick={(event) => { event.stopPropagation(); toggleCollapsed(data.id); }} title={collapsed ? t("expandBranch") : t("collapseBranch")}>{collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}</button> : null}
        <button type="button" className="node-action" onClick={(event) => { event.stopPropagation(); setDraft(data.title); setRenaming(true); }} title={t("renameNode")}><Pencil size={13} /></button>
        <button type="button" className="node-action danger" onClick={(event) => { event.stopPropagation(); deleteNode(data.id); }} title={t("deleteNode")}><Trash2 size={13} /></button>
      </span> : null}
      {data.kind === "question" ? editable ? <button type="button" className="answer-preview-toggle nodrag" onClick={(event) => { event.stopPropagation(); selectNode(data.id); }}>{data.answerPreview ? <>{t("aiAnswer")} · {data.answerCharCount ?? data.answerPreview.length} {t("characters")}</> : t("noAnswerCaptured")}</button> : <span className="answer-preview-toggle" title={data.answerPreview}>{data.answerPreview ? <>{t("aiAnswer")} · {data.answerCharCount ?? data.answerPreview.length} {t("characters")}</> : t("noAnswerCaptured")}</span> : null}
      {data.kind !== "bridge" && data.kind !== "chapter" && data.kind !== "insight" && data.kind !== "draft" && editable ? <footer>
        {data.hasChildren ? <button type="button" className="node-action nodrag" aria-label={collapsed ? t("expandBranch") : t("collapseBranch")} aria-expanded={!collapsed} onClick={(event) => { event.stopPropagation(); toggleCollapsed(data.id); }} title={collapsed ? t("expandBranch") : t("collapseBranch")}>
          {collapsed ? <Plus size={14} /> : <Minus size={14} />}
        </button> : null}
        {editable ? (
          <span className="conversation-node-actions">
            <button type="button" className="node-action nodrag" onClick={() => { setDraft(data.title); setRenaming(true); }} title={t("renameNode")}><Pencil size={13} /></button>
            <span className="node-menu-anchor">
              <button type="button" className="node-action nodrag" onClick={() => setCreationOpen((value) => !value)} title={t("newBranch")}><GitBranch size={13} /></button>
              {creationOpen ? <span className="node-create-menu nodrag"><button onClick={() => { createBranch(data.id, "topic"); setCreationOpen(false); }}>{t("topicCard")}</button><button onClick={() => { createBranch(data.id, "bridge"); setCreationOpen(false); }}>{t("bridgeCard")}</button></span> : null}
            </span>
            {data.kind !== "conversation-root" ? <button type="button" className="node-action danger nodrag" onClick={() => deleteNode(data.id)} title={t("deleteNode")}><Trash2 size={13} /></button> : null}
          </span>
        ) : <span className="conversation-node-open-hint">{data.kind !== "question" && data.sourceCreatedAt ? new Intl.DateTimeFormat(locale, { month: "short", day: "numeric" }).format(data.sourceCreatedAt) : ""}</span>}
      </footer> : null}
      {(data.kind === "bridge" || data.kind === "insight" || data.kind === "draft") && editable ? <div className="bridge-inline-actions nodrag">
        <button className="node-action" onClick={() => { setDraft(data.title); setRenaming(true); }} title={t("renameNode")}><Pencil size={12} /></button>
        <button className="node-action danger" onClick={() => deleteNode(data.id)} title={t("deleteNode")}><Trash2 size={12} /></button>
      </div> : null}
      <Handle id="right-source" type="source" position={Position.Right} className="conversation-handle" />
      <Handle id="left-source" type="source" position={Position.Left} className="conversation-handle alternate-handle" />
      <Handle id="bottom-source" type="source" position={Position.Bottom} className="conversation-handle alternate-handle" />
      <Handle id="top-source" type="source" position={Position.Top} className="conversation-handle alternate-handle" />
    </SemanticCard>
  );
}
