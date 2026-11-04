import type { FocusEvidence, FocusSession } from "./focus-session";
import type { ProjectModule, ProjectRecord, ProjectSource } from "./project-state";

export interface ProjectChange {
  id: string;
  category: "module" | "decision" | "constraint" | "question" | "relation";
  kind: "added" | "changed" | "superseded" | "conflict" | "resolved" | "source_changed";
  before?: string;
  after?: string;
  reason: string;
  beforeQuote?: string;
  afterQuote?: string;
  beforeSources: FocusEvidence[];
  afterSources: FocusEvidence[];
  sourceSnapshots: ProjectSource[];
  proposedAt: number;
  acceptedAt?: number;
  previousSessionId: string;
  affectedSectionIds: string[];
}

/** Describe actual fact deltas, retaining both sides instead of rewriting history. */
export function projectChangeEvents(previous: FocusSession, next: FocusSession): ProjectChange[] {
  const old = previous.projectState, state = next.projectState;
  if (!state) return [];
  const events: ProjectChange[] = [];
  const refs = (session: FocusSession, ids: string[]) => session.evidence.filter(ref => ids.includes(ref.id)).map(ref => ({ ...ref }));
  const text = (item: ProjectModule | ProjectRecord) => "title" in item ? `${item.title}：${item.purpose}` : item.text;
  const fields = (item: ProjectModule | ProjectRecord) => JSON.stringify("title" in item ? [item.title, item.layer, item.purpose, item.inputs, item.outputs, item.status] : [item.text, item.reason, item.status]);
  const categories = [["module", old?.modules, state.modules], ["decision", old?.decisions, state.decisions], ["constraint", old?.constraints, state.constraints], ["question", old?.questions, state.questions]] as const;
  for (const [category, before = [], after = []] of categories) {
    for (const item of after) {
      const prior = before.find(record => record.id === item.id);
      if (prior && fields(prior) === fields(item)) continue;
      const beforeSources = prior ? refs(previous, prior.evidenceIds) : [], afterSources = refs(next, item.evidenceIds);
      const keys = new Set([...beforeSources, ...afterSources].map(ref => JSON.stringify([ref.conversationId, ref.messageId])));
      events.push({ id: `${next.id}:${category}:${item.id}`, category, kind: item.status === "superseded" ? category === "question" ? "resolved" : "superseded" : item.status === "uncertain" ? "conflict" : prior ? "changed" : "added", before: prior ? text(prior) : undefined, after: text(item), reason: "reason" in item ? item.reason : "", beforeQuote: prior?.quote, afterQuote: item.quote, beforeSources, afterSources,
        sourceSnapshots: [...(old?.sources ?? []), ...(state.sources ?? [])].filter(source => [...beforeSources, ...afterSources].some(ref => ref.id === source.id)), proposedAt: next.createdAt, previousSessionId: previous.id,
        affectedSectionIds: next.sections.filter(section => next.evidence.some(ref => section.evidenceIds.includes(ref.id) && keys.has(JSON.stringify([ref.conversationId, ref.messageId])))).map(section => section.id) });
    }
    for (const item of before) if (!after.some(record => record.id === item.id)) events.push({ id: `${next.id}:${category}:${item.id}:missing`, category, kind: "source_changed", before: text(item), reason: "", beforeQuote: item.quote, beforeSources: refs(previous, item.evidenceIds), afterSources: [], sourceSnapshots: old?.sources?.filter(source => item.evidenceIds.includes(source.id)) ?? [], proposedAt: next.createdAt, previousSessionId: previous.id, affectedSectionIds: [] });
  }
  const edgeKey = (edge: NonNullable<FocusSession["projectState"]>["relations"][number]) => JSON.stringify([edge.from, edge.to, edge.kind, edge.label]);
  for (const edge of state.relations) if (!old?.relations.some(prior => edgeKey(prior) === edgeKey(edge))) {
    const prior = old?.relations.find(item => item.from === edge.from && item.to === edge.to && item.kind === edge.kind);
    const label = (item: typeof edge, modules: typeof state.modules) => `${modules.find(module => module.id === item.from)?.title ?? item.from} → ${item.label} → ${modules.find(module => module.id === item.to)?.title ?? item.to}`;
    events.push({ id: `${next.id}:relation:${edgeKey(edge)}`, category: "relation", kind: prior ? "changed" : "added", before: prior && old ? label(prior, old.modules) : undefined, after: label(edge, state.modules), reason: "", beforeQuote: prior?.quote, afterQuote: edge.quote, beforeSources: prior ? refs(previous, prior.evidenceIds) : [], afterSources: refs(next, edge.evidenceIds), sourceSnapshots: [...(old?.sources ?? []), ...(state.sources ?? [])].filter(source => [...(prior?.evidenceIds ?? []), ...edge.evidenceIds].includes(source.id)), proposedAt: next.createdAt, previousSessionId: previous.id, affectedSectionIds: next.sections.filter(section => [...(prior?.evidenceIds ?? []), ...edge.evidenceIds].some(id => section.evidenceIds.includes(id))).map(section => section.id) });
  }
  for (const edge of old?.relations ?? []) if (!state.relations.some(item => item.from === edge.from && item.to === edge.to && item.kind === edge.kind)) {
    events.push({ id: `${next.id}:relation:${edgeKey(edge)}:missing`, category: "relation", kind: "source_changed", before: `${old?.modules.find(module => module.id === edge.from)?.title ?? edge.from} → ${edge.label} → ${old?.modules.find(module => module.id === edge.to)?.title ?? edge.to}`, reason: "", beforeQuote: edge.quote, beforeSources: refs(previous, edge.evidenceIds), afterSources: [], sourceSnapshots: old?.sources?.filter(source => edge.evidenceIds.includes(source.id)) ?? [], proposedAt: next.createdAt, previousSessionId: previous.id, affectedSectionIds: [] });
  }
  return events;
}
