import { useState } from "react";
import type { AtlasCanvas, CanvasCard, Conversation, MessageAnchor } from "../../shared/types";
import { recommendedReadingPath } from "../reader-path";
import type { CanvasEdge } from "../../shared/types";
import { DetailPanel } from "./DetailPanel";
import { KnowledgeReader } from "./KnowledgeReader";
import { ReadingPathEditor } from "./ReadingPathEditor";

export function ReadingSession({ card, space, cards, edges, sources, anchors, previous, next, related, mode, initialMessageId, sourceFocusNonce, onSelectCard, onClose, onSavePath, onNotesChange, onNotesBlur, onOpenConversation, onAddSource, onConvertCard, onAnchor, onProgress }: {
  card: CanvasCard;
  space?: AtlasCanvas;
  cards: CanvasCard[];
  edges: CanvasEdge[];
  sources: Conversation[];
  anchors: MessageAnchor[];
  previous: CanvasCard[];
  next: CanvasCard[];
  related: Array<{ card: CanvasCard; label?: string }>;
  mode: "browse" | "edit";
  initialMessageId?: string;
  sourceFocusNonce?: number;
  onSelectCard: (id: string) => void;
  onClose: () => void;
  onSavePath: (ids: string[]) => Promise<void>;
  onNotesChange: (notes: string) => void;
  onNotesBlur: () => void;
  onOpenConversation: (id: string) => void;
  onAddSource: (id: string) => void;
  onConvertCard?: (kind: "concept" | "note" | "bridge" | "insight") => void;
  onAnchor: (anchor: MessageAnchor) => void;
  onProgress: () => void;
}) {
  const [editingPath, setEditingPath] = useState(false);
  const path = space?.readingPathCardIds?.length ? space.readingPathCardIds : recommendedReadingPath(cards, edges).map((item) => item.id);
  if (editingPath && space) return <ReadingPathEditor cards={cards} initialPath={path} onClose={() => setEditingPath(false)} onSave={async (ids) => { await onSavePath(ids); setEditingPath(false); }} />;
  if (mode === "browse" && card.kind !== "conversation" && card.kind !== "portal") return <KnowledgeReader key={`${card.id}:${initialMessageId ?? ""}`} card={card} anchors={anchors} conversations={sources} previous={previous} next={next} related={related} onSelectCard={onSelectCard} onClose={onClose} onEditPath={cards.length > 1 ? () => setEditingPath(true) : undefined} initialMessageId={initialMessageId} onNotesChange={onNotesChange} onNotesBlur={onNotesBlur} onProgress={onProgress} />;
  return <DetailPanel key={card.id} card={card} anchors={anchors} conversations={sources} editMode={mode === "edit"} focusSourcesNonce={sourceFocusNonce} onClose={onClose} onOpenConversation={onOpenConversation} onAddSource={onAddSource} onNotesChange={onNotesChange} onNotesBlur={onNotesBlur} onConvertCard={onConvertCard} onAnchor={onAnchor} />;
}
