import { ArrowUpRight, Link2, MessageSquareText, Minus, Pencil, Plus } from "lucide-react";
import { useState } from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import type { CanvasCard } from "../../shared/types";
import { useCanvasNodeActions } from "../canvas-context";
import { libraryConversationDragType, parseLibraryConversationDrag } from "../conversation-graph";
import { usePreferences } from "../preferences";
import { SemanticCard } from "./SemanticCard";

export type CanvasCardNode = Node<CanvasCard & Record<string, unknown>, "canvas-card">;

export function CanvasCardNode({ data, selected }: NodeProps<CanvasCardNode>) {
  const { editable, collapsedIds, toggleCollapsed, openCard, renameCard, attachedConversations, expandedAttachments, toggleAttachments, attachConversation, chooseConversationToAttach, openSources, hoveredTopicId } = useCanvasNodeActions();
  const { t, locale } = usePreferences();
  const collapsed = collapsedIds.has(data.id);
  const [dropTarget, setDropTarget] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [draftTitle, setDraftTitle] = useState(data.title);
  const attachments = attachedConversations[data.id] ?? [];
  const isTopic = data.kind === "topic" || data.kind === "concept";
  const isPortal = data.kind === "portal";
  const attachmentCount = Math.max(attachments.length, data.conversationIds.length);
  const realAnchorCount = data.anchorIds.filter((id) => !id.startsWith(`${data.id}-anchor-`)).length;

  return (
    <SemanticCard
      kind={data.kind}
      selected={selected}
      className={`canvas-card ${dropTarget || hoveredTopicId === data.id ? "is-drop-target" : ""}`}
      aria-label={`${data.title} card`}
      onDragOver={editable && isTopic ? (event) => { if (event.dataTransfer.types.includes(libraryConversationDragType)) { event.preventDefault(); setDropTarget(true); } } : undefined}
      onDragLeave={isTopic ? (event) => { if (!event.currentTarget.contains(event.relatedTarget as globalThis.Node)) setDropTarget(false); } : undefined}
      onDrop={editable && isTopic ? (event) => {
        setDropTarget(false);
        const payload = parseLibraryConversationDrag(event.dataTransfer.getData(libraryConversationDragType));
        if (!payload) return;
        event.preventDefault();
        event.stopPropagation();
        attachConversation(data.id, payload.conversationId);
      } : undefined}
    >
      <Handle id="left-target" type="target" position={Position.Left} className="card-handle" />
      <Handle id="right-target" type="target" position={Position.Right} className="card-handle alternate-handle" />
      <Handle id="top-target" type="target" position={Position.Top} className="card-handle alternate-handle" />
      <Handle id="bottom-target" type="target" position={Position.Bottom} className="card-handle alternate-handle" />
      <h2>{data.kind === "conversation" ? <MessageSquareText size={15} aria-hidden /> : null}{renaming ? <input
        autoFocus
        className="canvas-card-title-input nodrag"
        value={draftTitle}
        aria-label={t("title")}
        onClick={(event) => event.stopPropagation()}
        onChange={(event) => setDraftTitle(event.target.value)}
        onBlur={() => { const next = draftTitle.trim(); if (next) renameCard(data.id, next); else setDraftTitle(data.title); setRenaming(false); }}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") { setDraftTitle(data.title); setRenaming(false); }
        }}
      /> : <>{data.title}{isPortal ? <ArrowUpRight className="portal-mark" size={13} /> : null}</>}</h2>
      {data.kind !== "conversation" && (data.description || data.kind === "draft" && data.notes) ? <p>{data.description || data.notes}</p> : null}
      {data.kind !== "bridge" && (isTopic || typeof data.sourceUpdatedAt === "number" || typeof data.sourceMessageCount === "number") ? <footer>
        {!isTopic ? <span><MessageSquareText size={12} />{typeof data.sourceUpdatedAt === "number" ? new Intl.DateTimeFormat(locale, { month: "short", day: "numeric" }).format(data.sourceUpdatedAt) : ""}{typeof data.sourceMessageCount === "number" ? `${typeof data.sourceUpdatedAt === "number" ? " · " : ""}${data.sourceMessageCount} ${t("messages")}` : ""}</span> : null}
        {isTopic && (attachmentCount || realAnchorCount) ? <button className="source-metadata nodrag" title={t("viewSources")} onClick={(event) => { event.stopPropagation(); openSources(data.id); }}><MessageSquareText size={13} />{attachmentCount} {t("sourceCardCountUnit")}{realAnchorCount ? ` · ${realAnchorCount} ${t("quoteCountUnit")}` : ""}</button> : null}
      </footer> : null}
      {isTopic ? <div className="card-drop-hint" aria-hidden="true">{t("releaseToAttach")}</div> : null}
      <div className="card-actions">
        {editable && data.kind !== "conversation" && !isPortal ? <button type="button" className="node-action nodrag" title={t("renameNode")} aria-label={t("renameNode")} onClick={(event) => { event.stopPropagation(); setDraftTitle(data.title); setRenaming(true); }}><Pencil size={13} /></button> : null}
        {editable && isTopic ? <button type="button" className="node-action nodrag" title={t("addSource")} aria-label={t("addSource")} onClick={(event) => { event.stopPropagation(); chooseConversationToAttach(data.id); }}><Link2 size={14} /></button> : null}
        {isTopic && attachments.length > 0 ? <button type="button" className="node-action nodrag" title={expandedAttachments.has(data.id) ? t("hideConnected") : t("showConnected")} aria-label={expandedAttachments.has(data.id) ? t("hideConnected") : t("showConnected")} onClick={(event) => { event.stopPropagation(); toggleAttachments(data.id); }}><MessageSquareText size={14} /></button> : null}
        <button
          type="button"
          className="node-action nodrag"
          title={collapsed ? t("expandBranch") : t("collapseBranch")}
          onClick={(event) => {
            event.stopPropagation();
            toggleCollapsed(data.id);
          }}
        >
          {collapsed ? <Plus size={14} /> : <Minus size={14} />}
        </button>
        <button
          type="button"
          className="open-card nodrag"
          title={t("open")}
          aria-label={t("open")}
          onClick={(event) => {
            event.stopPropagation();
            openCard(data.id);
          }}
        >
          <ArrowUpRight size={14} />
        </button>
      </div>
      <Handle id="right-source" type="source" position={Position.Right} className="card-handle" />
      <Handle id="left-source" type="source" position={Position.Left} className="card-handle alternate-handle" />
      <Handle id="top-source" type="source" position={Position.Top} className="card-handle alternate-handle" />
      <Handle id="bottom-source" type="source" position={Position.Bottom} className="card-handle alternate-handle" />
    </SemanticCard>
  );
}
