import type { FocusSection, SemanticConcept, SemanticStructure } from "./focus-session";
import { understandingRelationKinds } from "./understanding-relations";

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const statuses = ["discussed", "proposal", "uncertain", "superseded"];
export const semanticId = (key: string) => `ai-concept:${encodeURIComponent(key.normalize("NFKC").trim().toLowerCase())}`;
const boundedList = (value: unknown): string[] | undefined => Array.isArray(value) && value.length <= 6 && value.every(item => typeof item === "string" && item.trim() && item.length <= 80) ? [...new Set(value.map(item => item.trim()))] : undefined;
const normalize = (text: string) => text.replace(/\s+/gu, " ").trim();

/** Optional structure errors must never reject an otherwise usable reading result.
 * Citation membership and literal quotes are checked; they do not prove semantic truth. */
export function validateSemanticStructure(value: unknown, sources: Array<{ id: string; text: string; secondary?: boolean }>, sectionIds?: string[]): SemanticStructure | undefined {
  if (!object(value) || !Array.isArray(value.nodes) || !Array.isArray(value.relations) || value.nodes.length > 80 || value.relations.length > 120) return;
  const byId = new Map(sources.map(source => [source.id, normalize(source.text)]));
  const refs = (item: Record<string, unknown>) => Array.isArray(item.evidenceIds) && item.evidenceIds.length > 0 && item.evidenceIds.length <= 32 && item.evidenceIds.every(id => typeof id === "string" && byId.has(id)) ? [...new Set(item.evidenceIds as string[])] : undefined;
  const cited = (item: Record<string, unknown>, ids: string[]) => typeof item.quote === "string" && normalize(item.quote).length >= 4 && item.quote.length <= 350 && ids.some(id => byId.get(id)!.includes(normalize(item.quote as string)));
  const nodes: SemanticConcept[] = [];
  for (const item of value.nodes) {
    if (!object(item) || typeof item.key !== "string" || !item.key.trim() || item.key.length > 140 || typeof item.title !== "string" || !item.title.trim() || item.title.length > 60 || typeof item.description !== "string" || item.description.length > 240 || !statuses.includes(String(item.status))) continue;
    const nodeKey = item.key.trim();
    const ids = refs(item);
    if (!ids || !cited(item, ids) || nodes.some(node => node.key === nodeKey)) continue;
    const associated = sectionIds ? Array.isArray(item.sectionIds) && item.sectionIds.length && item.sectionIds.every(id => typeof id === "string" && sectionIds.includes(id)) ? [...new Set(item.sectionIds as string[])] : undefined : undefined;
    if (sectionIds && !associated) continue;
    const basis = sources.some(source => ids.includes(source.id) && !source.secondary && normalize(source.text).includes(normalize(item.quote as string))) ? "original" : "summary";
    nodes.push({ key: item.key.trim(), title: item.title.trim(), description: item.description.trim(), ...(typeof item.layer === "string" && item.layer.length <= 60 ? { layer: item.layer.trim() } : {}), ...(boundedList(item.inputs) ? { inputs: boundedList(item.inputs) } : {}), ...(boundedList(item.outputs) ? { outputs: boundedList(item.outputs) } : {}), quote: (item.quote as string).trim(), evidenceIds: ids, status: item.status as SemanticConcept["status"], basis, ...(associated ? { sectionIds: associated } : {}) });
  }
  if (!nodes.length) return;
  const keys = new Set(nodes.map(node => node.key));
  const relations: SemanticStructure["relations"] = [];
  for (const item of value.relations) {
    if (!object(item) || typeof item.from !== "string" || typeof item.to !== "string" || item.from === item.to || !keys.has(item.from) || !keys.has(item.to) || !understandingRelationKinds.includes(item.kind as typeof understandingRelationKinds[number]) || !["supported", "uncertain"].includes(String(item.status))) continue;
    const ids = refs(item);
    if (!ids || !cited(item, ids)) continue;
    if (relations.some(edge => edge.from === item.from && edge.to === item.to && edge.kind === item.kind)) continue;
    relations.push({ from: item.from, to: item.to, kind: item.kind as typeof understandingRelationKinds[number], ...(typeof item.label === "string" && item.label.trim() && item.label.length <= 48 ? { label: item.label.trim() } : {}), quote: (item.quote as string).trim(), evidenceIds: ids, status: item.status as "supported" | "uncertain" });
  }
  return { nodes, relations };
}

export function mergeSemanticStructures(graphs: SemanticStructure[]): SemanticStructure {
  const nodes = new Map<string, SemanticConcept>();
  for (const graph of graphs) for (const node of graph.nodes) {
    const old = nodes.get(node.key);
    // A proposal or superseded version must not become a current historical conclusion.
    const key = old && old.status !== node.status ? `${node.key}:${node.status}` : node.key;
    const previous = nodes.get(key);
    nodes.set(key, previous ? { ...previous, evidenceIds: [...new Set([...previous.evidenceIds, ...node.evidenceIds])], sectionIds: [...new Set([...(previous.sectionIds ?? []), ...(node.sectionIds ?? [])])] } : { ...node, key });
  }
  const relations = new Map<string, SemanticStructure["relations"][number]>();
  for (const graph of graphs) for (const edge of graph.relations) {
    const remap = (key: string) => { const local = graph.nodes.find(node => node.key === key); return local && nodes.get(key)?.status !== local.status ? `${key}:${local.status}` : key; };
    const mapped = { ...edge, from: remap(edge.from), to: remap(edge.to) };
    const id = JSON.stringify([mapped.from, mapped.to, mapped.kind, mapped.status]);
    const old = relations.get(id);
    relations.set(id, old ? { ...old, evidenceIds: [...new Set([...old.evidenceIds, ...mapped.evidenceIds])] } : mapped);
  }
  return { nodes: [...nodes.values()], relations: [...relations.values()] };
}

/** Remap source IDs after composition or an incremental replacement. */
export function mapSemanticEvidence(graph: SemanticStructure | undefined, expand: (ids: string[]) => string[]): SemanticStructure | undefined {
  if (!graph) return;
  const nodes = graph.nodes.map(node => ({ ...node, evidenceIds: expand(node.evidenceIds) })).filter(node => node.evidenceIds.length);
  const keys = new Set(nodes.map(node => node.key));
  return nodes.length ? { nodes, relations: graph.relations.map(edge => ({ ...edge, evidenceIds: expand(edge.evidenceIds) })).filter(edge => edge.evidenceIds.length && keys.has(edge.from) && keys.has(edge.to)) } : undefined;
}

/** Chapter cards point to the cited discussion/anchor, never an unrelated project chapter. */
export function semanticChapterSteps(section: FocusSection): FocusSection[] {
  return (section.semanticStructure?.nodes ?? []).map(node => ({ id: `${semanticId(node.key)}:${section.id}`, title: node.title, body: node.quote, responsibility: node.description, layer: node.layer, inputs: node.inputs, outputs: node.outputs, transition: "", evidenceIds: node.evidenceIds, kind: node.status === "proposal" ? "proposal" : node.status === "uncertain" || node.status === "superseded" ? "open_question" : "review", semanticStructure: { nodes: [node], relations: section.semanticStructure!.relations.filter(edge => edge.from === node.key) } }));
}
