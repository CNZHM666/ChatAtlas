import { isDeletedProject, listDeletedProjects } from "./project-deletion";
import type { FocusSession } from "../shared/focus-session";
import { projectQueryThreadId } from "./project-query-threads";
import { getDatabase } from "./db";
import {focusTaskResult} from "../shared/focus-task-result";
import { renamedCanvas } from "./canvases";
import { compactWikiSourceBlocks } from "../shared/wiki-knowledge";
import { sameProject } from "../shared/project-continuation";
import { notifyProjectChange } from "../shared/project-change-notification";
import { sourceMessageSignature } from "../shared/source-signature";

export function focusEditSignature(session: FocusSession): string {
  return sourceMessageSignature(JSON.stringify([session.title, session.goal, session.scope, session.wikiScopeReview, session.wikiProjectBoundary, session.evidence, session.sourceSignatures, session.sourceVersionIds,
    session.wikiOrder, session.wikiGroups, session.sectionNotes, session.notes, session.brief, session.briefUserEdited, session.projectMaintenance,
    session.wikiOverview, session.wikiKnowledge?.decisionsAt, session.wikiKnowledge?.decisions, session.wikiKnowledge?.userAnswers, session.wikiKnowledge?.decisionArbitrations,
    session.wikiKnowledge?.draft?.generatedAt, session.sections]));
}

export function wikiPublishBasis(session: FocusSession): NonNullable<FocusSession["wikiPublishBasis"]> {
  return { id: session.id, editSignature: focusEditSignature(session), sidecarWritingMode: session.sidecarWritingMode, signature: sourceMessageSignature(JSON.stringify([session.title, session.scope, session.wikiOrder,
    session.wikiKnowledge?.decisionsAt, session.wikiKnowledge?.userAnswers, session.wikiKnowledge?.decisionArbitrations, session.sectionNotes, session.notes,
    session.sections.map(chapter => [chapter.id, chapter.title, chapter.body, chapter.userEdited, chapter.structureEdited])])) };
}

export async function listFocusSessions(): Promise<FocusSession[]> {
  const deleted = new Set((await listDeletedProjects()).map(project => project.id));
  return (await (await getDatabase()).getAllFromIndex("focusSessions", "by-updated")).reverse().filter(session => !session.deletedAt && !session.ledgerTest && (!session.canvasId || !deleted.has(session.canvasId)));
}

/** Developer ledger tests, newest first: sessions made only to read their conversations into a ledger. */
export async function listLedgerTestSessions(): Promise<FocusSession[]> {
  return (await (await getDatabase()).getAllFromIndex("focusSessions", "by-updated")).reverse().filter(session => session.ledgerTest);
}

/** A ledger test removed for good: it holds no document or user writing, only a ledger made for testing. */
export async function deleteLedgerTestSession(id: string): Promise<void> {
  const db = await getDatabase(), session = await db.get("focusSessions", id);
  if (session?.ledgerTest) await db.delete("focusSessions", id);
}
/** Deleted versions of projects that still exist, newest deletion first. */
export async function listDeletedFocusSessions(): Promise<FocusSession[]> {
  const deleted = new Set((await listDeletedProjects()).map(project => project.id));
  return (await (await getDatabase()).getAll("focusSessions")).filter(session => session.deletedAt && !session.ledgerTest && !(session.canvasId && deleted.has(session.canvasId))).sort((a, b) => b.deletedAt! - a.deletedAt!);
}

/** One version leaves the project's version list; its text, notes and sources are kept for restoring. */
export async function setFocusSessionDeleted(id: string, deleted: boolean): Promise<void> {
  const tx = (await getDatabase()).transaction("focusSessions", "readwrite");
  const session = await tx.store.get(id);
  if (!session || Boolean(session.deletedAt) === deleted) { await tx.done; return; }
  const next = { ...session };
  if (deleted) next.deletedAt = Date.now(); else delete next.deletedAt;
  await tx.store.put(next);
  await tx.done;
  notifyProjectChange({type:"ATLAS_PROJECT_VERSION_SAVED"});
}

export async function saveFocusSession(session: FocusSession, expectedEditSignature?: string): Promise<FocusSession> {
  if (session.wikiKnowledge) session = { ...session, wikiKnowledge: compactWikiSourceBlocks(session.wikiKnowledge) };
  const db = await getDatabase();
  const tx=db.transaction(["focusSessions","focusGenerationTasks","messages","canvases"],"readwrite");
  const sessions = tx.objectStore("focusSessions");
  const previous = await sessions.get(session.id);
  const canvas = session.canvasId ? await tx.objectStore("canvases").get(session.canvasId) : undefined;
  if (previous?.deletedAt || canvas && isDeletedProject(canvas)
    || expectedEditSignature && previous && focusEditSignature(previous) !== expectedEditSignature) {
    await tx.done;
    throw Object.assign(new Error("The saved project changed before this edit was committed"), {code:"WIKI_PREVIEW_STALE"});
  }
  if (session.status === "ready" && session.wikiPublishBasis && previous?.status !== "ready") {
    const basis = session.wikiPublishBasis;
    const head = (await sessions.getAll()).filter(candidate => candidate.mode === "work" && !candidate.deletedAt
      && candidate.status !== "preview" && sameProject(candidate, session)).sort((a, b) => b.createdAt - a.createdAt || b.updatedAt - a.updatedAt)[0];
    if (!head || head.id !== basis.id || wikiPublishBasis(head).signature !== basis.signature
      || basis.editSignature && focusEditSignature(head) !== basis.editSignature) {
      await tx.done;
      throw Object.assign(new Error("The project changed while this preview was open"), { code: "WIKI_PREVIEW_STALE" });
    }
    const storedMessages = tx.objectStore("messages");
    const valid = await Promise.all(Object.entries(session.sourceSignatures ?? {}).flatMap(([conversationId, signatures]) =>
      Object.entries(signatures).map(async ([messageId, signature]) => {
        const message = await storedMessages.get(messageId);
        return message?.conversationId === conversationId && sourceMessageSignature(message.content) === signature;
      })));
    if (valid.some(match => !match)) {
      await tx.done;
      throw new Error("Sources changed");
    }
    const pending = (head.sidecarConversationIds ?? []).filter(id => !session.sourceConversationIds.includes(id));
    session = { ...session, sidecarConversationIds: pending.length ? pending : undefined,
      sidecarWritingMode: head.sidecarWritingMode !== basis.sidecarWritingMode ? head.sidecarWritingMode : session.sidecarWritingMode ?? head.sidecarWritingMode };
  }
  if (session.status === "ready" && session.wikiPublishBasis) session = { ...session, wikiPublishBasis: undefined };
  if (previous?.historyHiddenAt) session = { ...session, historyHiddenAt: previous.historyHiddenAt };
  if (previous?.status !== "preview" && previous) {
    session = { ...session, sidecarWritingMode: previous.sidecarWritingMode ?? session.sidecarWritingMode,
      sidecarConversationIds: previous.sidecarConversationIds?.filter(id=>!session.sourceConversationIds.includes(id)) };
  }
  await sessions.put(session);
  let tasksChanged=false;
  for(const task of await tx.objectStore("focusGenerationTasks").getAll())if(focusTaskResult(task,[session])&&(task.status!=="preview"||task.sessionId!==session.id)){
    await tx.objectStore("focusGenerationTasks").put({...task,status:"preview",sessionId:session.id,errorCode:undefined,updatedAt:Date.now()});
    tasksChanged=true;
  }
  await tx.done;
  if (session.mode === "work" && session.status !== "preview" && !session.ledgerTest
    && (!previous || previous.status === "preview" || focusEditSignature(previous) !== focusEditSignature(session))) {
    notifyProjectChange({type:"ATLAS_PROJECT_VERSION_SAVED"});
  }
  if(tasksChanged&&typeof window!=="undefined")window.dispatchEvent(new Event("atlas-focus-tasks-changed"));
  if (session.status !== "preview" && JSON.stringify([previous?.sourceSignatures, previous?.scope]) !== JSON.stringify([session.sourceSignatures, session.scope])) void import("../search/semantic-index").then(module => module.refreshProjectVectors(session)).catch(() => undefined);
  return session;
}

/** Save the visible project name together with the active Wiki version. */
export async function renameFocusProject(session: FocusSession, name: string): Promise<FocusSession> {
  const db = await getDatabase();
  const tx = db.transaction(["canvases", "focusSessions"], "readwrite");
  const sessions = tx.objectStore("focusSessions");
  const saved = await sessions.get(session.id);
  const canvas = session.canvasId ? await tx.objectStore("canvases").get(session.canvasId) : undefined;
  if (saved?.deletedAt || session.canvasId && (!canvas || isDeletedProject(canvas))) {
    void tx.done.catch(() => undefined);
    tx.abort();
    throw new Error("项目或版本已不存在 / The project or version no longer exists.");
  }
  const current = saved ?? session;
  const updatedAt = Date.now();
  const next = { ...current, title: name, wikiSuggestedTitle: undefined, updatedAt,
    wikiProjectBoundary: current.wikiProjectBoundary ? { ...current.wikiProjectBoundary, name } : undefined };
  if (canvas) await tx.objectStore("canvases").put(renamedCanvas(canvas, name, updatedAt));
  await sessions.put(next);
  await tx.done;
  notifyProjectChange({type:"ATLAS_PROJECT_VERSION_SAVED"});
  return next;
}

/** Attach the result and its explicitly confirmed sources together. */
export async function attachFocusSession(session: FocusSession, target: { canvasId: string } | { name: string }): Promise<FocusSession> {
  if (session.status === "preview") throw new Error("请先保存并查看预览 / Save and view the preview first.");
  const db = await getDatabase();
  const tx = db.transaction(["canvases", "focusSessions", "canvasMemberships", "sourceRelations", "knowledgeCards", "cards", "projectQueryThreads"], "readwrite");
  const now = Date.now();
  const canvas = "canvasId" in target ? await tx.objectStore("canvases").get(target.canvasId) : {
    id: crypto.randomUUID(), name: target.name.trim(), title: target.name.trim(), type: "topic" as const,
    origin: "user" as const, intent: session.goal, createdAt: now, updatedAt: now,
  };
  if (!canvas || isDeletedProject(canvas) || canvas.type === "overview" || !canvas.name.trim()) {
    void tx.done.catch(() => undefined); tx.abort(); throw new Error("Choose a valid Knowledge Space.");
  }
  const existingSources = new Set(canvas.sourceConversationIds ?? []);
  if (!canvas.sourceConversationIds) {
    // Legacy spaces did not persist an explicit scope. Preserve every linked source.
    const memberships = await tx.objectStore("canvasMemberships").index("by-canvas").getAll(canvas.id);
    for (const membership of memberships) {
      const card = await tx.objectStore("knowledgeCards").get(membership.cardId);
      for (const ref of card?.evidenceRefs ?? []) existingSources.add(ref.conversationId);
      for (const source of await tx.objectStore("sourceRelations").index("by-card").getAll(membership.cardId)) existingSources.add(source.conversationId);
    }
    for (const card of await tx.objectStore("cards").getAll()) if (card.canvasId === canvas.id) for (const id of card.conversationIds) existingSources.add(id);
  }
  await tx.objectStore("canvases").put({ ...canvas, sourceConversationIds: [...new Set([...existingSources, ...session.sourceConversationIds])], updatedAt: now });
  const previousSession = await tx.objectStore("focusSessions").get(session.id);
  if (previousSession?.deletedAt || previousSession && focusEditSignature(previousSession) !== focusEditSignature(session)) {
    void tx.done.catch(() => undefined); tx.abort(); throw new Error("The saved project changed before it could be attached.");
  }
  const current = previousSession ?? session;
  const saved = { ...current, ...(current.wikiKnowledge ? { wikiKnowledge: compactWikiSourceBlocks(current.wikiKnowledge) } : {}),
    canvasId: canvas.id, status: session.status, updatedAt: now };
  const previousThreadId = projectQueryThreadId(session), nextThreadId = projectQueryThreadId(saved);
  if (previousThreadId !== nextThreadId) {
    const store = tx.objectStore("projectQueryThreads");
    const previous = await store.get(previousThreadId), destination = await store.get(nextThreadId);
    if (previous?.turns.length) {
      const turns = [...new Map([...previous.turns, ...(destination?.turns ?? [])].map(turn => [turn.id, turn])).values()].sort((a, b) => a.createdAt - b.createdAt).slice(-50);
      await store.put({ id: nextThreadId, turns, updatedAt: now });
    }
  }
  await tx.objectStore("focusSessions").put(saved);
  await tx.done;
  notifyProjectChange({type:"ATLAS_PROJECT_VERSION_SAVED"});
  void import("../search/semantic-index").then(module => module.refreshProjectVectors(saved)).catch(() => undefined);
  return saved;
}

export function createLivingProject(name: string, goal: string, locale: NonNullable<FocusSession["locale"]>, sidecarWritingMode?: FocusSession["sidecarWritingMode"]) {
  const id = crypto.randomUUID(), now = Date.now();
  const title = name.trim();
  return attachFocusSession({
    id, rootSessionId: id, title, goal: goal.trim(), locale, livingProject: true, sidecarWritingMode,
    mode: "work", strategy: "work", status: "ready", sourceConversationIds: [],
    evidence: [], sections: [], activeSectionId: "", completedSectionIds: [], notes: "",
    createdAt: now, updatedAt: now,
  }, { name: title });
}

export { focusMarkdown } from "../shared/focus-markdown";
