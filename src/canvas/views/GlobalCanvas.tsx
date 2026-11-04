import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { Check, Link2, MessageSquareText, Search, X } from "lucide-react";
import {
  Background,
  BackgroundVariant,
  ConnectionLineType,
  Controls,
  MarkerType,
  ReactFlow,
  useReactFlow,
  ViewportPortal,
  type Connection,
  type Edge,
  type NodeChange,
} from "@xyflow/react";
import type { CanvasCard, CanvasEdge, Conversation } from "../../shared/types";
import { conversationDisplayTime } from "../../shared/conversation-time";
import { saveCanvasViewport } from "../../storage/viewport";
import { CanvasNodeContext } from "../canvas-context";
import { topicConversationConnection } from "../global-attachments";
import { CanvasCardNode, type CanvasCardNode as CardNode } from "../components/CanvasCardNode";
import { OrthogonalEdge } from "../components/OrthogonalEdge";
import type { EdgeObstacle } from "../edge-geometry";
import { alignConnectedBox, cardBox, insertionSpace, snapBox, type Guide } from "../canvas-geometry";
import { libraryConversationDragType, parseLibraryConversationDrag } from "../conversation-graph";
import { usePreferences } from "../preferences";

const nodeTypes = { "canvas-card": CanvasCardNode };
const edgeTypes = { orthogonal: OrthogonalEdge };

function descendantsOf(root: string, edges: CanvasEdge[]): Set<string> {
  const hidden = new Set<string>();
  const queue = edges.filter((edge) => edge.source === root).map((edge) => edge.target);
  while (queue.length) {
    const id = queue.shift()!;
    if (hidden.has(id)) continue;
    hidden.add(id);
    queue.push(...edges.filter((edge) => edge.source === id).map((edge) => edge.target));
  }
  return hidden;
}

interface GlobalCanvasProps {
  mode: "browse" | "edit";
  canvasId: string;
  cards: CanvasCard[];
  edges: CanvasEdge[];
  selectedCardId: string | null;
  selectedEdgeId: string | null;
  focusRequest: { id: string; nonce: number } | null;
  syncComplete: boolean;
  onSelectedCard: (id: string | null) => void;
  onSelectedEdge: (id: string | null) => void;
  onPositions: (updates: Array<{ id: string; x: number; y: number }>) => void;
  onBeginDrag: () => void;
  onFinishDrag: () => void;
  onCreateEdge: (edge: CanvasEdge, alignment?: { id: string; x: number; y: number }) => void;
  onRenameCard: (id: string, title: string) => void;
  onOpenConversation: (conversationId: string) => void;
  conversations: Conversation[];
  onAttachConversation: (topicId: string, conversationId: string) => void;
  onPlaceConversation: (conversationId: string, position: { x: number; y: number }) => void;
  onCreateTopic: () => void;
  onSmartOrganize: () => void;
  onShowSources: (topicId: string) => void;
  sourcePickerRequest: { topicId: string; nonce: number } | null;
  onOpenPortal?: (canvasId: string, cardId: string) => void;
  preview?: boolean;
  onUpdateEdgeLabel?: (id: string, label: string) => void;
  onInsertBridge?: (id: string) => void;
}

export function GlobalCanvas(props: GlobalCanvasProps) {
  const { t } = usePreferences();
  const flow = useReactFlow<CardNode, Edge>();
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(() => new Set());
  const [expandedAttachments, setExpandedAttachments] = useState<Set<string>>(() => new Set());
  const [attachPickerTopicId, setAttachPickerTopicId] = useState<string | null>(null);
  const [attachQuery, setAttachQuery] = useState("");
  const [hoveredTopicId, setHoveredTopicId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [guides, setGuides] = useState<Guide[]>([]);
  const [insertionPreview, setInsertionPreview] = useState<Array<{ id: string; x: number; y: number }>>([]);
  const [conversationDropActive, setConversationDropActive] = useState(false);
  const fittedCanvas = useRef<string | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const editable = props.mode === "edit";
  const selectedEdge = props.edges.find((edge) => edge.id === props.selectedEdgeId);

  useEffect(() => { if (props.selectedCardId) setSelectedIds(new Set([props.selectedCardId])); }, [props.selectedCardId]);

  const hiddenIds = useMemo(() => {
    const hidden = new Set<string>();
    for (const id of collapsedIds) for (const descendant of descendantsOf(id, props.edges.filter((edge) => edge.relation !== "attachment"))) hidden.add(descendant);
    const attachmentSources = new Map<string, string[]>();
    for (const edge of props.edges) if (edge.relation === "attachment") attachmentSources.set(edge.target, [...attachmentSources.get(edge.target) ?? [], edge.source]);
    for (const [target, sources] of attachmentSources) if (!sources.some((source) => expandedAttachments.has(source))) hidden.add(target);
    return hidden;
  }, [collapsedIds, expandedAttachments, props.edges]);

  const pickerTopic = props.cards.find((card) => card.id === attachPickerTopicId && (card.kind === "topic" || card.kind === "concept"));
  const matchingConversations = useMemo(() => props.conversations.filter((conversation) =>
    `${conversation.title} ${conversation.summary ?? ""}`.toLocaleLowerCase().includes(attachQuery.trim().toLocaleLowerCase()),
  ).slice(0, 60), [props.conversations, attachQuery]);

  useEffect(() => {
    if (!attachPickerTopicId) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setAttachPickerTopicId(null); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [attachPickerTopicId]);

  useEffect(() => {
    if (props.sourcePickerRequest) { setAttachPickerTopicId(props.sourcePickerRequest.topicId); setAttachQuery(""); }
  }, [props.sourcePickerRequest]);

  const attachedConversations = useMemo(() => Object.fromEntries(props.cards.filter((card) => card.kind === "topic" || card.kind === "concept").map((card) => [card.id, props.edges
    .filter((edge) => edge.relation === "attachment" && edge.source === card.id)
    .map((edge) => props.cards.find((item) => item.id === edge.target))
    .filter((item): item is CanvasCard => Boolean(item))
    .map((item) => ({ id: item.conversationIds[0], title: item.title, messageCount: props.conversations.find((conversation) => conversation.id === item.conversationIds[0])?.messageCount ?? null }))])), [props.cards, props.edges, props.conversations]);

  const previewPositions = useMemo(() => new Map(insertionPreview.map((item) => [item.id, item])), [insertionPreview]);
  const nodes = useMemo<CardNode[]>(() => props.cards.map((card) => {
    const source = props.conversations.find((conversation) => conversation.id === card.conversationIds[0]);
    return {
      id: card.id,
      type: "canvas-card",
      position: previewPositions.get(card.id) ?? { x: card.x, y: card.y },
      data: { ...card, sourceMessageCount: source?.importState === "discovered" || source?.importState === "failed" ? undefined : source?.messageCount ?? undefined, sourceUpdatedAt: source ? conversationDisplayTime(source) : undefined },
      selected: selectedIds.has(card.id) || (!selectedIds.size && card.id === props.selectedCardId),
      hidden: hiddenIds.has(card.id),
    };
  }), [props.cards, props.conversations, props.selectedCardId, selectedIds, hiddenIds, previewPositions]);

  const edges = useMemo<Edge[]>(() => {
    const widths: Record<string, number> = { conversation: 184, bridge: 180, insight: 224, draft: 224, portal: 210 };
    const boxes = new Map(props.cards.map((card) => [card.id, { x: previewPositions.get(card.id)?.x ?? card.x, y: previewPositions.get(card.id)?.y ?? card.y, width: widths[card.kind] ?? 232, height: card.kind === "conversation" ? 70 : card.kind === "bridge" ? 60 : 120 }]));
    return props.edges.map((edge) => {
    const source = boxes.get(edge.source);
    const target = boxes.get(edge.target);
    const dx = source && target ? target.x + target.width / 2 - source.x - source.width / 2 : 1;
    const dy = source && target ? target.y + target.height / 2 - source.y - source.height / 2 : 0;
    const horizontal = Math.abs(dx) >= Math.abs(dy) * .85;
    const side = horizontal ? dx >= 0 ? "right" : "left" : dy >= 0 ? "bottom" : "top";
    const opposite = { right: "left", left: "right", bottom: "top", top: "bottom" }[side];
    const obstacles: EdgeObstacle[] = [...boxes].filter(([id]) => id !== edge.source && id !== edge.target && !hiddenIds.has(id)).map(([, box]) => box);
    return ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    type: "orthogonal",
    label: edge.id === props.selectedEdgeId ? edge.label : undefined,
    sourceHandle: `${side}-source`,
    targetHandle: `${opposite}-target`,
    data: { obstacles, axis: horizontal ? "horizontal" : "vertical" },
    selected: edge.id === props.selectedEdgeId,
    hidden: hiddenIds.has(edge.source) || hiddenIds.has(edge.target),
    markerEnd: edge.relation === "attachment" || edge.knowledgeRelationType === "related_to" || edge.knowledgeRelationType === "contrasts_with" ? undefined : { type: MarkerType.ArrowClosed, width: 14, height: 14 },
    className: `semantic-edge relation-${edge.relation ?? "structural"} knowledge-${edge.knowledgeRelationType ?? "general"}`,
    style: { strokeWidth: edge.id === props.selectedEdgeId ? 2 : edge.relation === "attachment" ? 1 : 1.4, strokeDasharray: edge.relation === "bridge" ? "5 5" : edge.relation === "attachment" ? "2 5" : edge.knowledgeRelationType === "contrasts_with" ? "4 4" : undefined },
  }); }); }, [props.edges, props.cards, props.selectedEdgeId, hiddenIds, previewPositions]);

  useEffect(() => {
    if (!props.focusRequest) return;
    const card = props.cards.find((item) => item.id === props.focusRequest?.id);
    if (card) void flow.setCenter(card.x + 112, card.y + 82, { zoom: 1.08, duration: 240 });
  }, [props.focusRequest, props.cards, flow]);

  useEffect(() => {
    if (!props.cards.length || fittedCanvas.current === props.canvasId) return;
    fittedCanvas.current = props.canvasId;
    const frame = requestAnimationFrame(() => {
      void flow.fitView({ padding: 0.14, minZoom: 1, maxZoom: 1.05, duration: 180 });
    });
    return () => cancelAnimationFrame(frame);
  }, [props.canvasId, props.cards.length, flow]);

  // A drawer changes the available canvas width, not the graph layout or zoom.
  // Keep the same point at the center of the remaining viewport as it animates.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || typeof ResizeObserver === "undefined") return;
    let previousWidth = stage.clientWidth;
    const observer = new ResizeObserver(() => {
      const width = stage.clientWidth;
      if (!width || !previousWidth || width === previousWidth) return;
      const delta = width - previousWidth;
      previousWidth = width;
      const viewport = flow.getViewport();
      void flow.setViewport({ ...viewport, x: viewport.x + delta / 2 });
    });
    observer.observe(stage);
    return () => observer.disconnect();
  }, [props.canvasId, flow]);

  const focusCard = (id: string) => {
    const card = props.cards.find((item) => item.id === id);
    if (!card) return;
    if (card.kind === "portal" && card.portalCanvasId && card.portalTargetCardId) {
      props.onOpenPortal?.(card.portalCanvasId, card.portalTargetCardId);
      return;
    }
    props.onSelectedCard(id);
    props.onSelectedEdge(null);
    void flow.setCenter(card.x + 112, card.y + 82, { zoom: 1.08, duration: 220 });
  };

  const openCard = (id: string) => {
    const card = props.cards.find((item) => item.id === id);
    if (card?.kind === "conversation" && card.conversationIds[0]) {
      props.onOpenConversation(card.conversationIds[0]);
      return;
    }
    focusCard(id);
  };

  const onNodesChange = (changes: NodeChange<CardNode>[]) => {
    if (!editable) return;
    const updates = changes.flatMap((change) => change.type === "position" && change.position
      ? [{ id: change.id, x: change.position.x, y: change.position.y }]
      : []);
    if (updates.length) props.onPositions(updates);
  };

  const connect = (connection: Connection) => {
    if (!editable) return;
    if (!connection.source || !connection.target || connection.source === connection.target) return;
    const attachment = topicConversationConnection(props.cards, connection.source, connection.target);
    if (attachment) {
      props.onAttachConversation(attachment.topicId, attachment.conversationId);
      setExpandedAttachments((current) => new Set(current).add(attachment.topicId));
      return;
    }
    if (props.edges.some((edge) => edge.source === connection.source && edge.target === connection.target)) return;
    const source = props.cards.find((card) => card.id === connection.source);
    const target = props.cards.find((card) => card.id === connection.target);
    const aligned = source && target ? alignConnectedBox(cardBox(source), cardBox(target), props.cards.filter((card) => !hiddenIds.has(card.id)).map(cardBox)) : null;
    props.onCreateEdge({
      id: `edge-${crypto.randomUUID()}`,
      canvasId: props.canvasId,
      source: connection.source,
      target: connection.target,
      type: "manual",
      relation: props.cards.some((card) => card.id === connection.source && card.kind === "bridge") || props.cards.some((card) => card.id === connection.target && card.kind === "bridge") ? "bridge" : "structural",
      createdAt: Date.now(),
    }, aligned && target ? { id: target.id, ...aligned } : undefined);
  };

  const placeConversation = (event: DragEvent<HTMLDivElement>) => {
    const payload = parseLibraryConversationDrag(event.dataTransfer.getData(libraryConversationDragType));
    if (!payload) return;
    event.preventDefault();
    setConversationDropActive(false);
    props.onPlaceConversation(payload.conversationId, flow.screenToFlowPosition({ x: event.clientX, y: event.clientY }));
  };

  const topicUnderSource = (node: CardNode): string | null => {
    if (node.data.kind !== "conversation") return null;
    const centerX = node.position.x + 97;
    const centerY = node.position.y + 40;
    return props.cards.find((card) => (card.kind === "topic" || card.kind === "concept") && centerX >= card.x - 20 && centerX <= card.x + 252 && centerY >= card.y - 18 && centerY <= card.y + 170)?.id ?? null;
  };

  const attachToTopic = (topicId: string, conversationId: string) => {
    if (!editable) return;
    props.onAttachConversation(topicId, conversationId);
    setExpandedAttachments((current) => new Set(current).add(topicId));
    setAttachPickerTopicId(null);
    setAttachQuery("");
  };

  return (
    <CanvasNodeContext.Provider value={{
      collapsedIds,
      toggleCollapsed: (id) => setCollapsedIds((current) => {
        const next = new Set(current);
        if (next.has(id)) next.delete(id); else next.add(id);
        return next;
      }),
      openCard: focusCard,
      renameCard: props.onRenameCard,
      attachedConversations,
      expandedAttachments,
      toggleAttachments: (id) => setExpandedAttachments((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; }),
      attachConversation: attachToTopic,
      chooseConversationToAttach: (topicId) => { setAttachPickerTopicId(topicId); setAttachQuery(""); },
      openSources: props.onShowSources,
      hoveredTopicId,
      editable,
    }}>
      <div
        ref={stageRef}
        className={`canvas-stage mode-${props.mode} ${props.preview ? "is-preview" : ""}`}
        onDragOver={(event) => {
          if (!event.dataTransfer.types.includes(libraryConversationDragType)) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
          if (!props.cards.length) setConversationDropActive(true);
        }}
        onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as globalThis.Node)) setConversationDropActive(false); }}
        onDrop={placeConversation}
      >
        <ReactFlow<CardNode, Edge>
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodesChange={onNodesChange}
          onConnect={connect}
          onNodeDragStart={() => { if (editable) props.onBeginDrag(); }}
          onNodeDrag={(_event, node, dragged) => {
            if (!editable) return;
            setHoveredTopicId(topicUnderSource(node));
            const movingIds = new Set((dragged.length ? dragged : [node]).map((item) => item.id));
            const others = props.cards.filter((item) => !hiddenIds.has(item.id) && !movingIds.has(item.id) && Math.abs(item.x - node.position.x) < 520 && Math.abs(item.y - node.position.y) < 400).map(cardBox);
            setGuides(snapBox({ id: node.id, x: node.position.x, y: node.position.y, width: node.measured?.width ?? 232, height: node.measured?.height ?? 128 }, others).guides);
            setInsertionPreview(movingIds.size > 1 ? [] : insertionSpace({ id: node.id, x: node.position.x, y: node.position.y, width: node.measured?.width ?? 232, height: node.measured?.height ?? 128 }, others));
          }}
          onNodeDragStop={(_event, node, dragged) => {
            if (!editable) return;
            setGuides([]);
            setInsertionPreview([]);
            const others = props.cards.filter((item) => !hiddenIds.has(item.id) && item.id !== node.id && !dragged.some((moving) => moving.id === item.id) && Math.abs(item.x - node.position.x) < 520 && Math.abs(item.y - node.position.y) < 400).map(cardBox);
            const snapped = snapBox({ id: node.id, x: node.position.x, y: node.position.y, width: node.measured?.width ?? 232, height: node.measured?.height ?? 128 }, others);
            const moved = dragged.length ? dragged : [node];
            const movingUpdates = moved.map((item) => ({ id: item.id, x: item.position.x + snapped.x - node.position.x, y: item.position.y + snapped.y - node.position.y }));
            const spacing = moved.length === 1 ? insertionSpace({ id: node.id, x: snapped.x, y: snapped.y, width: node.measured?.width ?? 232, height: node.measured?.height ?? 128 }, others) : [];
            props.onPositions([...movingUpdates, ...spacing]);
            props.onFinishDrag();
            const topicId = topicUnderSource(node);
            setHoveredTopicId(null);
            if (topicId && node.data.conversationIds[0]) {
              props.onAttachConversation(topicId, node.data.conversationIds[0]);
              setExpandedAttachments((current) => new Set(current).add(topicId));
            }
          }}
          onNodeClick={(_event, node) => {
            if (editable && _event.shiftKey) {
              setSelectedIds((current) => { const next = new Set(current); if (next.has(node.id)) next.delete(node.id); else next.add(node.id); return next; });
              props.onSelectedCard(null);
            } else {
              setSelectedIds(new Set([node.id])); props.onSelectedCard(node.id);
            }
            props.onSelectedEdge(null);
          }}
          onNodeDoubleClick={(_event, node) => openCard(node.id)}
          onSelectionChange={({ nodes: selection }) => {
            if (!editable || selection.length < 2) return;
            const ids = new Set(selection.map((item) => item.id));
            setSelectedIds((current) => current.size === ids.size && [...current].every((id) => ids.has(id)) ? current : ids);
            props.onSelectedCard(null);
          }}
          onEdgeClick={(_event, edge) => { props.onSelectedEdge(edge.id); props.onSelectedCard(null); }}
          onPaneClick={() => { setSelectedIds(new Set()); props.onSelectedCard(null); props.onSelectedEdge(null); }}
          onMoveEnd={(_event, viewport) => void saveCanvasViewport(props.canvasId, viewport)}
          fitView
          fitViewOptions={{ padding: 0.14, minZoom: 1, maxZoom: 1.05 }}
          minZoom={0.5}
          maxZoom={1.8}
          nodesDraggable={editable}
          nodesConnectable={editable}
          edgesReconnectable={editable}
          connectionLineType={ConnectionLineType.Step}
          connectionLineStyle={{ strokeWidth: 1.3 }}
          deleteKeyCode={null}
          selectionKeyCode="Shift"
          multiSelectionKeyCode="Shift"
          panOnScroll={false}
          zoomOnScroll
          zoomOnPinch
          zoomOnDoubleClick={false}
        >
          <Background variant={BackgroundVariant.Dots} gap={26} size={1.2} />
          <Controls showInteractive={false} position="bottom-left" />
          {editable && guides.length ? <ViewportPortal>{guides.map((guide, index) => <div key={`${guide.axis}-${index}`} className={`alignment-guide axis-${guide.axis}`} style={guide.axis === "x" ? { left: guide.coordinate, top: guide.from, height: guide.to - guide.from } : { top: guide.coordinate, left: guide.from, width: guide.to - guide.from }} />)}</ViewportPortal> : null}
        </ReactFlow>
        {!props.cards.length && props.conversations.length > 0 && !conversationDropActive ? <div className="canvas-empty-onboarding">
          <h2>
            <span>{t(props.syncComplete ? "conversationsReadyCalm" : "conversationsArrivingCalm")}</span>
          </h2>
          <p>{t(props.syncComplete ? "autoOrganizeEmptyDescription" : "autoOrganizeSyncingDescription")}</p>
          <div><button onClick={props.onSmartOrganize}>{t("autoOrganize")}</button><button className="secondary" onClick={props.onCreateTopic}>{t("startManually")}</button></div>
        </div> : null}
        {!props.cards.length && conversationDropActive ? <div className="canvas-drop-preview" aria-hidden="true"><MessageSquareText size={18} />{t("releaseToCreateTopic")}</div> : null}
        {editable && selectedEdge && selectedEdge.relation !== "attachment" ? <div className="edge-editor" key={selectedEdge.id}>
          <label>{t("relationLabel")}<input defaultValue={selectedEdge.label ?? ""} placeholder={t("relationPlaceholder")} onBlur={(event) => props.onUpdateEdgeLabel?.(selectedEdge.id, event.target.value.trim())} /></label>
          <button onClick={() => props.onInsertBridge?.(selectedEdge.id)}>{t("insertBridge")}</button>
        </div> : null}
        {pickerTopic ? <div className="attach-picker" role="dialog" aria-label={t("addSource")}>
          <div className="attach-picker-heading"><span><Link2 size={16} />{t("addSource")}</span><button onClick={() => setAttachPickerTopicId(null)} aria-label={t("close")}><X size={16} /></button></div>
          <p>{t("connectToTopic", { title: pickerTopic.title })}</p>
          <label className="attach-picker-search"><Search size={16} /><input autoFocus value={attachQuery} onChange={(event) => setAttachQuery(event.target.value)} placeholder={t("searchConversations")} /></label>
          <div className="attach-picker-list">
            {matchingConversations.map((conversation) => {
              const attached = pickerTopic.conversationIds.includes(conversation.id) || props.edges.some((edge) => edge.relation === "attachment" && edge.source === pickerTopic.id && props.cards.some((card) => card.id === edge.target && card.conversationIds.includes(conversation.id)));
              return <button key={conversation.id} onClick={() => attachToTopic(pickerTopic.id, conversation.id)} disabled={attached}><MessageSquareText size={16} /><span>{conversation.title}</span>{attached ? <Check size={15} aria-label={t("alreadyConnected")} /> : <Link2 size={14} />}</button>;
            })}
            {!matchingConversations.length ? <span className="attach-picker-empty">{props.conversations.length ? t("noLibraryMatches") : t("noConversations")}</span> : null}
          </div>
        </div> : null}
      </div>
    </CanvasNodeContext.Provider>
  );
}
