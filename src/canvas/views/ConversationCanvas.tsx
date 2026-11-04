import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent, type PointerEvent as ReactPointerEvent } from "react";
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
import type {
  Conversation,
  ConversationGraph,
  ConversationGraphNode,
  ConversationMessage,
  OrganizationRun,
} from "../../shared/types";
import { ConversationCanvasContext } from "../conversation-canvas-context";
import {
  conversationDragType,
  findAnswerForQuestion,
  generateConversationGraph,
  indexAnswersByQuestion,
  loadConversationGraph,
  parseConversationDragPayload,
  saveConversationGraph,
  upgradeConversationStructure,
  createManualConversationGraph,
  addManualChapter,
  attachQuestionToChapter,
  linkQuestionToChapter,
  rebuildChapterEdges,
  isUntouchedConversationTimeline,
  isEmptyManualConversationGraph,
} from "../conversation-graph";
import { isCurrentHydrationComplete } from "../../sync/import-state";
import { questionDisplayTitle } from "../conversation-structurer";
import { ConversationNode, type ConversationFlowNode } from "../components/ConversationNode";
import { ChapterReader } from "../components/ChapterReader";
import { UnassignedReader } from "../components/UnassignedReader";
import { ConversationCompositionReader } from "../components/ConversationCompositionReader";
import { ConversationDetailPanel } from "../components/ConversationDetailPanel";
import { ConversationSidebar } from "../components/ConversationSidebar";
import { ConversationStart } from "../components/ConversationStart";
import { OrthogonalEdge } from "../components/OrthogonalEdge";
import { cardEdgeDirection, type EdgeObstacle } from "../edge-geometry";
import { alignConnectedBox, insertionSpace, snapBox, type Box, type Guide } from "../canvas-geometry";
import { usePreferences } from "../preferences";
import { cleanConversationOverviewTitle } from "../conversation-overview";
import { hiddenConversationNodeIds, visibleConversationEdges, visibleConversationNodeIds } from "../conversation-view-model";

const nodeTypes = { "conversation-node": ConversationNode };
const edgeTypes = { orthogonal: OrthogonalEdge };
const conversationBox = (node: ConversationGraphNode): Box => ({ id: node.id, x: node.x, y: node.y, width: node.kind === "question" || node.kind === "chapter" || node.kind === "conversation-root" ? 258 : 228, height: node.kind === "bridge" ? 60 : node.kind === "question" || node.kind === "chapter" ? 96 : 118 });
const DETAIL_WIDTH_KEY = "atlas-conversation-detail-width";
const DEFAULT_DETAIL_WIDTH = 500;

function revealChapter(graph: ConversationGraph, chapterId: string): ConversationGraph {
  return { ...graph, chapters: graph.chapters?.map((chapter) => chapter.id === chapterId ? { ...chapter, collapsed: false } : chapter) };
}

function compact(text: string, length = 76): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length > length ? `${normalized.slice(0, length - 1)}…` : normalized;
}

function copyGraph(value: ConversationGraph): ConversationGraph {
  return { ...value, nodes: value.nodes.map((node) => ({ ...node })), edges: value.edges.map((edge) => ({ ...edge })), chapters: value.chapters?.map((chapter) => ({ ...chapter, questionIds: [...chapter.questionIds] })), questionRelations: value.questionRelations?.map((relation) => ({ ...relation })) };
}

function overviewNodes(graph: ConversationGraph): Array<{ id: string }> | undefined {
  if (!graph.chapters?.length) return undefined;
  const root = graph.organizationMode === "manual" || graph.chapters.some((chapter) => chapter.createdManually) ? graph.nodes.find((node) => node.kind === "conversation-root") : undefined;
  return [...(root ? [{ id: root.id }] : []), ...graph.chapters.map((chapter) => ({ id: chapter.id }))];
}

export type CanvasMode = "browse" | "edit";

interface ConversationCanvasProps {
  conversation: Conversation;
  conversations: Conversation[];
  messages: ConversationMessage[];
  focusRequest?: { message: ConversationMessage; nonce: number } | null;
  loadingMessages: boolean;
  mode: CanvasMode;
  onSelectConversation: (id: string) => void;
  onShowAllConversations?: () => void;
  createRequest: { conversationId: string; title: string; content: string; kind: "topic" | "bridge"; nonce: number } | null;
  onHistoryChange: (history: { undo: () => void; redo: () => void; canUndo: boolean; canRedo: boolean } | null) => void;
  onGraphVisibilityChange?: (visible: boolean) => void;
  onGenerateChapters?: (conversationId: string) => void;
  onStartManual?: () => void;
  tasks?: OrganizationRun[];
  onSelectTask?: (id: string) => void;
  onTaskHistory?: () => void;
}

export function ConversationCanvas(props: ConversationCanvasProps) {
  const { t, locale } = usePreferences();
  const { onHistoryChange } = props;
  const [timelinePreview, setTimelinePreview] = useState(false);
  const [manualSessionStarted, setManualSessionStarted] = useState(false);
  const [organizationChoiceRequested, setOrganizationChoiceRequested] = useState(false);
  const editable = props.mode === "edit" && !timelinePreview;
  const flow = useReactFlow<ConversationFlowNode, Edge>();
  const [graph, setGraph] = useState<ConversationGraph | null>(null);
  const [graphLoading, setGraphLoading] = useState(true);
  const [chapterReaderTargetId, setChapterReaderTargetId] = useState<string | null>(null);
  const [unassignedReaderOpen, setUnassignedReaderOpen] = useState(false);
  const [unassignedReaderTargetId, setUnassignedReaderTargetId] = useState<string | null>(null);
  const [timelineReaderTargetId, setTimelineReaderTargetId] = useState<string | null>(null);
  const needsOrganizationChoice = !timelinePreview && !graphLoading && !props.loadingMessages && isCurrentHydrationComplete(props.conversation)
    && props.messages.some((message) => message.role === "user") && (organizationChoiceRequested || !graph || isUntouchedConversationTimeline(graph)
      || (!manualSessionStarted && isEmptyManualConversationGraph(graph, props.conversation)));
  const showGraph = !needsOrganizationChoice && Boolean(graph);
  const onGraphVisibilityChange = props.onGraphVisibilityChange;
  useEffect(() => { onGraphVisibilityChange?.(showGraph); }, [onGraphVisibilityChange, showGraph]);
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(() => new Set());
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [questionFocusChapterId, setQuestionFocusChapterId] = useState<string | null>(null);
  const [showingAll, setShowingAll] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem("atlas-conversation-sidebar-collapsed") === "1");
  const toggleSidebar = () => setSidebarCollapsed((current) => { localStorage.setItem("atlas-conversation-sidebar-collapsed", current ? "0" : "1"); return !current; });
  const [guides, setGuides] = useState<Guide[]>([]);
  const [insertionPreview, setInsertionPreview] = useState<Array<{ id: string; x: number; y: number }>>([]);
  const [selectedNodeIds, setSelectedNodeIds] = useState<Set<string>>(() => new Set());
  const [historyVersion, setHistoryVersion] = useState(0);
  const fittedConversation = useRef<string | null>(null);
  const previewOrigin = useRef<ConversationGraph | null>(null);
  const handledFocus = useRef<number | null>(null);
  const handledCreate = useRef<number | null>(null);
  const stageRef = useRef<HTMLElement>(null);
  const [detailWidth, setDetailWidth] = useState(() => {
    const saved = Number(localStorage.getItem(DETAIL_WIDTH_KEY));
    return saved >= 320 && saved <= 640 ? saved : DEFAULT_DETAIL_WIDTH;
  });
  const detailWidthRef = useRef(detailWidth);
  const resizeStart = useRef<{ x: number; width: number } | null>(null);
  const [resizingDetail, setResizingDetail] = useState(false);
  detailWidthRef.current = detailWidth;
  const graphRef = useRef(graph);
  graphRef.current = graph;
  const past = useRef<ConversationGraph[]>([]);
  const future = useRef<ConversationGraph[]>([]);
  const dragOrigin = useRef<ConversationGraph | null>(null);
  const constrainDetailWidth = (width: number) => Math.min(Math.min(640, Math.max(320, (stageRef.current?.clientWidth ?? 960) - 320)), Math.max(320, Math.round(width)));
  const saveDetailWidth = (width: number) => { const next = constrainDetailWidth(width); setDetailWidth(next); localStorage.setItem(DETAIL_WIDTH_KEY, String(next)); };
  const endDetailResize = () => {
    if (!resizeStart.current) return;
    resizeStart.current = null;
    setResizingDetail(false);
    localStorage.setItem(DETAIL_WIDTH_KEY, String(detailWidthRef.current));
  };
  const moveDetailResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!resizeStart.current) return;
    const next = constrainDetailWidth(resizeStart.current.width + resizeStart.current.x - event.clientX);
    detailWidthRef.current = next;
    setDetailWidth(next);
  };
  const mutateGraph = useCallback((producer: (current: ConversationGraph | null) => ConversationGraph | null) => {
    setGraph((current) => {
      const next = producer(current);
      if (current && next && current !== next) { past.current.push(copyGraph(current)); if (past.current.length > 60) past.current.shift(); future.current = []; setHistoryVersion((value) => value + 1); }
      return current && next && current !== next ? { ...next, userEdited: true } : next;
    });
  }, []);
  const undo = useCallback(() => {
    const previous = past.current.pop();
    if (!previous) return;
    setGraph((current) => { if (current) future.current.push(copyGraph(current)); return previous; });
    setHistoryVersion((value) => value + 1);
  }, []);
  const redo = useCallback(() => {
    const next = future.current.pop();
    if (!next) return;
    setGraph((current) => { if (current) past.current.push(copyGraph(current)); return next; });
    setHistoryVersion((value) => value + 1);
  }, []);
  useEffect(() => { onHistoryChange({ undo, redo, canUndo: past.current.length > 0, canRedo: future.current.length > 0 }); }, [onHistoryChange, undo, redo, historyVersion]);


  const beginDrag = () => { if (graphRef.current) dragOrigin.current = copyGraph(graphRef.current); };
  const finishDrag = (changed: boolean) => {
    const origin = dragOrigin.current;
    dragOrigin.current = null;
    if (!origin || !changed) return;
    past.current.push(origin); if (past.current.length > 60) past.current.shift(); future.current = []; setHistoryVersion((value) => value + 1);
  };

  useEffect(() => {
    let live = true;
    setGraphLoading(true);
    setTimelinePreview(false);
    setManualSessionStarted(false);
    setOrganizationChoiceRequested(false);
    previewOrigin.current = null;
    past.current = []; future.current = []; dragOrigin.current = null; setHistoryVersion((value) => value + 1);
    void loadConversationGraph(props.conversation.id).then((loaded) => { if (live) { setGraph(loaded && !loaded.chapters ? { ...loaded, chapters: [] } : loaded); setGraphLoading(false); } }).catch(() => { if (live) setGraphLoading(false); });
    setCollapsedIds(new Set());
    setSelectedNodeId(null);
    setQuestionFocusChapterId(null);
    setSelectedNodeIds(new Set());
    setShowingAll(false);
    setChapterReaderTargetId(null);
    setUnassignedReaderOpen(false);
    setUnassignedReaderTargetId(null);
    setTimelineReaderTargetId(null);
    fittedConversation.current = null;
    return () => { live = false; };
  }, [props.conversation.id]);

  useEffect(() => {
    if (!graph || graphLoading || dragOrigin.current || timelinePreview) return;
    const timer = window.setTimeout(() => { void saveConversationGraph(graph); }, 220);
    return () => window.clearTimeout(timer);
  }, [graph, graphLoading, timelinePreview]);

  useEffect(() => {
    if (!graphLoading && graph && (!graph.chapters || graph.chapters.length > 0 && graph.chapterLayoutVersion !== 6) && !props.loadingMessages && props.messages.length) {
      const upgraded = upgradeConversationStructure(graph, props.conversation, props.messages);
      if (upgraded !== graph) { fittedConversation.current = null; setGraph(upgraded); }
    }
  }, [graphLoading, graph, props.loadingMessages, props.conversation, props.messages]);

  useEffect(() => {
    const request = props.createRequest;
    if (!request || !editable || request.conversationId !== props.conversation.id || handledCreate.current === request.nonce) return;
    handledCreate.current = request.nonce;
    mutateGraph((current) => {
      const base = current ?? generateConversationGraph(props.conversation, props.messages, { chapters: [], questionRelations: [] });
      const root = base.nodes.find((node) => node.kind === "conversation-root");
      const id = `conversation-${request.kind}-${crypto.randomUUID()}`;
      return {
        ...base,
        nodes: [...base.nodes, { id, conversationId: base.conversationId, kind: request.kind, title: request.title, description: request.content, x: (root?.x ?? 80) + 360, y: (root?.y ?? 80) + 220 }],
        edges: root ? [...base.edges, { id: `conversation-edge-${crypto.randomUUID()}`, conversationId: base.conversationId, source: root.id, target: id, relation: request.kind === "bridge" ? "bridge" : "structural" }] : base.edges,
      };
    });
  }, [props.createRequest, props.conversation, props.messages, editable, mutateGraph]);

  const hiddenIds = useMemo(() => graph ? hiddenConversationNodeIds(graph, collapsedIds, editable) : new Set<string>(), [collapsedIds, editable, graph]);
  const answerIndex = useMemo(() => indexAnswersByQuestion(props.messages), [props.messages]);
  const messagesById = useMemo(() => new Map(props.messages.flatMap((message) => message.platformMessageId ? [[message.id, message], [message.platformMessageId, message]] as const : [[message.id, message]] as const)), [props.messages]);

  const visibleIds = useMemo(() => {
    return graph ? visibleConversationNodeIds(graph, editable, hiddenIds, questionFocusChapterId) : new Set<string>();
  }, [graph, editable, hiddenIds, questionFocusChapterId]);

  const previewPositions = useMemo(() => new Map(insertionPreview.map((item) => [item.id, item])), [insertionPreview]);
  const nodes = useMemo<ConversationFlowNode[]>(() => needsOrganizationChoice ? [] : (graph?.nodes ?? []).filter((node) => visibleIds.has(node.id)).map((node) => {
    const question = node.sourceMessageId ? messagesById.get(node.sourceMessageId) : undefined;
    const answer = node.kind === "question" && question ? findAnswerForQuestion(props.messages, question, node.answerMessageId, answerIndex) : undefined;
    return ({
    id: node.id,
    type: "conversation-node",
    position: previewPositions.get(node.id) ?? { x: node.x, y: node.y },
    data: { ...node, answerPreview: answer?.preview || answer?.content, answerCharCount: answer?.content.length,
      chapterQuestionCount: graph?.chapters?.find((chapter) => chapter.id === node.id)?.questionIds.length,
      chapterCollapsed: graph?.chapters?.find((chapter) => chapter.id === node.id)?.collapsed,
      chapterOrder: graph?.chapters?.find((chapter) => chapter.id === node.id)?.order,
      hasChildren: graph?.edges.some((edge) => edge.source === node.id) },
    selected: selectedNodeIds.has(node.id) || selectedNodeId === node.id,
  }); }), [graph, visibleIds, selectedNodeId, selectedNodeIds, props.messages, answerIndex, messagesById, previewPositions, needsOrganizationChoice]);

  const edges = useMemo<Edge[]>(() => {
    if (needsOrganizationChoice) return [];
    const graphNodes = graph?.nodes ?? [];
    const boxes = new Map(graphNodes.filter((node) => visibleIds.has(node.id)).map((node) => [node.id, { ...conversationBox(node), x: previewPositions.get(node.id)?.x ?? node.x, y: previewPositions.get(node.id)?.y ?? node.y }]));
    return (graph ? visibleConversationEdges(graph, visibleIds, editable, questionFocusChapterId) : []).map((edge) => {
    const source = boxes.get(edge.source);
    const target = boxes.get(edge.target);
    const direction = source && target ? cardEdgeDirection(source, target) : "right";
    const obstacles: EdgeObstacle[] = [...boxes].filter(([id]) => id !== edge.source && id !== edge.target).map(([, box]) => box);
    return ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    type: "orthogonal",
    sourceHandle: direction === "left" ? "left-source" : direction === "bottom" ? "bottom-source" : direction === "top" ? "top-source" : "right-source",
    targetHandle: direction === "left" ? "right-target" : direction === "bottom" ? "top-target" : direction === "top" ? "bottom-target" : "left-target",
    data: { obstacles, axis: direction === "bottom" || direction === "top" ? "vertical" : "horizontal" },
    markerEnd: { type: MarkerType.ArrowClosed, width: 11, height: 11 },
    className: `semantic-edge relation-${edge.relation ?? "structural"}`,
    style: { strokeWidth: 1.6, strokeDasharray: edge.relation === "bridge" ? "5 5" : undefined },
  });
    });
  }, [graph, visibleIds, editable, questionFocusChapterId, previewPositions, needsOrganizationChoice]);

  useEffect(() => {
    if (!graph?.nodes.length || props.loadingMessages || needsOrganizationChoice || (!graph.chapters && !graph.userEdited && props.messages.length) || fittedConversation.current === graph.conversationId) return;
    fittedConversation.current = graph.conversationId;
    const firstQuestion = timelinePreview ? graph.nodes.find((node) => node.id === selectedNodeId && node.kind === "question") ?? graph.nodes.find((node) => node.kind === "question") : null;
    const frame = requestAnimationFrame(() => {
      if (firstQuestion) void flow.setCenter(firstQuestion.x + 129, firstQuestion.y + 48, { zoom: 1, duration: 0 });
      else void flow.fitView({ nodes: overviewNodes(graph), padding: 0.14, minZoom: 0.78, maxZoom: 1.02, duration: 220 });
    });
    return () => cancelAnimationFrame(frame);
  }, [flow, graph, props.loadingMessages, props.messages.length, needsOrganizationChoice, timelinePreview, selectedNodeId]);

  const updateNode = useCallback((id: string, patch: Partial<ConversationGraphNode>) => {
    mutateGraph((current) => current ? { ...current, userEdited: true, nodes: current.nodes.map((node) => node.id === id ? { ...node, ...patch, ...(node.kind === "question" && patch.title ? { displayTitle: patch.title, displayTitleSource: "user" as const } : {}) } : node), chapters: current.chapters?.map((chapter) => chapter.id === id && patch.title ? { ...chapter, title: patch.title, source: "user" as const, updatedAt: Date.now() } : chapter) } : current);
  }, [mutateGraph]);

  const deleteNode = useCallback((id: string) => {
    mutateGraph((current) => {
      if (!current || current.nodes.find((node) => node.id === id)?.kind === "conversation-root") return current;
      return { ...current, nodes: current.nodes.filter((node) => node.id !== id), edges: current.edges.filter((edge) => edge.source !== id && edge.target !== id), chapters: current.chapters?.filter((chapter) => chapter.id !== id).map((chapter, order) => ({ ...chapter, order, questionIds: chapter.questionIds.filter((questionId) => questionId !== id) })) };
    });
    setSelectedNodeId(null);
  }, [mutateGraph]);

  const createBranch = useCallback((sourceId: string, kind: "topic" | "bridge") => {
    if (!editable) return;
    mutateGraph((current) => {
      if (!current) return current;
      const source = current.nodes.find((node) => node.id === sourceId);
      if (!source) return current;
      const id = `conversation-topic-${crypto.randomUUID()}`;
      return {
        ...current,
        nodes: [...current.nodes, { id, conversationId: current.conversationId, kind, title: kind === "bridge" ? t("bridgeCard") : t("topicCard"), x: source.x + 330, y: source.y + 152 }],
        edges: [...current.edges, { id: `conversation-edge-${crypto.randomUUID()}`, conversationId: current.conversationId, source: sourceId, target: id, relation: kind === "bridge" ? "bridge" : "structural" }],
      };
    });
  }, [editable, t, mutateGraph]);

  const createChapter = (title: string) => {
    if (!editable) return;
    mutateGraph((current) => current ? addManualChapter(current, title) : current);
  };

  const createQuestionNode = (message: ConversationMessage, x: number, y: number): ConversationGraphNode => {
    const answer = findAnswerForQuestion(props.messages, message, undefined, answerIndex);
    return { id: `conversation-message-${message.id}`, conversationId: props.conversation.id, kind: "question",
      title: compact(message.preview || message.content), displayTitle: questionDisplayTitle(message.content), displayTitleSource: "fallback",
      sourceMessageId: message.id, answerMessageId: answer?.id, answerPreview: answer ? compact(answer.content, 180) : undefined,
      answerCharCount: answer?.content.length, sourceCreatedAt: message.createdAt, role: "user", x, y, positionSource: "auto" };
  };

  const assignQuestion = (chapterId: string, messageId: string) => {
    if (!editable) return;
    const message = props.messages.find((item) => item.id === messageId && item.role === "user");
    if (!message) return;
    const order = new Map(props.messages.filter((item) => item.role === "user").map((item, index) => [`conversation-message-${item.id}`, index]));
    mutateGraph((current) => {
      const chapter = current?.chapters?.find((item) => item.id === chapterId);
      if (!current || !chapter) return current;
      const chapterNode = current.nodes.find((node) => node.id === chapterId);
      const id = `conversation-message-${message.id}`;
      const placed = current.nodes.some((node) => node.id === id);
      const next = chapterNode && !placed ? { ...current, nodes: [...current.nodes, createQuestionNode(message, chapterNode.x + 330, chapterNode.y + chapter.questionIds.length * 122)] } : current;
      return revealChapter(attachQuestionToChapter(next, chapterId, id, order), chapterId);
    });
  };

  const onNodesChange = (changes: NodeChange<ConversationFlowNode>[]) => {
    if (!editable) return;
    const positions = new Map(changes.flatMap((change) => change.type === "position" && change.position ? [[change.id, change.position] as const] : []));
    if (positions.size) setGraph((current) => current ? { ...current, userEdited: true, nodes: current.nodes.map((node) => positions.has(node.id) ? { ...node, ...positions.get(node.id)!, positionSource: "user" } : node), chapters: current.chapters?.map((chapter) => positions.has(chapter.id) ? { ...chapter, ...positions.get(chapter.id)!, source: "user" as const } : chapter) } : current);
  };

  const connect = (connection: Connection) => {
    if (!editable || !graph || !connection.source || !connection.target || connection.source === connection.target) return;
    if (graph.edges.some((edge) => edge.source === connection.source && edge.target === connection.target)) return;
    const from = graph.nodes.find((node) => node.id === connection.source);
    const to = graph.nodes.find((node) => node.id === connection.target);
    const chapter = from?.kind === "chapter" && to?.kind === "question" ? from : to?.kind === "chapter" && from?.kind === "question" ? to : null;
    const question = chapter?.id === from?.id ? to : from;
    if (chapter && question?.kind === "question") {
      const order = new Map(props.messages.filter((item) => item.role === "user").map((item, index) => [`conversation-message-${item.id}`, index]));
      mutateGraph((current) => current ? revealChapter(linkQuestionToChapter(current, chapter.id, question.id, order), chapter.id) : current);
      return;
    }
    const bridge = graph.nodes.some((node) => (node.id === connection.source || node.id === connection.target) && node.kind === "bridge");
    mutateGraph((current) => {
      if (!current) return current;
      const source = current.nodes.find((node) => node.id === connection.source);
      const target = current.nodes.find((node) => node.id === connection.target);
      const aligned = source && target && target.kind !== "chapter" ? alignConnectedBox(conversationBox(source), conversationBox(target), current.nodes.filter((node) => visibleIds.has(node.id)).map(conversationBox)) : null;
      return { ...current, userEdited: true,
        nodes: aligned ? current.nodes.map((node) => node.id === target?.id ? { ...node, ...aligned, positionSource: "user" as const } : node) : current.nodes,
        edges: [...current.edges, { id: `conversation-edge-${crypto.randomUUID()}`, conversationId: current.conversationId, source: connection.source!, target: connection.target!, relation: bridge ? "bridge" : "structural" }] };
    });
  };

  const placeDraggedItem = (event: DragEvent<HTMLElement>) => {
    if (!editable) return;
    event.preventDefault();
    const payload = parseConversationDragPayload(event.dataTransfer.getData(conversationDragType));
    if (!payload || payload.conversationId !== props.conversation.id) return;
    const position = flow.screenToFlowPosition({ x: event.clientX, y: event.clientY });
    if (payload.kind === "chapter" && payload.chapterId) {
      mutateGraph((current) => {
        const chapter = current?.chapters?.find((item) => item.id === payload.chapterId);
        if (!current || !chapter) return current;
        const placed = current.nodes.some((node) => node.id === chapter.id);
        const root = current.nodes.find((node) => node.kind === "conversation-root");
        const source = current.organizationMode === "manual" || chapter.createdManually ? root?.id : [...(current.chapters ?? [])].filter((item) => item.order < chapter.order && current.nodes.some((node) => node.id === item.id)).at(-1)?.id ?? root?.id;
        let next: ConversationGraph = { ...current,
          nodes: placed ? current.nodes.map((node) => node.id === chapter.id ? { ...node, x: position.x, y: position.y, positionSource: "user" as const } : node) : [...current.nodes, { id: chapter.id, conversationId: current.conversationId, kind: "chapter", title: chapter.title, x: position.x, y: position.y, positionSource: "user" }],
          chapters: current.chapters?.map((item) => item.id === chapter.id ? { ...item, x: position.x, y: position.y, source: "user" as const, updatedAt: Date.now() } : item),
          edges: !placed && source ? [...current.edges, { id: `chapter-edge-${crypto.randomUUID()}`, conversationId: current.conversationId, source, target: chapter.id, relation: "structural" }] : current.edges,
        };
        if (!placed) {
          const order = new Map(props.messages.filter((item) => item.role === "user").map((item, index) => [`conversation-message-${item.id}`, index]));
          chapter.questionIds.forEach((questionId, index) => {
            const message = props.messages.find((item) => `conversation-message-${item.id}` === questionId && item.role === "user");
            if (!message) return;
            if (!next.nodes.some((node) => node.id === questionId)) next = { ...next, nodes: [...next.nodes, createQuestionNode(message, position.x + 330, position.y + index * 122)] };
            next = attachQuestionToChapter(next, chapter.id, questionId, order);
          });
        }
        return placed ? next : rebuildChapterEdges(next);
      });
      setSelectedNodeId(payload.chapterId);
      return;
    }
    const message = payload.messageId ? props.messages.find((item) => item.id === payload.messageId) : undefined;
    const targetChapter = message && graph?.chapters?.find((chapter) => {
      const node = graph.nodes.find((item) => item.id === chapter.id);
      return node && position.x >= node.x - 24 && position.x <= node.x + 282 && position.y >= node.y - 24 && position.y <= node.y + 104;
    });
    const sourceQuestion = message?.role === "assistant" ? props.messages.filter((item) => item.role === "user" && item.messageIndex < message.messageIndex).at(-1) : message;
    const answer = message?.role === "assistant" ? message : sourceQuestion ? findAnswerForQuestion(props.messages, sourceQuestion, undefined, answerIndex) : undefined;
    const id = message ? `conversation-message-${sourceQuestion?.id ?? message.id}` : `conversation-root-${props.conversation.id}`;
    const existing = graph?.nodes.find((node) => node.id === id);
    if (existing) {
      if (targetChapter) {
        const order = new Map(props.messages.filter((item) => item.role === "user").map((item, index) => [`conversation-message-${item.id}`, index]));
        mutateGraph((current) => current ? revealChapter(attachQuestionToChapter(current, targetChapter.id, id, order), targetChapter.id) : current);
      }
      setSelectedNodeId(id);
      void flow.setCenter(existing.x + 115, existing.y + 70, { duration: 180, zoom: 1 });
      return;
    }
    const node: ConversationGraphNode = message ? {
      id,
      conversationId: props.conversation.id,
      kind: "question",
      title: compact(sourceQuestion?.preview || sourceQuestion?.content || message.content),
      displayTitle: questionDisplayTitle(sourceQuestion?.content || message.content),
      displayTitleSource: "fallback",
      sourceMessageId: sourceQuestion?.id ?? message.id,
      answerMessageId: answer?.id,
      answerPreview: answer ? compact(answer.content, 180) : undefined,
      answerCharCount: answer?.content.length,
      sourceCreatedAt: sourceQuestion?.createdAt,
      role: "user",
      x: targetChapter ? (targetChapter.x ?? position.x) + 330 : position.x,
      y: targetChapter ? (targetChapter.y ?? position.y) + targetChapter.questionIds.length * 122 : position.y,
    } : {
      id,
      conversationId: props.conversation.id,
      kind: "conversation-root",
      title: props.conversation.title,
      description: props.conversation.summary,
      x: position.x,
      y: position.y,
    };
    mutateGraph((current) => {
      if (current) {
        const next = { ...current, nodes: [...current.nodes, node] };
        if (!targetChapter) return next;
        const order = new Map(props.messages.filter((item) => item.role === "user").map((item, index) => [`conversation-message-${item.id}`, index]));
        return revealChapter(attachQuestionToChapter(next, targetChapter.id, node.id, order), targetChapter.id);
      }
      if (node.kind === "conversation-root") return { conversationId: props.conversation.id, nodes: [node], edges: [], userEdited: true, updatedAt: Date.now() };
      const base = generateConversationGraph(props.conversation, [], { chapters: [], questionRelations: [] });
      return { ...base, userEdited: true, nodes: [...base.nodes, node], edges: [{ id: `conversation-edge-${crypto.randomUUID()}`, conversationId: props.conversation.id, source: base.nodes[0].id, target: node.id, relation: "structural" }] };
    });
    setSelectedNodeId(id);
  };

  const showTimelinePreview = useCallback((messageId?: string) => {
    const orderedMessages = [...props.messages].sort((a, b) => a.messageIndex - b.messageIndex);
    const firstQuestionId = orderedMessages.find((message) => message.role === "user")?.id;
    const focusId = messageId ?? firstQuestionId;
    previewOrigin.current = graph;
    fittedConversation.current = null;
    setGraph(generateConversationGraph(props.conversation, orderedMessages, { chapters: [], questionRelations: [] }));
    setTimelinePreview(true);
    setTimelineReaderTargetId(null);
    setSelectedNodeId(focusId ? `conversation-message-${focusId}` : null);
    setSelectedNodeIds(focusId ? new Set([`conversation-message-${focusId}`]) : new Set());
  }, [graph, props.conversation, props.messages]);
  const closeTimelinePreview = () => {
    setTimelinePreview(false);
    setTimelineReaderTargetId(null);
    setGraph(previewOrigin.current);
    previewOrigin.current = null;
    fittedConversation.current = null;
    setSelectedNodeId(null);
    setSelectedNodeIds(new Set());
  };
  const focusSidebarMessage = (message: ConversationMessage) => {
    if (needsOrganizationChoice) { showTimelinePreview(message.id); return; }
    const chapter = graph?.chapters?.find((item) => item.questionIds.includes(`conversation-message-${message.id}`));
    const question = message.role === "user" ? message : props.messages.filter((item) => item.role === "user" && item.messageIndex < message.messageIndex).at(-1);
    const node = graph?.nodes.find((item) => item.kind === "question" && item.sourceMessageId === question?.id);
    if (timelinePreview && node?.sourceMessageId) {
      setSelectedNodeId(node.id);
      setSelectedNodeIds(new Set([node.id]));
      setTimelineReaderTargetId(node.sourceMessageId);
      return;
    }
    if (!chapter && !timelinePreview && (graph?.chapters?.length || !node)) {
      setSelectedNodeId(null);
      setSelectedNodeIds(new Set());
      setUnassignedReaderTargetId(message.id);
      setUnassignedReaderOpen(true);
      return;
    }
    if (!editable) {
      if (chapter) { setChapterReaderTargetId(message.id); setSelectedNodeId(chapter.id); setSelectedNodeIds(new Set([chapter.id])); return; }
    }
    if (!node) return;
    setSelectedNodeId(node.id);
    setSelectedNodeIds(new Set([node.id]));
  };

  useEffect(() => {
    const request = props.focusRequest;
    if (!request || request.message.conversationId !== props.conversation.id || props.loadingMessages || handledFocus.current === request.nonce) return;
    if (needsOrganizationChoice) {
      handledFocus.current = request.nonce;
      showTimelinePreview(request.message.id);
      setTimelineReaderTargetId(request.message.id);
      return;
    }
    if (!graph) return;
    if (timelinePreview) {
      handledFocus.current = request.nonce;
      setTimelineReaderTargetId(request.message.id);
      return;
    }
    const message = request.message.role === "user" ? request.message : props.messages.filter((item) => item.role === "user" && item.messageIndex <= request.message.messageIndex).at(-1);
    const chapter = graph.chapters?.find((item) => item.questionIds.some((id) => id === `conversation-message-${message?.id}` || id === message?.id));
    handledFocus.current = request.nonce;
    if (chapter) {
      setChapterReaderTargetId(request.message.id);
      setSelectedNodeId(chapter.id);
      setSelectedNodeIds(new Set([chapter.id]));
    } else {
      setUnassignedReaderTargetId(request.message.id);
      setUnassignedReaderOpen(true);
    }
  }, [props.focusRequest, props.conversation.id, props.loadingMessages, props.messages, graph, needsOrganizationChoice, timelinePreview, showTimelinePreview]);

  const toggleChapter = (id: string) => {
    if (!editable) { setSelectedNodeId(id); setSelectedNodeIds(new Set([id])); return; }
    setGraph((current) => current?.chapters ? { ...current, chapters: current.chapters.map((chapter) => chapter.id === id ? { ...chapter, collapsed: !chapter.collapsed } : { ...chapter, collapsed: true }) } : current);
  };

  const selectedQuestion = graph?.nodes.find((node) => node.id === selectedNodeId && node.kind === "question");
  const selectedChapter = graph?.chapters?.find((chapter) => chapter.id === selectedNodeId);
  const selectedCompositionCard = graph?.nodes.find((node) => node.id === selectedNodeId && (node.kind === "topic" || node.kind === "bridge" || node.kind === "insight" || node.kind === "draft"));
  const selectedQuestionMessage = selectedQuestion?.sourceMessageId ? messagesById.get(selectedQuestion.sourceMessageId) : undefined;
  const selectedAnswerMessage = selectedQuestionMessage ? findAnswerForQuestion(props.messages, selectedQuestionMessage, selectedQuestion?.answerMessageId, answerIndex) : undefined;
  const unassignedQuestionIds = props.messages.filter((message) => message.role === "user" && !graph?.chapters?.some((chapter) => chapter.questionIds.includes(`conversation-message-${message.id}`))).map((message) => message.id);
  const readingChapter = Boolean(selectedChapter);
  const readingComposition = Boolean(selectedCompositionCard && !editable);

  useEffect(() => {
    if (!selectedNodeId) return;
    const frame = requestAnimationFrame(() => {
      const node = graphRef.current?.nodes.find((item) => item.id === selectedNodeId);
      const width = stageRef.current?.clientWidth ?? 0;
      const height = stageRef.current?.clientHeight ?? 0;
      if (!node || node.kind !== "question" || graphRef.current?.chapters?.length && !questionFocusChapterId) return;
      const zoom = timelinePreview ? 1 : Math.max(0.85, flow.getZoom());
      const narrow = width <= 760;
      const shiftX = timelinePreview || narrow ? 0 : Math.min(detailWidthRef.current, width * 0.42) / (2 * zoom);
      const shiftY = timelinePreview || !narrow ? 0 : Math.min(420, height * 0.56) / (2 * zoom);
      void flow.setCenter(node.x + 129 + shiftX, node.y + 48 + shiftY, { duration: timelinePreview ? 0 : 170, zoom });
    });
    return () => cancelAnimationFrame(frame);
  }, [selectedNodeId, flow, questionFocusChapterId, timelinePreview]);

  // Compensate the camera for the space taken by a detail panel without fitting the graph again.
  useEffect(() => {
    const viewport = stageRef.current?.querySelector<HTMLElement>(".react-flow");
    if (!viewport || typeof ResizeObserver === "undefined") return;
    let previousWidth = viewport.getBoundingClientRect().width;
    const observer = new ResizeObserver(() => {
      const width = viewport.getBoundingClientRect().width;
      if (!width || !previousWidth || width === previousWidth) { previousWidth = width || previousWidth; return; }
      const delta = width - previousWidth;
      previousWidth = width;
      const camera = flow.getViewport();
      void flow.setViewport({ ...camera, x: camera.x + delta / 2 });
    });
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [flow, props.conversation.id, showGraph]);

  return (
    <div className="conversation-workspace">
      <ConversationSidebar
        key={props.conversation.id}
        conversation={props.conversation}
        conversations={props.conversations}
        messages={props.messages}
        questionTitles={new Map((graph?.nodes ?? []).filter((node) => node.kind === "question" && node.sourceMessageId).map((node) => [node.sourceMessageId!, node.displayTitle || node.title]))}
        editable={editable && !needsOrganizationChoice && !unassignedReaderOpen}
        showingAll={showingAll}
        collapsed={sidebarCollapsed}
        onToggleCollapsed={toggleSidebar}
        onShowAll={() => { if (timelinePreview) closeTimelinePreview(); setUnassignedReaderOpen(false); setShowingAll(true); props.onShowAllConversations?.(); }}
        onSelectConversation={props.onSelectConversation}
        tasks={props.tasks}
        onSelectTask={props.onSelectTask}
        onTaskHistory={props.onTaskHistory}
        onSelectMessage={focusSidebarMessage}
        onSelectUnassigned={() => { setSelectedNodeId(null); setSelectedNodeIds(new Set()); setUnassignedReaderTargetId(null); setUnassignedReaderOpen(true); }}
        selectedMessageId={selectedQuestion?.sourceMessageId}
        chapters={graph?.chapters}
        episodes={graph?.episodes}
        manual={graph?.organizationMode === "manual"}
        onCreateChapter={createChapter}
        onAssignQuestion={assignQuestion}
        selectedChapterId={selectedChapter?.id}
        onSelectChapter={(id) => {
          setUnassignedReaderOpen(false);
          setUnassignedReaderTargetId(null);
          setQuestionFocusChapterId(null);
          setChapterReaderTargetId(null);
          setSelectedNodeId(id);
          setSelectedNodeIds(new Set([id]));
        }}
      />
      <ConversationCanvasContext.Provider value={{
        editable,
        collapsedIds,
        toggleCollapsed: (id) => { if (graph?.chapters?.some((chapter) => chapter.id === id)) { toggleChapter(id); return; } setCollapsedIds((current) => {
          const next = new Set(current);
          if (next.has(id)) next.delete(id); else next.add(id);
          return next;
        }); },
        renameNode: (id, title) => updateNode(id, { title }),
        createBranch,
        deleteNode,
        selectNode: (id) => { setSelectedNodeId(id); setSelectedNodeIds(new Set([id])); },
      }}>
        <main
          ref={stageRef}
          className={`conversation-canvas-stage mode-${props.mode} ${timelinePreview ? "is-timeline" : ""} ${readingChapter || readingComposition || unassignedReaderOpen || timelineReaderTargetId ? "is-reading" : ""} ${needsOrganizationChoice ? "is-entry" : ""} ${selectedCompositionCard && editable || selectedQuestion && editable ? "has-detail" : ""} ${resizingDetail ? "is-resizing" : ""}`}
          style={{ "--conversation-detail-width": `${detailWidth}px` } as CSSProperties}
          onDragOver={(event) => { if (editable && !needsOrganizationChoice && !unassignedReaderOpen) { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; } }}
          onDrop={(event) => { if (!needsOrganizationChoice && !unassignedReaderOpen) placeDraggedItem(event); }}
        >
          {showGraph ? <ReactFlow<ConversationFlowNode, Edge>
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onNodesChange={onNodesChange}
            onConnect={connect}
            onNodeDragStart={() => { if (editable) beginDrag(); }}
            onNodeDrag={(_event, node, dragged) => {
              if (!editable) return;
              const movingIds = new Set((dragged.length ? dragged : [node]).map((item) => item.id));
              const others = (graph?.nodes ?? []).filter((item) => visibleIds.has(item.id) && !movingIds.has(item.id) && Math.abs(item.x - node.position.x) < 520 && Math.abs(item.y - node.position.y) < 400).map(conversationBox);
              setGuides(snapBox({ id: node.id, x: node.position.x, y: node.position.y, width: node.measured?.width ?? 278, height: node.measured?.height ?? 150 }, others).guides);
              setInsertionPreview(movingIds.size > 1 ? [] : insertionSpace({ id: node.id, x: node.position.x, y: node.position.y, width: node.measured?.width ?? 278, height: node.measured?.height ?? 150 }, others));
            }}
            onNodeDragStop={(_event, node, dragged) => {
              if (!editable) return;
              setGuides([]);
              setInsertionPreview([]);
              const moving = dragged.length ? dragged : [node];
              const others = (graph?.nodes ?? []).filter((item) => visibleIds.has(item.id) && !moving.some((entry) => entry.id === item.id) && Math.abs(item.x - node.position.x) < 520 && Math.abs(item.y - node.position.y) < 400).map(conversationBox);
              const snapped = snapBox({ id: node.id, x: node.position.x, y: node.position.y, width: node.measured?.width ?? 278, height: node.measured?.height ?? 150 }, others);
              const connected = graphRef.current?.edges.find((edge) => (edge.source === node.id || edge.target === node.id) && others.some((other) => other.id === (edge.source === node.id ? edge.target : edge.source)));
              const neighbor = connected && others.find((other) => other.id === (connected.source === node.id ? connected.target : connected.source));
              const movingHeight = node.measured?.height ?? 150;
              const alignedY = neighbor && Math.abs(snapped.y + movingHeight / 2 - neighbor.y - neighbor.height / 2) <= 22 ? neighbor.y + neighbor.height / 2 - movingHeight / 2 : snapped.y;
              const positions = new Map(moving.map((item) => [item.id, { x: item.position.x + snapped.x - node.position.x, y: item.position.y + alignedY - node.position.y }]));
              if (moving.length === 1) for (const item of insertionSpace({ id: node.id, x: snapped.x, y: alignedY, width: node.measured?.width ?? 278, height: node.measured?.height ?? 150 }, others)) positions.set(item.id, { x: item.x, y: item.y });
              const changed = [...positions].some(([id, position]) => { const previous = dragOrigin.current?.nodes.find((item) => item.id === id); return previous && (previous.x !== position.x || previous.y !== position.y); });
              setGraph((current) => current ? { ...current, userEdited: true, nodes: current.nodes.map((item) => positions.has(item.id) ? { ...item, ...positions.get(item.id)!, positionSource: "user" } : item), chapters: current.chapters?.map((chapter) => positions.has(chapter.id) ? { ...chapter, ...positions.get(chapter.id)!, source: "user" as const } : chapter) } : current);
              finishDrag(changed);
            }}
            onNodeClick={(event, node) => {
              if (timelinePreview && node.data.kind === "question" && node.data.sourceMessageId) {
                setSelectedNodeId(node.id);
                setSelectedNodeIds(new Set([node.id]));
                setTimelineReaderTargetId(node.data.sourceMessageId);
                return;
              }
              if (editable && event.shiftKey) { setSelectedNodeIds((current) => { const next = new Set(current); if (next.has(node.id)) next.delete(node.id); else next.add(node.id); return next; }); setSelectedNodeId(null); }
              else { if (node.data.kind === "chapter") setChapterReaderTargetId(null); setSelectedNodeId(node.id); setSelectedNodeIds(new Set([node.id])); }
            }}
            onSelectionChange={({ nodes: selection }) => {
              if (!editable || selection.length < 2) return;
              const ids = new Set(selection.map((item) => item.id));
              setSelectedNodeIds((current) => current.size === ids.size && [...current].every((id) => ids.has(id)) ? current : ids);
              setSelectedNodeId(null);
            }}
            onPaneClick={() => { setSelectedNodeId(null); setSelectedNodeIds(new Set()); }}
            onNodesDelete={(deleted) => { if (editable) { const ids = new Set(deleted.filter((node) => node.data.kind !== "conversation-root").map((node) => node.id)); mutateGraph((current) => current && ids.size ? { ...current, nodes: current.nodes.filter((node) => !ids.has(node.id)), edges: current.edges.filter((edge) => !ids.has(edge.source) && !ids.has(edge.target)), chapters: current.chapters?.filter((chapter) => !ids.has(chapter.id)).map((chapter, order) => ({ ...chapter, order, questionIds: chapter.questionIds.filter((id) => !ids.has(id)) })) } : current); setSelectedNodeId(null); setSelectedNodeIds(new Set()); } }}
            onEdgesDelete={(deleted) => { if (editable) mutateGraph((current) => {
              if (!current) return current;
              const ids = new Set(deleted.map((item) => item.id));
              const detached = current.edges.filter((edge) => ids.has(edge.id) && edge.id.startsWith("chapter-member-")).map((edge) => edge.target);
              return { ...current, edges: current.edges.filter((edge) => !ids.has(edge.id)), chapters: current.chapters?.map((chapter) => ({ ...chapter, questionIds: chapter.questionIds.filter((id) => !detached.includes(id)) })) };
            }); }}
            minZoom={0.72}
            maxZoom={1.8}
            nodesDraggable={editable}
            nodesConnectable={editable}
            edgesReconnectable={editable}
            elementsSelectable
            deleteKeyCode={editable ? ["Backspace", "Delete"] : null}
            selectionKeyCode="Shift"
            multiSelectionKeyCode="Shift"
            panOnScroll={false}
            zoomOnScroll
            zoomOnPinch
            zoomOnDoubleClick={false}
            connectionLineType={ConnectionLineType.Straight}
          >
            <Background variant={BackgroundVariant.Dots} gap={26} size={1.2} />
            <Controls showInteractive={false} position="bottom-left" />
            {editable && guides.length ? <ViewportPortal>{guides.map((guide, index) => <div key={`${guide.axis}-${index}`} className={`alignment-guide axis-${guide.axis}`} style={guide.axis === "x" ? { left: guide.coordinate, top: guide.from, height: guide.to - guide.from } : { top: guide.coordinate, left: guide.from, width: guide.to - guide.from }} />)}</ViewportPortal> : null}
          </ReactFlow> : null}
            {graph && !needsOrganizationChoice ? <div className="conversation-overview-bar"><span className="conversation-overview-summary"><span className="conversation-overview-title">{cleanConversationOverviewTitle(props.conversation.title)}</span><span className="conversation-overview-meta" aria-hidden="true">·</span>{timelinePreview ? <span className="conversation-overview-meta">{locale === "zh-CN" ? "按时间顺序" : "Chronological canvas"}</span> : graph.chapters?.length ? <><span className="conversation-overview-meta">{new Intl.NumberFormat(locale).format(graph.chapters.length)} {t("chapterCountLabel")}</span><span className="conversation-overview-meta" aria-hidden="true">·</span></> : null}<span className="conversation-overview-meta">{new Intl.NumberFormat(locale).format(graph.nodes.filter((node) => node.kind === "question").length)} {t("questionCountLabel")}</span>{!timelinePreview && graph.chapters?.length && unassignedQuestionIds.length ? <span className="conversation-overview-meta">· {unassignedQuestionIds.length} {locale === "zh-CN" ? "个问题待整理" : "questions to organize"}</span> : null}</span><span className="conversation-overview-actions">{timelinePreview ? <button type="button" onClick={closeTimelinePreview}>{locale === "zh-CN" ? "整理此对话" : "Organize this conversation"}</button> : <><button type="button" onClick={() => { setOrganizationChoiceRequested(true); setSelectedNodeId(null); setSelectedNodeIds(new Set()); setUnassignedReaderOpen(false); }}>{locale === "zh-CN" ? "整理方式" : "Organize options"}</button></>}</span></div> : null}
          {needsOrganizationChoice ? <ConversationStart conversation={props.conversation} onManual={() => {
            setManualSessionStarted(true);
            setOrganizationChoiceRequested(false);
            setGraph((current) => current && !isUntouchedConversationTimeline(current) ? current : createManualConversationGraph(props.conversation));
            props.onStartManual?.();
          }} onAI={props.onGenerateChapters ? () => props.onGenerateChapters?.(props.conversation.id) : undefined} onRead={() => showTimelinePreview()} /> : null}
          {!showGraph && (graphLoading || props.loadingMessages) ? <div className="conversation-canvas-empty" role="status"><p>{t("loadingMessages")}</p></div> : null}
          {showGraph && graph?.organizationMode === "manual" && graph.nodes.length === 1 ? <p className="conversation-manual-hint">{locale === "zh-CN" ? "在左侧创建章节" : "Create a chapter on the left"}</p> : null}
          {!graph && !graphLoading && !props.loadingMessages && !needsOrganizationChoice ? (
            <div className="conversation-canvas-empty">
              <h2>{t("emptyConversationCanvas")}</h2>
              <p>{props.loadingMessages ? t("loadingMessages") : props.conversation.importState === "discovered" && !props.messages.length ? ["queued", "syncing", "rate_limited", "retry_wait"].includes(props.conversation.hydrationState ?? "") ? t("loadingConversationContent") : t("conversationSyncPending") : t("emptyConversationCanvasHint")}</p>
                {props.messages.length > 0 && props.onGenerateChapters ? <button onClick={() => props.onGenerateChapters?.(props.conversation.id)}>{locale === "zh-CN" ? "在工作台整理" : "Organize on Workbench"}</button> : null}
            </div>
          ) : null}
          {selectedCompositionCard && editable || selectedQuestion && editable ? <div className="conversation-detail-resize" role="separator" aria-label={t("resizeDetailPanel")} aria-orientation="vertical" aria-valuemin={320} aria-valuemax={640} aria-valuenow={detailWidth} tabIndex={0} title={t("resizeDetailPanel")} onPointerDown={(event) => { if (event.button !== 0) return; event.preventDefault(); event.stopPropagation(); resizeStart.current = { x: event.clientX, width: detailWidthRef.current }; setResizingDetail(true); event.currentTarget.setPointerCapture(event.pointerId); }} onPointerMove={moveDetailResize} onPointerUp={endDetailResize} onPointerCancel={endDetailResize} onLostPointerCapture={endDetailResize} onDoubleClick={() => saveDetailWidth(DEFAULT_DETAIL_WIDTH)} onKeyDown={(event) => { if (event.key === "ArrowLeft") { event.preventDefault(); saveDetailWidth(detailWidthRef.current + 16); } else if (event.key === "ArrowRight") { event.preventDefault(); saveDetailWidth(detailWidthRef.current - 16); } }} /> : null}
          {selectedQuestion && editable ? <ConversationDetailPanel key={selectedQuestion.id} conversation={props.conversation} node={selectedQuestion} question={selectedQuestionMessage} answer={selectedAnswerMessage} messages={props.messages} graph={graph} workspace={false} loadingMessages={props.loadingMessages} onClose={() => { setSelectedNodeId(null); setSelectedNodeIds(new Set()); }} /> : null}
          {selectedChapter && graph ? <ChapterReader key={selectedChapter.id} chapter={selectedChapter} graph={graph} conversation={props.conversation} messages={props.messages} initialQuestionId={chapterReaderTargetId} onClose={() => { setSelectedNodeId(null); setSelectedNodeIds(new Set()); setChapterReaderTargetId(null); }} onChapter={(id) => { setChapterReaderTargetId(null); setSelectedNodeId(id); setSelectedNodeIds(new Set([id])); }} /> : null}
          {unassignedReaderOpen ? <UnassignedReader conversation={props.conversation} messages={props.messages} questionIds={unassignedQuestionIds} initialQuestionId={unassignedReaderTargetId} onClose={() => { setUnassignedReaderOpen(false); setUnassignedReaderTargetId(null); }} /> : null}
          {timelineReaderTargetId ? <UnassignedReader conversation={props.conversation} messages={props.messages} questionIds={props.messages.filter((message) => message.role === "user").map((message) => message.id)} initialQuestionId={timelineReaderTargetId} variant="chronological" onClose={() => setTimelineReaderTargetId(null)} /> : null}
          {selectedCompositionCard && !editable && graph ? <ConversationCompositionReader key={selectedCompositionCard.id} node={selectedCompositionCard} graph={graph} conversation={props.conversation} messages={props.messages} onClose={() => { setSelectedNodeId(null); setSelectedNodeIds(new Set()); }} /> : null}
          {selectedCompositionCard && editable && !selectedQuestion && !selectedChapter ? <aside className="conversation-detail-panel chapter-detail" aria-label={selectedCompositionCard.kind === "topic" ? t("knowledgeCard") : selectedCompositionCard.kind === "bridge" ? t("bridgeCard") : selectedCompositionCard.kind === "draft" ? "待补充" : "洞察"}><header><span className="eyebrow">{selectedCompositionCard.kind === "topic" ? t("knowledgeCard") : selectedCompositionCard.kind === "bridge" ? t("bridgeCard") : selectedCompositionCard.kind === "draft" ? "待补充" : "洞察"}</span><button className="icon-button" onClick={() => setSelectedNodeId(null)} aria-label={t("close")}>×</button></header><h2>{selectedCompositionCard.title}</h2>{selectedCompositionCard.kind !== "bridge" ? <textarea className="composition-card-editor nodrag" aria-label={t("cardContent")} placeholder={t("notePlaceholder")} defaultValue={selectedCompositionCard.description ?? ""} key={selectedCompositionCard.id} onBlur={(event) => { if (event.target.value !== (selectedCompositionCard.description ?? "")) updateNode(selectedCompositionCard.id, { description: event.target.value }); }} /> : selectedCompositionCard.description && selectedCompositionCard.description !== selectedCompositionCard.title ? <p className="chapter-detail-summary">{selectedCompositionCard.description}</p> : null}<h3>{t("sources")}</h3><ol>{selectedCompositionCard.evidenceRefs?.map((ref) => { const message = props.messages.find((item) => item.id === ref.messageId); return <li key={`${ref.conversationId}:${ref.messageId}`}><button onClick={() => { if (message) focusSidebarMessage(message); }}>{message ? questionDisplayTitle(message.content) : ref.conversationId}</button></li>; })}</ol></aside> : null}
        </main>
      </ConversationCanvasContext.Provider>
    </div>
  );
}
