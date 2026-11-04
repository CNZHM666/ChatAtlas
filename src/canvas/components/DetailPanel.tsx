import { ArrowUpRight, ChevronDown, ChevronRight, MessageSquareText, PanelRightClose, Pencil, Plus, StickyNote, Tag } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { CanvasCard, Conversation, MessageAnchor } from "../../shared/types";
import { usePreferences } from "../preferences";

interface DetailPanelProps {
  card: CanvasCard;
  anchors: MessageAnchor[];
  conversations: Conversation[];
  editMode: boolean;
  focusSourcesNonce?: number;
  onClose: () => void;
  onOpenConversation: (id: string) => void;
  onAddSource: (id: string) => void;
  onNotesChange: (notes: string) => void;
  onNotesBlur: () => void;
  onConvertCard?: (kind: "concept" | "note" | "bridge" | "insight") => void;
  onAnchor: (anchor: MessageAnchor) => void;
}

export function DetailPanel({ card, anchors, conversations, editMode, focusSourcesNonce, onClose, onOpenConversation, onAddSource, onNotesChange, onNotesBlur, onConvertCard, onAnchor }: DetailPanelProps) {
  const { t } = usePreferences();
  const [editingNotes, setEditingNotes] = useState(false);
  const [expandedSourceId, setExpandedSourceId] = useState<string | null>(conversations[0]?.id ?? null);
  const sourcesRef = useRef<HTMLElement>(null);
  useEffect(() => { if (focusSourcesNonce) sourcesRef.current?.scrollIntoView({ block: "start", behavior: "smooth" }); }, [focusSourcesNonce]);
  const unifiedContent = card.origin === "user" && card.kind !== "conversation";
  const kindLabel = unifiedContent && card.kind === "concept" ? t("knowledgeCard") : card.kind === "conversation" ? t("source") : card.kind === "bridge" ? t("bridgeCard") : card.kind === "insight" ? t("insightCard") : card.kind === "draft" ? "待补充" : card.kind === "note" ? t("noteCard") : t("topicCard");
  const content = unifiedContent ? card.notes ?? card.description ?? "" : card.notes ?? "";
  return (
    <aside className="detail-panel" aria-label={t("cardDetails")}>
      <div className="panel-heading">
        <div>
          <span className="eyebrow">{kindLabel}</span>
          <h2>{card.title}</h2>
        </div>
        <button className="icon-button" onClick={onClose} title={t("close")} aria-label={t("close")}><PanelRightClose size={18} /></button>
      </div>
      {card.description && !unifiedContent ? <p className="panel-description">{card.description}</p> : null}
      {unifiedContent || card.kind === "topic" || card.kind === "concept" || card.kind === "note" || card.kind === "draft" ? <section className="topic-notes">
        <div className="topic-notes-heading"><h3><StickyNote size={16} />{unifiedContent ? t("cardContent") : card.kind === "draft" ? "我的理解" : t("myNotes")}</h3>{!editMode && !editingNotes ? <button onClick={() => setEditingNotes(true)}><Pencil size={13} />{content.trim() ? t("editNote") : t("addNote")}</button> : !editMode ? <button onClick={() => { onNotesBlur(); setEditingNotes(false); }}>{t("done")}</button> : null}</div>
        {editMode || editingNotes ? <><textarea autoFocus={editingNotes} value={content} onChange={(event) => onNotesChange(event.target.value)} onBlur={onNotesBlur} placeholder={card.kind === "draft" ? "添加你的理解…" : t("notePlaceholder")} aria-label={unifiedContent ? t("cardContent") : card.kind === "draft" ? "我的理解" : t("myNotes")} rows={8} /><p>{t(unifiedContent ? "contentLocalHint" : "notesLocalHint")}</p></> : <div className={`topic-note-readonly ${content.trim() ? "" : "is-empty"}`}>{content.trim() || (card.kind === "draft" ? "添加你的理解…" : t("noNotesYet"))}</div>}
      </section> : null}
      {unifiedContent && onConvertCard && editMode ? <label className="card-role-picker">{t("cardRole")}<select value={card.kind === "note" || card.kind === "bridge" || card.kind === "insight" ? card.kind : "concept"} onChange={(event) => onConvertCard(event.target.value as "concept" | "note" | "bridge" | "insight")}><option value="concept">{t("knowledgeCard")}</option><option value="note">{t("noteCard")}</option><option value="bridge">{t("bridgeCard")}</option><option value="insight">{t("insightCard")}</option></select></label> : null}
      {(card.kind === "topic" || card.kind === "concept" || conversations.length > 0 || anchors.length > 0) ? <section className="panel-sources" ref={sourcesRef}>
        <div className="panel-section-heading"><h3>{t("sources")} · {conversations.length}{anchors.length ? ` ${t("sourceCountUnit")} · ${anchors.length} ${t("quoteCountUnit")}` : ""}</h3>{editMode && (card.kind === "topic" || card.kind === "concept") ? <button onClick={() => onAddSource(card.id)} title={t("addSource")}><Plus size={14} />{t("addSource")}</button> : null}</div>
        {conversations.length ? <div className="source-tree">{conversations.map((conversation) => {
          const sourceAnchors = anchors.filter((anchor) => anchor.conversationId === conversation.id);
          const expanded = expandedSourceId === conversation.id;
          return <div className="source-tree-group" key={conversation.id}>
            <div className="source-tree-row">
              <button className="source-tree-toggle" onClick={() => setExpandedSourceId(expanded ? null : conversation.id)} aria-expanded={expanded} aria-label={expanded ? t("collapseSource") : t("expandSource")}>{expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}</button>
              <button className="source-tree-title" onClick={() => onOpenConversation(conversation.id)} title={t("openConversationCanvas")}><MessageSquareText size={15} /><span>{conversation.title}</span><ArrowUpRight size={13} /></button>
              {sourceAnchors.length ? <small>{sourceAnchors.length} {t("quoteCountUnit")}</small> : null}
            </div>
            {expanded ? <div className="source-tree-children">{sourceAnchors.length ? sourceAnchors.map((anchor) => <button key={anchor.id} onClick={() => onAnchor(anchor)} title={t("openConversationCanvas")}><span>{anchor.preview}</span><ArrowUpRight size={13} /></button>) : <p>{t("noQuotedMessages")}</p>}</div> : null}
          </div>;
        })}</div> : <p className="panel-sources-empty">{t(editMode ? "noSourcesYet" : "noSourcesBrowse")}</p>}
      </section> : null}
      {card.tags.length ? <section className="panel-tags"><h3>{t("tags")}</h3><div className="tag-row"><Tag size={14} />{card.tags.map((tag) => <span key={tag}>{tag}</span>)}</div></section> : null}
    </aside>
  );
}
