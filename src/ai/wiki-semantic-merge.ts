import type { EmbeddingProvider } from "./embedding-provider";
import type { WikiKnowledgeUnit } from "../shared/wiki-knowledge";
import { sourceMessageSignature } from "../shared/source-signature";
import { getDatabase } from "../storage/db";

/** Semantic recall of knowledge units that state one point. Word overlap cannot tell a reworded restatement
 * (0.33–0.76 shared terms in one run's known repeats) from a different point (up to 0.71): a vector of each
 * statement can. Vectors only propose groups; the merge request confirms them and the local guard still keeps
 * every number, name and prohibition. Without a configured embedding model the organizer recalls by words. */

/** Statements per embedding request, inside the batch limit of the usual OpenAI-compatible endpoints. */
const BATCH = 10, CONCURRENCY = 4;
/** Statement vectors kept between runs, the newest first: a regenerated Wiki embeds only statements it has not seen.
 * One run spent 102 s on 22 embedding requests, each slower than the last (5 s to 28 s) for ten short statements. */
const KEPT_VECTORS = 6000;
const vectorId = (modelKey: string, statement: string) => `${modelKey}:wiki-unit:${sourceMessageSignature(statement)}`;

/** Saved vectors of these statements, by statement. A browser without the store reads none. */
async function savedVectors(modelKey: string, statements: string[]): Promise<Map<string, number[]>> {
  const found = new Map<string, number[]>();
  try {
    const db = await getDatabase();
    const tx = db.transaction("semanticVectors");
    await Promise.all([...new Set(statements)].map(async statement => {
      const row = await tx.store.get(vectorId(modelKey, statement));
      if (row?.textHash === statement) found.set(statement, row.values);
    }));
    await tx.done;
  } catch { /* No store: every statement is embedded. */ }
  return found;
}

async function saveVectors(modelKey: string, rows: Array<[string, number[]]>) {
  if (!rows.length) return;
  try {
    const db = await getDatabase(), now = Date.now();
    const tx = db.transaction("semanticVectors", "readwrite");
    await Promise.all(rows.map(([statement, values]) => tx.store.put({ id: vectorId(modelKey, statement), modelKey, textHash: statement, values, updatedAt: now })));
    if (await tx.store.count() > KEPT_VECTORS) {
      const kept = (await tx.store.getAll()).filter(row => row.id.includes(":wiki-unit:")).sort((a, b) => b.updatedAt - a.updatedAt);
      await Promise.all(kept.slice(KEPT_VECTORS).map(row => tx.store.delete(row.id)));
    }
    await tx.done;
  } catch { /* Not kept: the next run embeds them again. */ }
}
/** Cosine at which two statements are asked about as one point, and at which the guard stops requiring shared
 * words (the model still has to call them one point). Calibrated by the Wiki evaluation, not by a model's scale. */
export const SEMANTIC_CANDIDATE = .82, SEMANTIC_SAME = .9;
/** Units a cluster holds at most, and the closest neighbours each unit joins. */
const CLUSTER = 12, NEIGHBOURS = 6;

export type UnitVectors = Map<string, Float32Array>;

const normalized = (values: number[]) => { const vector = Float32Array.from(values); let size = 0; for (const value of vector) size += value * value; size = Math.sqrt(size) || 1; for (let i = 0; i < vector.length; i++) vector[i] /= size; return vector; };
const dot = (a: Float32Array, b: Float32Array) => { let sum = 0; for (let i = 0; i < a.length; i++) sum += a[i] * b[i]; return sum; };

/** One vector per unit statement, unit length. Undefined when the provider fails: the organizer then recalls by
 * words, as it does with no provider, and the report says so. */
export async function unitVectors(units: WikiKnowledgeUnit[], embeddings: EmbeddingProvider, signal: AbortSignal, report: Record<string, number>): Promise<UnitVectors | undefined> {
  const vectors: UnitVectors = new Map(), saved = await savedVectors(embeddings.modelKey, units.map(unit => unit.statement)), fresh: Array<[string, number[]]> = [];
  for (const unit of units) { const values = saved.get(unit.statement); if (values) vectors.set(unit.id, normalized(values)); }
  if (vectors.size) report.semantic_reused = vectors.size;
  const left = [...new Set(units.filter(unit => !vectors.has(unit.id)).map(unit => unit.statement))], batches: string[][] = [];
  for (let start = 0; start < left.length; start += BATCH) batches.push(left.slice(start, start + BATCH));
  let next = 0, failed = false;
  const worker = async () => {
    while (!failed && next < batches.length) {
      const batch = batches[next++];
      try {
        signal.throwIfAborted();
        report.semantic_requests = (report.semantic_requests ?? 0) + 1;
        const values = await embeddings.embedBatch(batch, signal);
        if (values.length !== batch.length || values.some(vector => !vector?.length)) throw new Error("Missing Wiki vectors");
        batch.forEach((statement, index) => { fresh.push([statement, values[index]]); });
      } catch { failed = true; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, batches.length) }, worker));
  signal.throwIfAborted();
  await saveVectors(embeddings.modelKey, fresh);
  if (failed) {
    report.semantic_failed = 1;
    return undefined;
  }
  const byStatement = new Map(fresh.map(([statement, values]) => [statement, normalized(values)]));
  for (const unit of units) { const vector = byStatement.get(unit.statement); if (vector) vectors.set(unit.id, vector); }
  report.semantic_units = vectors.size;
  if (units.length > left.length + (report.semantic_reused ?? 0)) report.semantic_identical_reused = units.length - left.length - (report.semantic_reused ?? 0);
  return vectors;
}

/** Cosine of two units' statements, or 0 when either has no vector. */
export const vectorSimilarity = (vectors: UnitVectors) => (a: string, b: string) => { const x = vectors.get(a), y = vectors.get(b); return x && y ? dot(x, y) : 0; };

/** How much closer another chapter must be before a subject moves there: below it, the planner's choice stands. */
export const PLACE_MARGIN = .05;
type Chapter = { title: string; subtopics: Array<{ title: string; subjectIds: string[] }> };
const sumInto = (target: Float32Array, values: Float32Array, weight = 1) => { for (let i = 0; i < target.length; i++) target[i] += values[i] * weight; return target; };
const unit = (values: Float32Array) => { let size = 0; for (const value of values) size += value * value; size = Math.sqrt(size) || 1; return values.map(value => value / size); };
/** Subjects placed by what their units say rather than by their names: the planner and the placement requests read a
 * name and a sample, so a reference project or a panel layout landed under a competitor chapter it only mentioned.
 * Each subject goes to the chapter whose other subjects its statements are closest to, when that is clearly closer
 * than its own (PLACE_MARGIN), into that chapter's closest subtopic. A chapter or subtopic is never emptied, and a
 * subject with no vectors stays. Returns how many subjects moved. */
export function placeByContent(chapters: Chapter[], subjects: Array<{ id: string; unitIds: string[] }>, vectors: UnitVectors, allowed: (id: string, from: Chapter, to: Chapter) => boolean = () => true): number {
  const dimension = [...vectors.values()][0]?.length ?? 0;
  if (!dimension || chapters.length < 2) return 0;
  // Sum of unit vectors per subject: chapter and subtopic centres are sums of their subjects, weighted by size.
  const sums = new Map<string, Float32Array>(), sizes = new Map<string, number>();
  for (const subject of subjects) {
    const own = subject.unitIds.flatMap(id => vectors.get(id) ? [vectors.get(id)!] : []);
    if (!own.length) continue;
    sums.set(subject.id, own.reduce((sum, values) => sumInto(sum, values), new Float32Array(dimension))); sizes.set(subject.id, own.length);
  }
  const centre = (ids: string[], without?: string) => { const total = new Float32Array(dimension); let count = 0; for (const id of ids) if (id !== without && sums.has(id)) { sumInto(total, sums.get(id)!); count += sizes.get(id)!; } return count ? unit(total) : undefined; };
  const idsOf = (chapter: Chapter) => chapter.subtopics.flatMap(topic => topic.subjectIds);
  let moved = 0;
  for (const [from, chapter] of chapters.entries()) for (const topic of [...chapter.subtopics]) for (const id of [...topic.subjectIds]) {
    if (!sums.has(id) || idsOf(chapter).length < 2 || topic.subjectIds.length < 2 && chapter.subtopics.length < 2) continue;
    const own = unit(sums.get(id)!), scores = chapters.map((other, index) => { const middle = centre(idsOf(other), index === from ? id : undefined); return middle ? dot(own, middle) : -1; });
    const best = scores.indexOf(Math.max(...scores));
    if (best === from || scores[best] - scores[from] < PLACE_MARGIN || !allowed(id, chapter, chapters[best])) continue;
    const target = chapters[best], into = target.subtopics.map(item => { const middle = centre(item.subjectIds); return middle ? dot(own, middle) : -1; });
    topic.subjectIds = topic.subjectIds.filter(other => other !== id);
    if (!topic.subjectIds.length) chapter.subtopics = chapter.subtopics.filter(item => item !== topic);
    target.subtopics[into.indexOf(Math.max(...into))].subjectIds.push(id);
    moved++;
  }
  return moved;
}

/** Groups of units likely to state one point: each unit joins its closest neighbours at or above the threshold,
 * when compatible allows the pair (about the same thing), and no group grows past CLUSTER. Groups of two or more,
 * largest first, members in the given order. */
export function semanticClusters(units: WikiKnowledgeUnit[], vectors: UnitVectors, compatible: (a: WikiKnowledgeUnit, b: WikiKnowledgeUnit) => boolean, threshold = SEMANTIC_CANDIDATE, similar = vectorSimilarity(vectors)): string[][] {
  const live = units.filter(unit => vectors.has(unit.id)), pairs: Array<{ a: number; b: number; score: number }> = [];
  for (let i = 0; i < live.length; i++) {
    const near: Array<{ b: number; score: number }> = [];
    for (let j = 0; j < live.length; j++) {
      if (i === j) continue;
      const score = similar(live[i].id, live[j].id);
      if (score >= threshold && compatible(live[i], live[j])) near.push({ b: j, score });
    }
    for (const { b, score } of near.sort((x, y) => y.score - x.score).slice(0, NEIGHBOURS)) if (i < b) pairs.push({ a: i, b, score });
  }
  // The closest pairs join first, so a group's cap keeps its most similar members.
  const parent = live.map((_, index) => index), size = live.map(() => 1);
  const root = (at: number): number => { while (parent[at] !== at) { parent[at] = parent[parent[at]]; at = parent[at]; } return at; };
  for (const { a, b } of pairs.sort((x, y) => y.score - x.score)) {
    const x = root(a), y = root(b);
    if (x === y || size[x] + size[y] > CLUSTER) continue;
    const [big, small] = size[x] >= size[y] ? [x, y] : [y, x];
    parent[small] = big; size[big] += size[small];
  }
  const groups = new Map<number, string[]>();
  live.forEach((unit, index) => { const at = root(index); groups.set(at, [...groups.get(at) ?? [], unit.id]); });
  return [...groups.values()].filter(group => group.length > 1).sort((x, y) => y.length - x.length);
}
