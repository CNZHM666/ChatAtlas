import { isDeletedProject } from "./project-deletion";
import { groupFocusVersions } from "../canvas/focus-versions";
import { reviewLead } from "../canvas/review-presentation";
import { sourceReviewOutline } from "../canvas/source-review-outline";
import { understandingRoute } from "../canvas/understanding-route";
import type { FocusSession } from "../shared/focus-session";
import type { SidecarData, SidecarReading } from "../shared/sidecar";
import type { AtlasCanvas, Conversation, ConversationGraph, ConversationMessage } from "../shared/types";
import { getDatabase } from "./db";

function sidecarLead(body: string): string {
  const sentence = reviewLead(body);
  const characters = [...sentence];
  return characters.length > 280 ? `${characters.slice(0, 280).join("")}…` : sentence;
}

export function buildSidecarData(conversationId: string, sessions: FocusSession[], projects: AtlasCanvas[], conversation?: Conversation, graph?: ConversationGraph, messages: ConversationMessage[] = []): SidecarData {
  const deleted = new Set(projects.filter(isDeletedProject).map(project => project.id));
  sessions = sessions.filter(session => !session.canvasId || !deleted.has(session.canvasId));
  projects = projects.filter(project => !deleted.has(project.id));
  const projectById = new Map(projects.map(project => [project.id, project]));
  // Accepted content wins over an unconfirmed revision; keep distinct goals.
  const selected = groupFocusVersions(sessions).flatMap(group => {
    const saved = group.versions.find(session => session.status !== "preview" && session.sections.length) ?? group.versions.find(session => session.sections.length);
    return saved?.sourceConversationIds.includes(conversationId) ? [saved] : [];
  }).sort((a, b) => b.updatedAt - a.updatedAt);
  const readings: SidecarReading[] = selected.map(session => ({
    id: session.id, sessionId: session.id,
    projectTitle: session.canvasId ? projectById.get(session.canvasId)?.name : undefined,
    title: session.title, preview: session.status === "preview", sourceCount: session.sourceConversationIds.length,
    summary: session.brief?.summary ?? "",
    turningPoints: session.brief?.turningPoints.map(item => item.text) ?? [],
    confirmed: session.brief?.confirmed.map(item => item.text) ?? [],
    openQuestions: [...new Set([...(session.brief?.openQuestions ?? []), ...session.sections.filter(section => section.kind === "open_question").map(section => section.title)])],
    activeSectionId: session.activeSectionId,
    sections: session.sections.map(section => ({ id: section.id, title: section.title, lead: sidecarLead(section.body), transition: section.transition, kind: section.kind, personal: section.origin === "user", completed: session.completedSectionIds.includes(section.id) })),
  }));
  if (!readings.length) {
    const reused = sourceReviewOutline(conversationId, messages, sessions);
    const chapters = graph?.chapters?.some(chapter => chapter.source === "user" || chapter.createdManually) ? graph.chapters : reused.chapters.length ? reused.chapters : graph?.chapters ?? [];
    const cards = (graph?.nodes ?? []).filter(node => ["topic", "bridge", "insight", "draft"].includes(node.kind));
    const route = understandingRoute([...chapters].sort((a, b) => a.order - b.order).map(chapter => chapter.id), cards.map(card => card.id), graph?.understandingRoute);
    if (route.length) readings.push({
      id: `source:${conversationId}`, title: conversation?.title ?? "", preview: false, sourceCount: 1,
      summary: "", turningPoints: [], confirmed: [], openQuestions: [], activeSectionId: "",
      sections: route.map(item => {
        const chapter = chapters.find(chapter => chapter.id === item.id);
        const card = cards.find(card => card.id === item.id);
        return { id: item.id, title: chapter?.title ?? card?.title ?? "", lead: sidecarLead(chapter?.summary ?? card?.description ?? ""), transition: chapter?.transition ?? "", kind: "review", personal: item.kind === "card", completed: false };
      }),
    });
  }
  return { conversationId, title: conversation?.title ?? graph?.nodes.find(node => node.kind === "conversation-root")?.title ?? "", readings };
}

/** Reads local saved results only; opening ChatGPT must never start generation. */
export async function getSidecarData(conversationId: string): Promise<SidecarData> {
  const db = await getDatabase();
  const [sessions, projects, conversation] = await Promise.all([
    db.getAll("focusSessions"), db.getAll("canvases"), db.get("conversations", conversationId),
  ]);
  // A deleted version is not offered from the sidebar.
  const live = sessions.filter(session => !session.deletedAt && !session.ledgerTest);
  const saved = buildSidecarData(conversationId, live, projects, conversation);
  if (saved.readings.length) return saved;
  const [graph, messages] = await Promise.all([db.get("conversationGraphs", conversationId), db.getAllFromIndex("messages", "by-conversation", conversationId)]);
  return buildSidecarData(conversationId, live, projects, conversation, graph, messages);
}
