import type { AtlasCanvas, CanvasCard, OrganizationRun } from "../shared/types";
import type { FocusSession } from "../shared/focus-session";

/** An explicit scope, including an empty one, wins over legacy derived sources. */
export function spaceSourceIds(space: AtlasCanvas | undefined, cards: CanvasCard[], sessions: FocusSession[]): string[] {
  if (!space) return [];
  if (space.sourceConversationIds !== undefined) return [...new Set(space.sourceConversationIds)];
  return [...new Set([
    ...cards.filter((card) => card.canvasId === space.id).flatMap((card) => [...card.conversationIds, ...(card.evidenceRefs ?? []).map((ref) => ref.conversationId)]),
    ...sessions.filter((session) => session.canvasId === space.id).flatMap((session) => session.sourceConversationIds),
  ])];
}

type Target = Pick<OrganizationRun, "targetType" | "targetIds" | "scopeCanvasId" | "intent" | "modelId">;
export function normalizeOrganizationTarget<T extends Target>(target: T): T {
  const targetIds = [...new Set(target.targetIds)];
  if (!targetIds.length || target.targetType === "conversation" && (targetIds.length !== 1 || target.scopeCanvasId)) throw new Error("Conversation chapters require exactly one conversation; select sources before organizing a space.");
  return { ...target, targetIds };
}

/** Repeated clicks resume the same pending proposal instead of paying twice. */
export function pendingOrganization(runs: OrganizationRun[], target: Target): OrganizationRun | undefined {
  return runs.find((run) => ["queued", "running", "waiting_review"].includes(run.status)
    && run.targetType === target.targetType && run.scopeCanvasId === target.scopeCanvasId
    && (run.intent ?? "") === (target.intent ?? "") && (run.modelId ?? "") === (target.modelId ?? "")
    && run.targetIds.length === target.targetIds.length && run.targetIds.every((id) => target.targetIds.includes(id)));
}
