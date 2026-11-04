import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import type { Conversation, ConversationMessage } from "../shared/types";
import {
  conversationDragType,
  addManualChapter,
  attachQuestionToChapter,
  createManualConversationGraph,
  findAnswerForQuestion,
  generateConversationGraph,
  indexAnswersByQuestion,
  linkQuestionToChapter,
  isEmptyManualConversationGraph,
  isUntouchedConversationTimeline,
  layoutConversationGraph,
  loadConversationGraph,
  parseConversationDragPayload,
  parseLibraryConversationDrag,
  rebuildChapterEdges,
  saveConversationGraph,
  upgradeChapterLayout,
  upgradeConversationStructure,
} from "./conversation-graph";

const conversation: Conversation = {
  id: "conversation-1",
  platform: "chatgpt",
  title: "A useful conversation",
  url: "https://chatgpt.com/c/conversation-1",
  updatedAt: 1,
  messageCount: 2,
};

const messages: ConversationMessage[] = [
  { id: "message-1", conversationId: conversation.id, messageIndex: 0, role: "user", content: "How does this work?", preview: "How does this work?", contentHash: "one", createdAt: 1, updatedAt: 1 },
  { id: "message-2", conversationId: conversation.id, messageIndex: 1, role: "assistant", content: "It creates a graph.", preview: "It creates a graph.", contentHash: "two", createdAt: 2, updatedAt: 2 },
];

describe("conversation graph", () => {
  beforeEach(() => localStorage.clear());

  it("creates manual chapters and assigns questions to exactly one chapter", () => {
    const base = createManualConversationGraph(conversation);
    const first = addManualChapter(base, "First stage", 10);
    const second = addManualChapter(first, "Second stage", 11);
    expect(second.chapters?.map((chapter) => chapter.title)).toEqual(["First stage", "Second stage"]);
    expect(second.nodes.filter((node) => node.kind === "chapter")).toHaveLength(2);
    expect(second.edges.filter((edge) => edge.source === base.nodes[0].id).map((edge) => edge.target)).toEqual(second.chapters?.map((chapter) => chapter.id));
    const questionId = "conversation-message-message-1";
    const withQuestion = { ...second, nodes: [...second.nodes, { id: questionId, conversationId: conversation.id, kind: "question" as const, title: "How does this work?", x: 800, y: 100 }] };
    const attached = attachQuestionToChapter(withQuestion, first.chapters![0].id, questionId);
    expect(attached.chapters?.[0].questionIds).toEqual([questionId]);
    const moved = attachQuestionToChapter(attached, second.chapters![1].id, questionId);
    expect(moved.chapters?.[0].questionIds).toEqual([]);
    expect(moved.chapters?.[1].questionIds).toEqual([questionId]);
    expect(moved.edges.filter((edge) => edge.target === questionId && edge.source.startsWith("conversation-chapter"))).toHaveLength(1);
    expect(parseConversationDragPayload(JSON.stringify({ kind: "chapter", conversationId: conversation.id, chapterId: second.chapters![1].id }))).toMatchObject({ kind: "chapter", chapterId: second.chapters![1].id });
    const unplaced = attachQuestionToChapter(second, first.chapters![0].id, questionId);
    expect(unplaced.chapters?.[0].questionIds).toEqual([questionId]);
    expect(unplaced.edges.filter((edge) => edge.target === questionId)).toHaveLength(0);
  });

  it("keeps title-to-chapter fan-out when chapters are rebuilt", () => {
    const graph = addManualChapter(addManualChapter(createManualConversationGraph(conversation), "First"), "Second");
    const [first, second] = graph.chapters!;
    const rebuilt = rebuildChapterEdges(graph);
    expect(rebuilt.edges.map((edge) => [edge.source, edge.target])).toEqual([[graph.nodes[0].id, first.id], [graph.nodes[0].id, second.id]]);
    expect(rebuilt.nodes.find((node) => node.id === first.id)?.positionSource).toBe("auto");
  });

  it("adds a user chapter to an AI graph without rearranging its existing chapters", () => {
    const turns = Array.from({ length: 8 }, (_, index): ConversationMessage => ({ ...messages[0], id: `ai-question-${index}`, messageIndex: index }));
    const ai = { ...generateConversationGraph(conversation, turns), organizationMode: "ai" as const };
    const added = addManualChapter(ai, "My follow-up");
    const chapter = added.chapters!.at(-1)!;
    expect(added.nodes.find((node) => node.id === chapter.id)).toMatchObject({ kind: "chapter", title: "My follow-up" });
    expect(added.edges).toContainEqual(expect.objectContaining({ source: ai.nodes[0].id, target: chapter.id }));
    expect(added.edges.filter((edge) => ai.edges.some((old) => old.id === edge.id))).toEqual(ai.edges);
    expect(added.nodes.filter((node) => ai.nodes.some((old) => old.id === node.id))).toEqual(ai.nodes);
  });

  it("restores old sidebar-only manual chapters on load", async () => {
    const created = addManualChapter(createManualConversationGraph(conversation), "Previously unplaced");
    const old = { ...created, nodes: created.nodes.filter((node) => node.kind !== "chapter"), edges: [] };
    await saveConversationGraph(old);
    const restored = (await loadConversationGraph(conversation.id))!;
    expect(restored.nodes.find((node) => node.id === created.chapters![0].id)).toMatchObject({ kind: "chapter", title: "Previously unplaced" });
    expect(restored.edges).toContainEqual(expect.objectContaining({ source: old.nodes[0].id, target: created.chapters![0].id }));
  });

  it("connects sibling questions directly to the chapter rather than chaining them", () => {
    const graph = addManualChapter(createManualConversationGraph(conversation), "Basics");
    const chapterId = graph.chapters![0].id;
    const placed = { ...graph, nodes: [...graph.nodes, ...["q1", "q2"].map((id, index) => ({ id: `conversation-message-${id}`, conversationId: conversation.id, kind: "question" as const, title: id, x: 450, y: 100 + index * 120 }))] };
    const attached = attachQuestionToChapter(attachQuestionToChapter(placed, chapterId, "conversation-message-q1"), chapterId, "conversation-message-q2");
    expect(attached.edges.filter((edge) => edge.source === chapterId).map((edge) => edge.target)).toEqual(["conversation-message-q1", "conversation-message-q2"]);
    const center = attached.nodes.find((node) => node.id === chapterId)!.y;
    const top = attached.nodes.find((node) => node.id === "conversation-message-q1")!.y;
    const bottom = attached.nodes.find((node) => node.id === "conversation-message-q2")!.y;
    expect(top + bottom).toBe(center * 2);
  });

  it("centers generated question branches above and below their chapter", () => {
    const turns = Array.from({ length: 4 }, (_, index): ConversationMessage => ({ ...messages[0], id: `sym-${index}`, messageIndex: index * 2 }));
    const chapter = { id: "sym-chapter", conversationId: conversation.id, title: "Dynamics", questionIds: turns.slice(0, 3).map((message) => `conversation-message-${message.id}`), order: 0, collapsed: true, source: "auto" as const, createdAt: 1, updatedAt: 1 };
    const later = { ...chapter, id: "later-chapter", title: "Stability", questionIds: [`conversation-message-${turns[3].id}`], order: 1 };
    const graph = generateConversationGraph(conversation, turns, { chapters: [chapter, later], questionRelations: [] });
    const center = graph.nodes.find((node) => node.id === chapter.id)!.y;
    const [upper, middle, lower] = chapter.questionIds.map((id) => graph.nodes.find((node) => node.id === id)!.y);
    expect([upper, middle, lower]).toEqual([center - 132, center, center + 132]);
    expect(graph.nodes.find((node) => node.id === later.id)!.y - lower).toBeGreaterThanOrEqual(176);
    expect(graph.nodes.find((node) => node.kind === "conversation-root")!.y + 59).toBe(center + 48);
  });

  it("lets one question link to several chapters while retaining one reading owner", () => {
    const graph = addManualChapter(addManualChapter(createManualConversationGraph(conversation), "First"), "Second");
    const [first, second] = graph.chapters!;
    const questionId = "conversation-message-message-1";
    const placed = { ...graph, nodes: [...graph.nodes, { id: questionId, conversationId: conversation.id, kind: "question" as const, title: "Question", x: 800, y: 100 }] };
    const owned = linkQuestionToChapter(placed, first.id, questionId);
    const linked = linkQuestionToChapter(owned, second.id, questionId);
    expect(linked.chapters?.[0].questionIds).toEqual([questionId]);
    expect(linked.chapters?.[1].questionIds).toEqual([]);
    expect(linked.edges.filter((edge) => edge.target === questionId).map((edge) => edge.source)).toEqual([first.id, second.id]);
    expect(linkQuestionToChapter(linked, second.id, questionId)).toBe(linked);
    const reassigned = attachQuestionToChapter(linked, second.id, questionId);
    expect(reassigned.edges.filter((edge) => edge.target === questionId)).toMatchObject([{ source: second.id }]);
  });

  it("generates a deterministic horizontal graph linked to source messages", () => {
    const graph = generateConversationGraph(conversation, messages);
    expect(graph.nodes).toHaveLength(2);
    expect(graph.nodes[0]).toMatchObject({ kind: "conversation-root", title: conversation.title, x: 60 });
    expect(graph.nodes[1]).toMatchObject({ kind: "question", sourceMessageId: "message-1", answerMessageId: "message-2", x: 364, y: 64 });
    expect(graph.edges.map((edge) => [edge.source, edge.target])).toEqual([
      [graph.nodes[0].id, graph.nodes[1].id],
    ]);
  });

  it("recognizes legacy automatic timelines while preserving authored graphs", () => {
    const timeline = generateConversationGraph(conversation, messages, { chapters: [], questionRelations: [] });
    expect(isUntouchedConversationTimeline(timeline)).toBe(true);
    expect(isUntouchedConversationTimeline({ ...timeline, userEdited: true })).toBe(false);
    expect(isUntouchedConversationTimeline({ ...timeline, nodes: timeline.nodes.map((node) => node.kind === "question" ? { ...node, positionSource: "user" as const } : node) })).toBe(false);
    expect(isUntouchedConversationTimeline({ ...timeline, edges: [] })).toBe(false);
  });

  it("starts manual organization with only the conversation source anchor", () => {
    const graph = createManualConversationGraph(conversation);
    expect(graph).toMatchObject({ conversationId: conversation.id, organizationMode: "manual", userEdited: true, chapters: [], edges: [] });
    expect(graph.nodes).toMatchObject([{ kind: "conversation-root", title: conversation.title }]);
    expect(isEmptyManualConversationGraph(graph, conversation)).toBe(true);
    expect(isEmptyManualConversationGraph({ ...graph, nodes: [{ ...graph.nodes[0], title: "My own title" }] }, conversation)).toBe(false);
  });

  it("persists the generated structure per conversation", async () => {
    const graph = generateConversationGraph(conversation, messages);
    await saveConversationGraph(graph);
    expect((await loadConversationGraph(conversation.id))?.nodes.map((node) => node.id)).toEqual(graph.nodes.map((node) => node.id));
    expect(await loadConversationGraph("another-conversation")).toBeNull();
  });

  it("pairs the first valid assistant before the next user, not only index + 1", () => {
    const later: ConversationMessage = { ...messages[1], id: "answer-later", messageIndex: 4, content: "Valid answer" };
    expect(findAnswerForQuestion([messages[0], later], messages[0])?.id).toBe("answer-later");
    expect(findAnswerForQuestion([messages[0], { ...messages[0], id: "follow-up", messageIndex: 3 }, later], messages[0])).toBeUndefined();
    expect(generateConversationGraph(conversation, [messages[0], later]).nodes[1].answerMessageId).toBe("answer-later");
  });

  it("uses the same indexed answer for regenerated responses and ignores empty turns", () => {
    const blank = { ...messages[1], id: "blank", messageIndex: 1, content: "  " };
    const first = { ...messages[1], id: "first", messageIndex: 3 };
    const regenerated = { ...messages[1], id: "regenerated", platformMessageId: "platform-regenerated", messageIndex: 4 };
    const nextQuestion = { ...messages[0], id: "next-question", messageIndex: 5 };
    const nextAnswer = { ...messages[1], id: "next-answer", messageIndex: 6 };
    const transcript = [nextAnswer, regenerated, nextQuestion, messages[0], blank, first];
    const index = indexAnswersByQuestion(transcript);
    expect(findAnswerForQuestion(transcript, messages[0], undefined, index)?.id).toBe("first");
    expect(findAnswerForQuestion(transcript, messages[0], "platform-regenerated", index)?.id).toBe("regenerated");
    expect(findAnswerForQuestion(transcript, messages[0], "next-answer", index)?.id).toBe("first");
    expect(findAnswerForQuestion(transcript, nextQuestion, undefined, index)?.id).toBe("next-answer");
  });

  it("prefers a normalized reply-to relation over a nearby unrelated user turn", () => {
    const nextQuestion = { ...messages[0], id: "next", messageIndex: 2 };
    const linkedAnswer = { ...messages[1], id: "linked", messageIndex: 3, replyToMessageId: messages[0].id };
    const transcript = [messages[0], nextQuestion, linkedAnswer];
    const index = indexAnswersByQuestion(transcript);
    expect(findAnswerForQuestion(transcript, messages[0], undefined, index)?.id).toBe("linked");
    expect(findAnswerForQuestion(transcript, nextQuestion, undefined, index)).toBeUndefined();
  });

  it("keeps a linear follow-up compact and stacks only sibling branches", () => {
    const graph = generateConversationGraph(conversation, [messages[0], messages[1], { ...messages[0], id: "message-3", messageIndex: 2, content: "Follow up", preview: "Follow up" }]);
    expect(graph.nodes.map(({ x, y }) => [x, y])).toEqual([[60, 64], [364, 64], [668, 64]]);
    const branching = layoutConversationGraph({ ...graph, edges: graph.edges.map((edge) => ({ ...edge, source: graph.nodes[0].id })) });
    expect(branching.nodes.map(({ x, y }) => [x, y])).toEqual([[60, 64], [364, 64], [364, 228]]);
    expect(graph.nodes[2].x).toBe(668);
  });

  it("groups a long transcript into persisted chapters and keeps source message identity", async () => {
    const long = Array.from({ length: 8 }, (_, index): ConversationMessage => ({ ...messages[0], id: `q-${index}`, messageIndex: index * 2 }));
    const graph = generateConversationGraph(conversation, long);
    expect(graph.chapters).toHaveLength(2);
    expect(graph.chapters?.flatMap((chapter) => chapter.questionIds)).toEqual(long.map((message) => `conversation-message-${message.id}`));
    expect(graph.nodes.filter((node) => node.kind === "question").map((node) => node.sourceMessageId)).toEqual(long.map((message) => message.id));
    await saveConversationGraph(graph);
    expect((await loadConversationGraph(conversation.id))?.chapters).toEqual(graph.chapters);
    expect(upgradeConversationStructure({ ...graph, chapters: undefined, userEdited: true }, conversation, long).chapters).toEqual([]);
    const edited = { ...graph, chapters: undefined, userEdited: undefined, nodes: graph.nodes.map((node) => node.kind === "question" ? { ...node, positionSource: "user" as const } : node) };
    expect(upgradeConversationStructure(edited, conversation, long).nodes.find((node) => node.kind === "question")?.x).toBe(graph.nodes[1].x);
  });

  it("places a sparse bridge and insight beside the backbone with source links", () => {
    const long = Array.from({ length: 6 }, (_, index): ConversationMessage => ({ ...messages[0], id: `composition-${index}`, messageIndex: index }));
    const now = 5;
    const chapters = [0, 1].map((order) => ({ id: `chapter-${order}`, conversationId: conversation.id, title: order ? "工程实现" : "产品定位", summary: "具体阶段", questionIds: long.slice(order * 3, order * 3 + 3).map((message) => `conversation-message-${message.id}`), order, collapsed: true, source: "auto" as const, createdAt: now, updatedAt: now }));
    const graph = generateConversationGraph(conversation, long, { chapters, questionRelations: [], bridges: [{ fromOrder: 0, toOrder: 1, explanation: "产品边界决定工程优先级", questionIds: [chapters[0].questionIds[0]] }], freeCards: [{ afterOrder: 1, type: "insight", title: "设计原则", body: "用户控制最终结构。", questionIds: [chapters[0].questionIds[0], chapters[1].questionIds[0]] }] });
    expect(graph.nodes.filter((node) => node.kind === "bridge")).toHaveLength(1);
    expect(graph.nodes.filter((node) => node.kind === "insight")).toHaveLength(1);
    expect(graph.edges.some((edge) => edge.relation === "attachment" && edge.target.startsWith("conversation-insight-"))).toBe(true);
    expect(graph.nodes.find((node) => node.kind === "insight")?.evidenceRefs).toHaveLength(2);
  });

  it("reconnects chapter membership after a manual split without dangling links", () => {
    const long = Array.from({ length: 5 }, (_, index): ConversationMessage => ({ ...messages[0], id: `split-${index}`, messageIndex: index * 2 }));
    const graph = generateConversationGraph(conversation, long);
    const allQuestionIds = graph.chapters!.flatMap((chapter) => chapter.questionIds);
    const parent = { ...graph.chapters![0], questionIds: allQuestionIds };
    const sibling = { ...parent, id: "new-chapter", questionIds: allQuestionIds.slice(3), order: 1 };
    const updated = rebuildChapterEdges({ ...graph, chapters: [{ ...parent, questionIds: parent.questionIds.slice(0, 3) }, sibling], nodes: [...graph.nodes, { id: sibling.id, conversationId: conversation.id, kind: "chapter", title: "New", x: 500, y: 300 }] });
    expect(updated.edges).toContainEqual(expect.objectContaining({ source: parent.id, target: sibling.id }));
    expect(updated.edges).toContainEqual(expect.objectContaining({ source: sibling.id, target: sibling.questionIds[0] }));
    expect(updated.edges.filter((edge) => edge.target === sibling.questionIds[0])).toHaveLength(1);
  });

  it("migrates old chapter grids to the mainline without moving user-positioned questions", () => {
    const long = Array.from({ length: 5 }, (_, index): ConversationMessage => ({ ...messages[0], id: `layout-${index}`, messageIndex: index * 2 }));
    const graph = generateConversationGraph(conversation, long);
    const chapter = graph.chapters![0];
    const [manualQuestionId, autoQuestionId] = chapter.questionIds;
    const legacy = {
      ...graph,
      chapterLayoutVersion: undefined,
      chapters: graph.chapters!.map((item) => ({ ...item, x: 740, y: 420 })),
      nodes: graph.nodes.map((node) => node.id === chapter.id
        ? { ...node, x: 740, y: 420, positionSource: "auto" as const }
        : node.id === manualQuestionId
          ? { ...node, x: 888, y: 777, positionSource: "user" as const }
          : node.id === autoQuestionId
            ? { ...node, x: 999, y: 888, positionSource: "auto" as const }
            : node),
    };
    const upgraded = upgradeChapterLayout(legacy);
    expect(upgraded.chapterLayoutVersion).toBe(6);
    expect(upgraded.chapters?.[0]).toMatchObject({ x: 104, y: 112 });
    expect(upgraded.nodes.find((node) => node.id === manualQuestionId)).toMatchObject({ x: 888, y: 777 });
    expect(upgraded.nodes.find((node) => node.id === autoQuestionId)).toMatchObject({ x: 452 });
  });

  it("accepts only valid sidebar drag payloads", () => {
    const payload = JSON.stringify({ kind: "message", conversationId: conversation.id, messageId: "message-1" });
    expect(conversationDragType).toBe("application/x-atlas-conversation-node");
    expect(parseConversationDragPayload(payload)).toEqual({ kind: "question", conversationId: conversation.id, messageId: "message-1" });
    expect(parseConversationDragPayload('{"kind":"message","conversationId":"conversation-1"}')).toBeNull();
    expect(parseConversationDragPayload("not-json")).toBeNull();
    expect(parseLibraryConversationDrag('{"conversationId":"source-1"}')).toEqual({ conversationId: "source-1" });
    expect(parseLibraryConversationDrag("broken")).toBeNull();
  });

  it("migrates an existing localStorage graph to IndexedDB and preserves question coordinates", async () => {
    const legacyId = "legacy-graph";
    localStorage.setItem(`atlas-conversation-graph:${legacyId}`, JSON.stringify({
      conversationId: legacyId,
      updatedAt: 1,
      nodes: [
        { id: "root", conversationId: legacyId, kind: "root", title: "Old root", x: 80, y: 100 },
        { id: "question", conversationId: legacyId, kind: "message", title: "Why?", sourceMessageId: "q1", role: "user", x: 520, y: 250 },
        { id: "answer", conversationId: legacyId, kind: "message", title: "Because", description: "Because it works", sourceMessageId: "a1", role: "assistant", x: 850, y: 272 },
      ],
      edges: [{ id: "edge-1", conversationId: legacyId, source: "root", target: "question" }, { id: "edge-2", conversationId: legacyId, source: "question", target: "answer" }],
    }));
    const loaded = await loadConversationGraph(legacyId);
    expect(loaded?.nodes).toHaveLength(2);
    expect(loaded?.nodes[1]).toMatchObject({ kind: "question", x: 520, y: 250, sourceMessageId: "q1", answerMessageId: "a1" });
    expect(localStorage.getItem(`atlas-conversation-graph:${legacyId}`)).toBeNull();
    expect((await loadConversationGraph(legacyId))?.nodes[1].x).toBe(520);
  });
});
