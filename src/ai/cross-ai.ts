/** Cross-AI organization support. Everything here is local and deterministic:
 * no model call, and projects drawn from a single platform are left untouched
 * so their requests and caches stay byte-identical. */

export interface CrossAIMaterial { id: string; role?: string; conversationId: string; messageId: string; messageIndex?: number; platform?: string; text: string; rawEvidenceIds: string[] }

/** One user question asked on several AI platforms, with each platform's answer. */
export interface SameQuestionGroup {
  key: string;
  question: string;
  answers: Array<{ platform: string; conversationId: string; rawIds: string[] }>;
}

export const isCrossPlatform = (platforms: Iterable<string | undefined>) => new Set([...platforms].filter(Boolean)).size > 1;

// Short follow-ups ("继续", "ok") match everything; they are not questions to compare.
const MIN_QUESTION_CHARACTERS = 12;
const MAX_COMPARED_CHARACTERS = 2000;
// A bigram shared by this many questions carries no signal and only costs time.
const MAX_POSTINGS = 200;
const MAX_GROUPS = 64;

const normalize = (text: string) => text.replace(/^(?:user|assistant|system|tool): /u, "").toLowerCase().replace(/[\p{P}\p{S}\s]+/gu, "").slice(0, MAX_COMPARED_CHARACTERS);
const bigrams = (text: string) => { const grams = new Set<string>(); for (let index = 0; index < text.length - 1; index++) grams.add(text.slice(index, index + 2)); return grams; };

/** Two questions match when most of the shorter one appears in the longer one
 * and they still share a substantial part overall, so a pasted extra paragraph
 * does not hide the same question, but one shared phrase does not merge topics. */
function similar(a: Set<string>, b: Set<string>, shared: number) {
  return shared / Math.min(a.size, b.size) >= 0.75 && shared / (a.size + b.size - shared) >= 0.4;
}

/** Find the same user question asked on different AI platforms. Each answer
 * covers the question and the assistant replies before the next user turn. */
export function sameQuestionGroups(materials: CrossAIMaterial[]): SameQuestionGroup[] {
  if (!isCrossPlatform(materials.map(item => item.platform))) return [];
  type Question = { conversationId: string; messageId: string; platform: string; text: string; grams: Set<string>; rawIds: string[]; order: number };
  const questions: Question[] = [];
  let current: Question | undefined;
  for (const [order, item] of materials.entries()) {
    if (!item.platform) { current = undefined; continue; }
    if (item.role === "user") {
      // Long messages are split into several parts with the same message ID.
      if (current && current.conversationId === item.conversationId && current.messageId === item.messageId) { current.text += item.text.replace(/^user: /u, ""); current.rawIds.push(...item.rawEvidenceIds); continue; }
      current = { conversationId: item.conversationId, messageId: item.messageId, platform: item.platform, text: item.text.replace(/^user: /u, ""), grams: new Set(), rawIds: [...item.rawEvidenceIds], order };
      questions.push(current);
    } else if (current && current.conversationId === item.conversationId) current.rawIds.push(...item.rawEvidenceIds);
    else current = undefined;
  }
  const eligible = questions.filter(question => { const text = normalize(question.text); question.grams = bigrams(text); return text.length >= MIN_QUESTION_CHARACTERS; });
  const postings = new Map<string, number[]>();
  for (const [index, question] of eligible.entries()) for (const gram of question.grams) { const list = postings.get(gram) ?? []; list.push(index); postings.set(gram, list); }
  const parent = eligible.map((_, index) => index);
  const find = (index: number): number => parent[index] === index ? index : (parent[index] = find(parent[index]));
  for (const [index, question] of eligible.entries()) {
    const shared = new Map<number, number>();
    for (const gram of question.grams) {
      const list = postings.get(gram)!;
      if (list.length > MAX_POSTINGS) continue;
      for (const other of list) if (other > index && eligible[other].platform !== question.platform) shared.set(other, (shared.get(other) ?? 0) + 1);
    }
    for (const [other, count] of shared) if (similar(question.grams, eligible[other].grams, count)) parent[find(other)] = find(index);
  }
  const clusters = new Map<number, Question[]>();
  for (const [index, question] of eligible.entries()) { const root = find(index); clusters.set(root, [...clusters.get(root) ?? [], question]); }
  return [...clusters.values()]
    .filter(members => new Set(members.map(member => member.platform)).size > 1)
    .sort((a, b) => a[0].order - b[0].order)
    .slice(0, MAX_GROUPS)
    .map((members, index) => ({
      key: `q${index + 1}`,
      question: members[0].text.replace(/\s+/gu, " ").trim().slice(0, 200),
      answers: members.map(member => ({ platform: member.platform, conversationId: member.conversationId, rawIds: member.rawIds })),
    }));
}

/** Mark writing passages that belong to a same-question group present in THIS
 * request with at least two platforms; other groups would only add noise. */
export function sameQuestionAnnotations(groups: SameQuestionGroup[], batch: Array<{ id: string; rawEvidenceIds: string[] }>) {
  const passageKeys = new Map<string, string[]>();
  const questions: Array<{ key: string; question: string; platforms: string[] }> = [];
  for (const group of groups) {
    const present = group.answers.flatMap(answer => {
      const ids = batch.filter(item => item.rawEvidenceIds.some(id => answer.rawIds.includes(id))).map(item => item.id);
      return ids.length ? [{ platform: answer.platform, ids }] : [];
    });
    const platforms = [...new Set(present.map(answer => answer.platform))];
    if (platforms.length < 2) continue;
    questions.push({ key: group.key, question: group.question, platforms });
    for (const id of new Set(present.flatMap(answer => answer.ids))) passageKeys.set(id, [...passageKeys.get(id) ?? [], group.key]);
  }
  return { passageKeys, questions };
}

interface PlanPage { title: string; question: string; sectionIds: string[]; subtopics?: Array<{ title: string; question: string; sectionIds: string[] }> }
type PlanNote = { id: string; rawEvidenceIds: string[]; platform?: string };

/** Notes that carry part of a group's question or answers, keyed by platform. */
function groupNotes(group: SameQuestionGroup, notes: PlanNote[]) {
  const raw = new Set(group.answers.flatMap(answer => answer.rawIds));
  return notes.filter(note => note.rawEvidenceIds.some(id => raw.has(id)));
}

/** Directory planning groups notes by topic, so answers to one question can land
 * in different chapters and never meet in one writing request. Move every note of
 * a same-question group into the chapter and subtopic already holding most of it.
 * Only placement changes: no note is dropped, rewritten or duplicated, and notes
 * the scope review left out of the plan stay out. */
export function colocateSameQuestions<Page extends PlanPage>(pages: Page[], notes: PlanNote[], groups: SameQuestionGroup[]): { pages: Page[]; moved: number } {
  const next = pages.map(page => ({ ...page, sectionIds: [...page.sectionIds], ...(page.subtopics ? { subtopics: page.subtopics.map(topic => ({ ...topic, sectionIds: [...topic.sectionIds] })) } : {}) }));
  const pinned = new Map<string, string>();
  let moved = 0;
  for (const group of groups) {
    const members = groupNotes(group, notes).filter(note => next.some(page => page.sectionIds.includes(note.id)));
    if (new Set(members.map(note => note.platform)).size < 2) continue;
    const pageOf = (id: string) => next.findIndex(page => page.sectionIds.includes(id));
    const topicOf = (page: PlanPage, id: string) => page.subtopics?.findIndex(topic => topic.sectionIds.includes(id)) ?? -1;
    const count = (values: number[]) => values.reduce((map, value) => map.set(value, (map.get(value) ?? 0) + 1), new Map<number, number>());
    // Prefer the chapter holding most of the group; on a tie, keep the earlier chapter.
    const pageCounts = count(members.map(note => pageOf(note.id)));
    const target = [...pageCounts].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
    const page = next[target];
    const topicCounts = count(members.flatMap(note => pageOf(note.id) === target ? [topicOf(page, note.id)] : []).filter(index => index >= 0));
    let topic = [...topicCounts].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] ?? (page.subtopics?.length ? 0 : undefined);
    const key = `${target}:${topic ?? -1}`;
    for (const note of members) {
      const from = pageOf(note.id);
      if (from === target && (topic === undefined || topicOf(page, note.id) === topic)) continue;
      // A note shared by two groups stays with the first group that placed it.
      if (pinned.has(note.id) && pinned.get(note.id) !== key) continue;
      const source = next[from];
      source.sectionIds = source.sectionIds.filter(id => id !== note.id);
      source.subtopics?.forEach(item => { item.sectionIds = item.sectionIds.filter(id => id !== note.id); });
      page.sectionIds.push(note.id);
      // A single-note chapter has no subtopics yet; more than one note requires them.
      if (topic === undefined) { page.subtopics = [{ title: page.title, question: page.question, sectionIds: page.sectionIds.filter(id => id !== note.id) }]; topic = 0; }
      page.subtopics![topic].sectionIds.push(note.id);
      moved++;
    }
    for (const note of members) pinned.set(note.id, key);
  }
  if (!moved) return { pages, moved };
  return { pages: next.flatMap(page => {
    if (!page.sectionIds.length) return [];
    const subtopics = page.subtopics?.filter(topic => topic.sectionIds.length);
    return [{ ...page, ...(page.subtopics ? { subtopics } : {}) }];
  }) as Page[], moved };
}

/** Partitioning a long chapter by token budget may still split a group across
 * two writing requests. Pull the stray notes into the request holding most of
 * the group whenever that request still fits; otherwise leave the split as is. */
export function keepSameQuestionsTogether<Item extends PlanNote & { wikiOwnerId?: string }>(batches: Item[][], groups: SameQuestionGroup[], fits: (batch: Item[]) => boolean): Item[][] {
  let next = batches.map(batch => [...batch]);
  for (const group of groups) {
    const raw = new Set(group.answers.flatMap(answer => answer.rawIds));
    const member = (item: Item) => item.rawEvidenceIds.some(id => raw.has(id));
    const holding = next.flatMap((batch, index) => batch.some(member) ? [index] : []);
    if (holding.length < 2) continue;
    const owner = next[holding[0]].find(member)?.wikiOwnerId;
    if (holding.some(index => next[index].filter(member).some(item => item.wikiOwnerId !== owner))) continue;
    const target = [...holding].sort((a, b) => next[b].filter(member).length - next[a].filter(member).length || a - b)[0];
    const strays = holding.filter(index => index !== target).flatMap(index => next[index].filter(member));
    const candidate = [...next[target], ...strays];
    if (!fits(candidate)) continue;
    next = next.map((batch, index) => index === target ? candidate : batch.filter(item => !strays.includes(item))).filter(batch => batch.length);
  }
  return next;
}

export const CROSS_AI_READING = " CROSS-AI SOURCES: each passage has platform, the AI service where that conversation happened. In notes, attribute assistant proposals to their platform (for example \"Claude suggested ...\"). An answer from one AI never confirms, adopts or replaces another AI's answer; only the user's own message records a choice.";

export const CROSS_AI_WRITING = "\nCROSS-AI SOURCES: passages carry platform, the AI service of that conversation. Attribute AI suggestions to their platform in prose when it matters for the reader. An answer from one AI never confirms, adopts or replaces another AI's answer; only an explicit user message records a choice, and cross-conversation order stays unknown unless dates support it. Passages sharing a sameQuestion key answer the same user question on different AIs (listed in data.crossAIQuestions): write that question once as a comparison - the shared conclusion, each AI's distinct suggestion, condition or warning, and the user's evidenced choice, or say that no choice is recorded. Never repeat the same explanation once per AI, and cite each AI's own passages for its claims.";
