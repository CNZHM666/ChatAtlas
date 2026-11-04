import { useCallback, useEffect, useRef, useState } from "react";
import { providerModelsUrl, hasProviderPermission } from "../../ai/provider";
import { aiMode, effectiveAISettings } from "../../ai/ai-mode";
import { atlasApiClient, DemoApiError } from "../../ai/demo-api";
import type { buildKnowledgeProposal, KnowledgeOrganizeProgress } from "../../ai/proposal-builder";
import { isEmptyManualConversationGraph, loadConversationGraph, saveConversationGraph } from "../conversation-graph";
import { eventsFromConversationGraph, eventsFromKnowledgeProposal, knowledgeProgress, mergeTaskEvents, upsertProgressEvent } from "../../organize/organization-task";
import { getMessagesForConversation } from "../../storage/messages";
import { getAISettings, saveKnowledgeProposal, applyKnowledgeProposal, cancelKnowledgeProposal } from "../../storage/knowledge-graph";
import { listOrganizationRuns, saveOrganizationRun } from "../../storage/organization-runs";
import type { AtlasCanvas, Conversation, KnowledgeCanvas, OrganizationRun } from "../../shared/types";
import { normalizeOrganizationTarget, pendingOrganization } from "../../organize/task-scope";

type StartTarget = Pick<OrganizationRun, "title" | "targetType" | "targetIds" | "scopeCanvasId" | "permissionBaseUrl" | "permissionModelsUrl" | "intent" | "modelId">;

async function boundedPreparation<T>(promise: Promise<T>, signal: AbortSignal, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = globalThis.setTimeout(() => reject(new Error(`${label} timed out. Retry this task.`)), 15_000);
    const abort = () => reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
    signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => { globalThis.clearTimeout(timer); signal.removeEventListener("abort", abort); });
  });
}

export function useOrganizationTasks({ conversations, conversationsReady, canvases, onKnowledgeProposal, onApplied, onError }: {
  conversations: Conversation[]; conversationsReady: boolean; canvases: AtlasCanvas[];
  onKnowledgeProposal: (proposal: Awaited<ReturnType<typeof buildKnowledgeProposal>>) => void;
  onApplied: () => void; onError: (message: string) => void;
}) {
  const [runs, setRuns] = useState<OrganizationRun[]>([]);
  const [loaded, setLoaded] = useState(false);
  const runsRef = useRef<OrganizationRun[]>([]);
  const workingRef = useRef(false);
  const controllerRef = useRef<AbortController | null>(null);
  const currentRunIdRef = useRef<string | null>(null);
  const persistenceRef = useRef<Promise<void>>(Promise.resolve());
  const inputRef = useRef({ conversations, canvases, onKnowledgeProposal, onApplied, onError });
  inputRef.current = { conversations, canvases, onKnowledgeProposal, onApplied, onError };

  const persist = useCallback((run: OrganizationRun) => {
    persistenceRef.current = persistenceRef.current.catch(() => undefined).then(() => saveOrganizationRun(run));
    void persistenceRef.current.catch(() => inputRef.current.onError("Could not save organization history"));
  }, []);

  const updateRun = useCallback((id: string, change: (current: OrganizationRun) => OrganizationRun) => {
    const current = runsRef.current.find((item) => item.id === id);
    if (!current) return;
    const next = { ...change(current), updatedAt: Date.now() };
    runsRef.current = runsRef.current.map((item) => item.id === id ? next : item);
    setRuns([...runsRef.current]);
    persist(next);
  }, [persist]);

  useEffect(() => {
    let live = true;
    void listOrganizationRuns().then((saved) => {
      if (!live) return;
      // A previous page session cannot keep its AbortController. Restart from cached artifacts.
      const recovered = saved.filter(run=>!run.projectAnalysis).map((run) => run.status === "running" ? { ...run, status: "queued" as const, stage: "preparing" as const, progress: 0, work: undefined } : run);
      runsRef.current = [...runsRef.current, ...recovered.filter((run) => !runsRef.current.some((item) => item.id === run.id))];
      setRuns([...runsRef.current]);
      setLoaded(true);
      for (const run of recovered.filter((item) => item.status === "queued")) persist(run);
    }).catch(() => { if (live) setLoaded(true); });
    return () => { live = false; };
  }, [persist]);

  const start = useCallback((target: StartTarget): string => {
    target = normalizeOrganizationTarget(target);
    const pending = pendingOrganization(runsRef.current, target);
    if (pending) return pending.id;
    const now = Date.now();
    const run: OrganizationRun = { id: crypto.randomUUID(), ...target, startedAt: now, updatedAt: now, status: "queued", stage: "preparing", progress: 0, events: [] };
    runsRef.current = [run, ...runsRef.current];
    setRuns([...runsRef.current]);
    persist(run);
    return run.id;
  }, [persist]);

  useEffect(() => {
    if (!loaded || !conversationsReady || workingRef.current) return;
    const knowledgeReviewPending = runsRef.current.some((run) => run.status === "waiting_review" && run.targetType !== "conversation");
    const queued = runsRef.current.find((run) => run.status === "queued" && (run.targetType === "conversation" || !knowledgeReviewPending));
    if (!queued) return;
    workingRef.current = true;
    const runId = queued.id;
    const controller = new AbortController();
    controllerRef.current = controller;
    currentRunIdRef.current = runId;
    updateRun(runId, (run) => ({ ...run, status: "running", stage: "preparing", progress: 0, executionStartedAt: Date.now(), readyAt: undefined, firstReadableAt: undefined, partialChapters: undefined }));
    const work = async () => {
      normalizeOrganizationTarget(queued);
      if (queued.scopeCanvasId && !inputRef.current.canvases.some((canvas) => canvas.id === queued.scopeCanvasId)) throw new Error("This space no longer exists. Choose a space before retrying.");
      const selected = inputRef.current.conversations.filter((item) => queued.targetIds.includes(item.id));
      if (selected.length !== queued.targetIds.length) throw new Error("Some selected conversations are no longer available. Re-select sources and retry.");
      const settings = effectiveAISettings(await boundedPreparation(getAISettings(), controller.signal, "Loading AI settings"));
      if (aiMode(settings) === "byok" && (!settings.apiKey || !settings.model || !settings.baseUrl)) throw new Error("Configure an AI provider first");
      if (aiMode(settings) === "demo") {
        // Establish the session once. The task endpoint reports quota at the point of use;
        // an extra usage request must not fail an otherwise valid analysis.
        await atlasApiClient.getSession(controller.signal);
      }
      const effectiveSettings = queued.modelId ? { ...settings, model: queued.modelId, economyModel: "" } : settings;
      if (aiMode(settings) === "byok") {
        updateRun(runId, (run) => ({ ...run, permissionBaseUrl: settings.baseUrl, permissionModelsUrl: providerModelsUrl(settings) }));
        if (!await boundedPreparation(hasProviderPermission(settings.baseUrl), controller.signal, "Checking provider access")) throw new Error("AI provider access is missing. Open Settings → AI, test the connection, then retry.");
      }
      controller.signal.throwIfAborted();
      const { createAtlasAI } = await import("../../ai/atlas-ai");
      controller.signal.throwIfAborted();
      const provider = createAtlasAI(effectiveSettings, controller.signal, runId, (activity) => {
        if (!controller.signal.aborted) updateRun(runId, (run) => ({ ...run, activity: activity ?? undefined }));
      });
      const mode = settings.analysisMode ?? "balanced";
      if (queued.targetType === "conversation") {
        const { organizeConversationKnowledgeGraph } = await import("../../ai/conversation-knowledge-graph");
        controller.signal.throwIfAborted();
        const conversation = selected[0];
        const original = await loadConversationGraph(conversation.id);
        updateRun(runId, (run) => ({ ...run, baselineGraphUpdatedAt: original?.updatedAt, replacesUserEdited: Boolean(original?.userEdited && !isEmptyManualConversationGraph(original, conversation)), stage: "question_analysis", progress: 10, work: { current: 0, total: conversation.messageCount ?? 0 } }));
        const messages = await getMessagesForConversation(conversation.id);
        const questions = messages.filter((item) => item.role === "user").length;
        updateRun(runId, (run) => ({ ...run, stage: "question_analysis", progress: 5, work: { current: 0, total: questions } }));
        const graph = await organizeConversationKnowledgeGraph({ conversation, runId, messages, provider, mode, signal: controller.signal,
          onPartial: (chapters) => { if (!controller.signal.aborted) updateRun(runId, (run) => ({ ...run, partialChapters: chapters, firstReadableAt: run.firstReadableAt ?? Date.now() })); }, onProgress: (stage, current, total) => {
          if (controller.signal.aborted) return;
          const mapped = stage === "questions" ? { name: "question_analysis" as const, start: 5, weight: 35 } : stage === "planning" ? { name: "structure_planning" as const, start: 40, weight: 45 } : { name: "structure_validation" as const, start: 85, weight: 10 };
          updateRun(runId, (run) => ({ ...run, stage: mapped.name, progress: Math.max(run.progress, Math.round(mapped.start + mapped.weight * (total ? Math.min(1, current / total) : 0))), work: { current, total },
            events: total && current === total ? upsertProgressEvent(run.events, mapped.name, current, total) : run.events }));
        } });
        controller.signal.throwIfAborted();
        const now = Date.now();
        const events = [...eventsFromConversationGraph(graph, now), { type: "proposal_ready" as const, proposalId: runId, timestamp: now }];
        updateRun(runId, (run) => ({ ...run, status: "waiting_review", stage: "proposal_ready", progress: 100, readyAt: Date.now(), work: undefined, proposalId: runId, proposalGraph: graph, events: mergeTaskEvents(run.events, events),
          summary: { bridgesAdded: graph.nodes.filter((node) => node.kind === "bridge").length, insightsAdded: graph.nodes.filter((node) => node.kind === "insight").length, draftsSuggested: graph.nodes.filter((node) => node.kind === "draft").length } }));
        return;
      }
      // A Knowledge Space needs representative source profiles first. Conversation
      // chapters remain available as a separate, explicit organization task.
      const progressHandler = (progress: KnowledgeOrganizeProgress) => {
        if (controller.signal.aborted) return;
        const mapped = knowledgeProgress(progress);
        updateRun(runId, (run) => ({ ...run, ...mapped, progress: Math.max(run.progress, mapped.progress), events: progress.total && progress.completed === progress.total ? upsertProgressEvent(run.events, mapped.stage, progress.completed, progress.total) : run.events }));
      };
      const { buildKnowledgeProposal } = await import("../../ai/proposal-builder");
      controller.signal.throwIfAborted();
      const proposal = await buildKnowledgeProposal({
        conversations: selected, runId, intent: queued.intent, intentTitle: queued.title, scopeCanvasId: queued.scopeCanvasId, loadMessages: getMessagesForConversation,
        existingCanvases: inputRef.current.canvases.filter((canvas) => canvas.type !== "overview").map<KnowledgeCanvas>((canvas) => ({
          id: canvas.id, title: canvas.title ?? canvas.name, description: canvas.description, type: "topic",
          origin: canvas.origin ?? "user", userEdited: canvas.userEdited ?? false, intent: canvas.intent, sourceConversationIds: canvas.sourceConversationIds, readingPathCardIds: canvas.readingPathCardIds, readingPathUserEdited: canvas.readingPathUserEdited, createdAt: canvas.createdAt, updatedAt: canvas.updatedAt,
        })),
        provider, mode, requireAI: true, signal: controller.signal, onProgress: progressHandler,
        onDiscoveries: (events) => { if (!controller.signal.aborted) updateRun(runId, (run) => ({ ...run, events: mergeTaskEvents(run.events, events) })); },
      });
      controller.signal.throwIfAborted();
      if (!proposal.canvases.length && !proposal.cards.length && !proposal.memberships.length && !proposal.relations.length && !proposal.sources.length && !proposal.scopeUpdates?.length) {
        updateRun(runId, (run) => ({ ...run, status: "completed", stage: "proposal_ready", progress: 100, completedAt: Date.now(), events: [...run.events, { type: "structure_revision", message: "no_changes", timestamp: Date.now() }, { type: "completed", timestamp: Date.now() }] }));
        return;
      }
      await saveKnowledgeProposal(proposal);
      if (controller.signal.aborted) { await cancelKnowledgeProposal(proposal.id); return; }
      inputRef.current.onKnowledgeProposal(proposal);
      updateRun(runId, (run) => ({ ...run, status: "waiting_review", stage: "proposal_ready", progress: 100, readyAt: Date.now(), work: undefined, proposalId: proposal.id,
        events: mergeTaskEvents(run.events, eventsFromKnowledgeProposal(proposal)),
        summary: { conceptsAdded: proposal.cards.filter((card) => card.type === "concept").length, conceptsMerged: run.events.filter((event) => event.type === "concept_merged").length, relationsAdded: proposal.relations.length,
          bridgesAdded: proposal.cards.filter((card) => card.type === "bridge").length, insightsAdded: proposal.cards.filter((card) => card.type === "insight").length,
          draftsSuggested: proposal.cards.filter((card) => card.type === "draft").length } }));
    };
    void work().catch((error) => {
      if (controller.signal.aborted) return;
      const message = error instanceof Error ? error.message : String(error);
      updateRun(runId, (run) => ({ ...run, status: "failed", error: message, errorCode: error instanceof DemoApiError ? error.code : undefined, work: undefined, activity: undefined }));
      inputRef.current.onError(message);
    }).finally(() => { if (controllerRef.current === controller) controllerRef.current = null; currentRunIdRef.current = null; workingRef.current = false; setRuns([...runsRef.current]); });
  }, [loaded, conversationsReady, runs, conversations.length, updateRun]);

  const apply = useCallback(async (run: OrganizationRun, knowledgeProposal: Awaited<ReturnType<typeof buildKnowledgeProposal>> | null, selection?: { canvasIds: ReadonlySet<string>; conversationIds: ReadonlySet<string> }) => {
    if (run.status !== "waiting_review") return;
    let appliedSummary = run.summary;
    if (run.targetType === "conversation") {
      if (!run.proposalGraph) throw new Error("Conversation proposal is unavailable");
      const current = await loadConversationGraph(run.targetIds[0]);
      if (current?.updatedAt !== run.baselineGraphUpdatedAt) throw new Error("The conversation canvas changed during organization. Review it before applying.");
      await saveConversationGraph({ ...run.proposalGraph, updatedAt: Date.now() });
      void import("../../search/semantic-index").then(({ queueSemanticVectorRefresh }) => queueSemanticVectorRefresh(run.targetIds, run.id)).catch(() => undefined);
    } else {
      if (!knowledgeProposal || knowledgeProposal.id !== run.proposalId) throw new Error("Knowledge proposal is unavailable");
      const selectedGraphs = (run.conversationProposals ?? []).filter((item) => !selection || selection.conversationIds.has(item.conversationId));
      const { selectKnowledgeProposal } = await import("../../ai/proposal-selection");
      const selectedProposal = selection ? selectKnowledgeProposal(knowledgeProposal, selection.canvasIds) : knowledgeProposal;
      if (!selectedProposal.cards.length && !selectedProposal.canvases.length && !selectedProposal.memberships.length && !selectedProposal.relations.length && !selectedProposal.sources.length && !selectedProposal.scopeUpdates?.length && !selectedGraphs.length) throw new Error("Select at least one change before applying.");
      for (const item of selectedGraphs) {
        const current = await loadConversationGraph(item.conversationId);
        if (current?.updatedAt !== item.baselineGraphUpdatedAt) throw new Error("A conversation canvas changed during organization. Review it before applying.");
      }
      await applyKnowledgeProposal(selectedProposal, selectedGraphs.map((item) => item.graph), new Map(selectedGraphs.map((item) => [item.conversationId, item.baselineGraphUpdatedAt])));
      void import("../../search/semantic-index").then(({ queueSemanticVectorRefresh }) => queueSemanticVectorRefresh([...new Set([...selectedGraphs.map((item) => item.conversationId), ...selectedProposal.analyzedConversationIds])], run.id)).catch(() => undefined);
      if (selection) appliedSummary = {
        conceptsAdded: selectedProposal.cards.filter((card) => card.type === "concept" || card.type === "topic").length,
        relationsAdded: selectedProposal.relations.length,
        bridgesAdded: selectedProposal.cards.filter((card) => card.type === "bridge").length,
        insightsAdded: selectedProposal.cards.filter((card) => card.type === "insight").length,
        draftsSuggested: selectedProposal.cards.filter((card) => card.type === "draft").length,
      };
    }
    updateRun(run.id, (current) => ({ ...current, status: "completed", summary: appliedSummary, completedAt: Date.now(), events: [...current.events, { type: "completed", timestamp: Date.now() }] }));
    inputRef.current.onApplied();
  }, [updateRun]);

  const discard = useCallback(async (run: OrganizationRun) => {
    if (run.targetType !== "conversation" && run.proposalId) await cancelKnowledgeProposal(run.proposalId);
    updateRun(run.id, (current) => ({ ...current, status: "cancelled", completedAt: Date.now() }));
    inputRef.current.onApplied();
  }, [updateRun]);

  const retry = useCallback((run: OrganizationRun) => {
    if (run.status !== "failed") return;
    updateRun(run.id, (current) => ({ ...current, status: "queued", error: undefined, errorCode: undefined, stage: "preparing", progress: 0, work: undefined }));
  }, [updateRun]);

  const cancel = useCallback((run: OrganizationRun) => {
    if (run.status !== "queued" && run.status !== "running") return;
    if (currentRunIdRef.current === run.id) controllerRef.current?.abort();
    updateRun(run.id, (current) => ({ ...current, status: "cancelled", completedAt: Date.now(), work: undefined }));
  }, [updateRun]);

  return { runs, start, apply, discard, retry, cancel };
}
