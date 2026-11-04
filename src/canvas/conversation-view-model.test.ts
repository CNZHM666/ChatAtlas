import { describe, expect, it } from "vitest";
import type { Conversation, ConversationMessage } from "../shared/types";
import { addManualChapter, createManualConversationGraph, generateConversationGraph } from "./conversation-graph";
import { hiddenConversationNodeIds, visibleConversationEdges, visibleConversationNodeIds } from "./conversation-view-model";

const conversation: Conversation = { id: "long-view", platform: "chatgpt", title: "Long discussion", url: "https://chatgpt.com/c/long-view", messageCount: 66, updatedAt: 1 };
const questions: ConversationMessage[] = Array.from({ length: 66 }, (_, index) => ({ id: `view-q-${index}`, conversationId: conversation.id, messageIndex: index, role: "user", content: `Product design question ${index}`, preview: `Product design question ${index}`, contentHash: `${index}`, createdAt: index, updatedAt: index }));

describe("conversation knowledge backbone", () => {
  it("compresses 66 questions into a chapter-only overview without a root edge", () => {
    const graph = generateConversationGraph(conversation, questions);
    const visible = visibleConversationNodeIds(graph, false, new Set(), null);
    const edges = visibleConversationEdges(graph, visible, false, null);
    expect(graph.chapters?.length).toBeGreaterThanOrEqual(5);
    expect(graph.chapters?.length).toBeLessThanOrEqual(9);
    expect([...visible].filter((id) => id.startsWith("conversation-message-"))).toHaveLength(0);
    expect([...visible].filter((id) => id.startsWith("conversation-chapter-"))).toHaveLength(graph.chapters?.length ?? 0);
    expect(edges).toHaveLength((graph.chapters?.length ?? 0) - 1);
    expect(edges.every((edge) => !edge.source.startsWith("conversation-root-"))).toBe(true);
  });

  it("only reveals a chosen chapter's questions and nonlinear relation edges on demand", () => {
    const graph = generateConversationGraph(conversation, questions);
    const chapter = graph.chapters![0];
    const visible = visibleConversationNodeIds(graph, false, new Set(), chapter.id);
    const edges = visibleConversationEdges(graph, visible, false, chapter.id);
    expect([...visible].filter((id) => id.startsWith("conversation-message-"))).toHaveLength(chapter.questionIds.length);
    expect([...visible].filter((id) => id.startsWith("conversation-chapter-"))).toEqual([chapter.id]);
    expect(edges.every((edge) => edge.id.startsWith("question-relation-"))).toBe(true);
  });

  it("keeps the chapter backbone compact while editing a long conversation", () => {
    const graph = generateConversationGraph(conversation, questions);
    const visible = visibleConversationNodeIds(graph, true, new Set(), null);
    expect([...visible].filter((id) => id.startsWith("conversation-message-"))).toHaveLength(0);
  });
  it("shows manually placed questions while editing their chapter connections", () => {
    const graph = { ...generateConversationGraph(conversation, questions), organizationMode: "manual" as const };
    const visible = visibleConversationNodeIds(graph, true, new Set(), null);
    expect([...visible].filter((id) => id.startsWith("conversation-message-"))).toHaveLength(66);
  });
  it("shows title and chapter cards with their link as soon as a manual chapter is created", () => {
    const graph = addManualChapter(createManualConversationGraph(conversation), "First chapter");
    const visible = visibleConversationNodeIds(graph, false, new Set(), null);
    expect([...visible]).toEqual([`conversation-root-${conversation.id}`, graph.chapters![0].id]);
    expect(visibleConversationEdges(graph, visible, false, null)).toMatchObject([{ source: `conversation-root-${conversation.id}`, target: graph.chapters![0].id }]);
    const withQuestion = { ...graph, nodes: [...graph.nodes, { id: "conversation-message-placed", conversationId: conversation.id, kind: "question" as const, title: "Placed question", x: 360, y: 120 }] };
    expect(visibleConversationNodeIds(withQuestion, false, new Set(), null).has("conversation-message-placed")).toBe(true);
  });
  it("shows several chapter links from the same node in manual browse mode", () => {
    const graph = addManualChapter(addManualChapter(createManualConversationGraph(conversation), "One"), "Two");
    const visible = visibleConversationNodeIds(graph, false, new Set(), null);
    expect(visibleConversationEdges(graph, visible, false, null).map((edge) => [edge.source, edge.target])).toEqual(graph.chapters!.map((chapter) => [`conversation-root-${conversation.id}`, chapter.id]));
  });

  it("hides only a collapsed chapter's questions and restores them on expansion", () => {
    const graph = generateConversationGraph(conversation, questions);
    const [first, second] = graph.chapters!;
    const expanded = { ...graph, chapters: graph.chapters!.map((chapter) => chapter.id === first.id ? { ...chapter, collapsed: false } : chapter) };
    const visibleExpanded = visibleConversationNodeIds(expanded, true, hiddenConversationNodeIds(expanded, new Set(), true), null);
    expect(first.questionIds.every((id) => visibleExpanded.has(id))).toBe(true);
    expect(visibleExpanded.has(second.id)).toBe(true);

    const collapsed = { ...expanded, chapters: expanded.chapters.map((chapter) => chapter.id === first.id ? { ...chapter, collapsed: true } : chapter) };
    const visibleCollapsed = visibleConversationNodeIds(collapsed, true, hiddenConversationNodeIds(collapsed, new Set(), true), null);
    expect(first.questionIds.every((id) => !visibleCollapsed.has(id))).toBe(true);
    expect(visibleCollapsed.has(first.id)).toBe(true);
    expect(visibleCollapsed.has(second.id)).toBe(true);
  });

  it("collapses and expands branches on other cards", () => {
    const graph = addManualChapter(createManualConversationGraph(conversation), "Chapter");
    const root = `conversation-root-${conversation.id}`;
    const hidden = hiddenConversationNodeIds(graph, new Set([root]), true);
    expect(hidden.has(graph.chapters![0].id)).toBe(true);
    expect(visibleConversationNodeIds(graph, true, hidden, null).has(graph.chapters![0].id)).toBe(false);
    expect(visibleConversationNodeIds(graph, true, hiddenConversationNodeIds(graph, new Set(), true), null).has(graph.chapters![0].id)).toBe(true);
  });
});
