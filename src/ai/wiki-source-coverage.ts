import type { FocusEvidence, FocusSection, FocusSession } from "../shared/focus-session";
import type { WikiDraftChapter, WikiKnowledgeLedger, WikiKnowledgeUnit, WikiUnitStatus } from "../shared/wiki-knowledge";
import { wikiDocumentBlocks } from "../shared/wiki-document-blocks";
import { wikiOverviewSignature } from "../shared/wiki-overview";
import { isRequiredWikiSourceBlock, sourceBlockSupportsRows, wikiSourceBlockCaption, wikiSourceBlockMarkdown } from "../shared/wiki-source-code";
import type { resolveWikiReading } from "./wiki-knowledge-reading";

interface Home { chapterId: string; subtopic: string }
interface SourceCandidate { unit: WikiKnowledgeUnit; status: WikiUnitStatus; homes: Home[] }
interface RequiredBlock { markdown: string; candidates: SourceCandidate[] }
export interface WikiSourceBlockBinding { unit: WikiKnowledgeUnit; markdown: string; evidence: FocusEvidence }
export const SOURCE_BLOCK_PROBLEM = /required source block is missing/u;

/** Planned, in-scope originals are checked independently of what the writer cited. */
export function planRequiredWikiSourceBlocks(ledger: WikiKnowledgeLedger, units: WikiKnowledgeUnit[], statuses: ReadonlyMap<string, WikiUnitStatus>): RequiredBlock[] {
  const organization = ledger.organization;
  if (!organization || ledger.documentType === "learning") return [];
  const homes = new Map<string, Home[]>();
  const members = new Map(organization.subjects.map(subject => [subject.id, subject.unitIds]));
  for (const chapter of organization.chapters) for (const topic of chapter.subtopics) for (const subjectId of topic.subjectIds) for (const id of members.get(subjectId) ?? []) {
    const list = homes.get(id) ?? [];
    if (!list.some(home => home.chapterId === chapter.id && home.subtopic === topic.title)) list.push({ chapterId: chapter.id, subtopic: topic.title });
    homes.set(id, list);
  }
  const requirements = new Map<string, RequiredBlock>();
  for (const unit of units) {
    const locations = homes.get(unit.id), status = statuses.get(unit.id);
    if (!locations?.length || !status || status === "history" || unit.adoption.status === "rejected" || !isRequiredWikiSourceBlock(unit)) continue;
    const markdown = wikiSourceBlockMarkdown(unit.evidence.code!), prior = requirements.get(markdown);
    const candidate = { unit, status, homes: locations };
    if (!prior) requirements.set(markdown, { markdown, candidates: [candidate] });
    else if (status === "confirmed" && prior.candidates[0].status !== "confirmed") prior.candidates.unshift(candidate);
    else prior.candidates.push(candidate);
  }
  return [...requirements.values()];
}

type CoverageChapter = Pick<WikiDraftChapter, "id" | "body" | "paragraphs">;
const key = (text: string) => text.normalize("NFKC").replace(/[\s*_`]/gu, "").toLowerCase();
const depth = (heading: string) => heading.match(/^#+/u)?.[0].length ?? (/\n=+$/u.test(heading) ? 1 : 2);
const sourceCaption = /讨论中的原文|(?:Table|Code) from the discussion/iu;
const isOriginal = (block: ReturnType<typeof wikiDocumentBlocks>[number], markdown: string) =>
  (block.kind === "code" || block.kind === "table") && block.text.trimEnd() === markdown.trimEnd();

function isPartialOriginal(text: string, code: NonNullable<WikiKnowledgeUnit["evidence"]["code"]>) {
  if (!sourceCaption.test(text.split("\n")[0])) return false;
  const block = wikiDocumentBlocks(text).find(block => block.kind === "code" || block.kind === "table");
  if (!block) return false;
  if (block.kind === "table") return sourceBlockSupportsRows(block.text, code);
  const lines = block.text.split("\n").slice(1, -1).map(line => line.trim()).filter(Boolean);
  const original = code.text.split("\n").map(line => line.trim());
  return lines.length > 0 && lines.every(line => original.includes(line));
}

/** Bind an existing complete original or recover it in its uniquely planned
 * subsection. Keep partial replacements tied to the same source unit. */
export function reconcileRequiredWikiSourceBlocks<T extends CoverageChapter>(chapters: T[], requirements: RequiredBlock[], zh: boolean, canUse: (unit: WikiKnowledgeUnit, chapter: T) => boolean = () => true, include: (chapterId: string) => boolean = () => true) {
  const documents = new Map(chapters.map(chapter => [chapter.id, chapter]));
  const bindings = new Map<string, Array<{ unit: WikiKnowledgeUnit; markdown: string }>>(), issues = new Map<string, string[]>();
  let restored = 0;
  for (const { markdown, candidates } of requirements) {
    const planned = candidates.find(candidate => candidate.homes.some(home => include(home.chapterId)));
    if (!planned) continue;
    const homes = planned.homes.filter(home => include(home.chapterId));
    let existing: { candidate: SourceCandidate; home: Home } | undefined;
    for (const candidate of candidates) {
      const matches = (paragraph: CoverageChapter["paragraphs"][number]) => paragraph.unitIds.includes(candidate.unit.id) && paragraph.text.trimEnd().endsWith(markdown);
      for (const chapter of documents.values()) {
        if (!include(chapter.id) || !chapter.body.includes(markdown)) continue;
        const paragraph = chapter.paragraphs.find(matches);
        const home = paragraph ? { chapterId: chapter.id, subtopic: paragraph.subtopic } : candidate.homes.find(home => home.chapterId === chapter.id);
        if (home && canUse(candidate.unit, chapter) && wikiDocumentBlocks(chapter.body).some(block => isOriginal(block, markdown))) {
          existing = { candidate, home };
          break;
        }
      }
      if (existing) break;
    }
    const { unit, status } = existing?.candidate ?? planned;
    const home = existing?.home ?? (planned.homes.length === 1 ? homes[0] : undefined);
    const chapter = home && documents.get(home.chapterId);
    if (!home || !chapter?.body.trim() || !canUse(unit, chapter)) {
      const chapterId = homes[0].chapterId;
      issues.set(chapterId, [...issues.get(chapterId) ?? [], `"${unit.subject}" required source block is missing`]);
      continue;
    }

    const code = unit.evidence.code!;
    const blockStatus = status === "confirmed" && !unit.statement.includes(code.text.trim()) ? undefined : status;
    const original = `*${wikiSourceBlockCaption(code, unit.evidence.role, zh, blockStatus)}*\n\n${markdown}`;
    let body = chapter.body, paragraphs = chapter.paragraphs;
    if (!existing) {
      const blocks = wikiDocumentBlocks(body);
      const partial = paragraphs.find(paragraph => paragraph.subtopic === home.subtopic && paragraph.unitIds.length === 1 && paragraph.unitIds[0] === unit.id
        && isPartialOriginal(paragraph.text, code) && body.includes(paragraph.text));
      if (partial) {
        body = body.replace(partial.text, () => original);
        paragraphs = paragraphs.filter(paragraph => paragraph !== partial);
      } else {
        const at = blocks.findIndex(block => block.kind === "heading" && key(block.text.replace(/^#+\s+/u, "")) === key(home.subtopic));
        const next = at < 0 ? undefined : blocks.slice(at + 1).find(block => block.kind === "heading" && depth(block.text) <= depth(blocks[at].text));
        const end = next?.start ?? body.length;
        const heading = at < 0 ? `### ${home.subtopic}\n\n` : "";
        body = `${body.slice(0, end).trimEnd()}\n\n${heading}${original}${next ? `\n\n${body.slice(end)}` : ""}`;
      }
      restored++;
    }
    if (!paragraphs.some(paragraph => paragraph.unitIds.includes(unit.id) && paragraph.text.trimEnd().endsWith(markdown) && body.includes(paragraph.text))) {
      paragraphs = [...paragraphs, { subtopic: home.subtopic, text: existing ? markdown : original, unitIds: [unit.id], claims: [] }];
    }
    if (body !== chapter.body || paragraphs !== chapter.paragraphs) documents.set(chapter.id, { ...chapter, body, paragraphs });
    bindings.set(chapter.id, [...bindings.get(chapter.id) ?? [], { unit, markdown }]);
  }
  return { chapters: [...documents.values()], bindings, issues, restored };
}

/** Re-export an older saved draft from its own source snapshot, without asking
 * the model or editing saved prose. Source changes and user edits are respected. */
export function projectRequiredWikiSourceBlocks(session: FocusSession, chapterIds: string[], zh: boolean, resolved: ReturnType<typeof resolveWikiReading> | undefined) {
  const bindings = new Map<string, WikiSourceBlockBinding[]>(), issues = new Map<string, string[]>();
  if (!resolved?.ledger.draft || !chapterIds.length) return { session, bindings, issues };
  const selected = new Set(chapterIds);
  const byId = new Map(session.sections.map(section => [section.id, section]));
  const drafts = new Map(resolved.ledger.draft.chapters.map(chapter => [chapter.id, chapter]));
  const ignored = new Set([...session.wikiScopeReview?.excludeKeys ?? [], ...session.wikiScopeReview?.ignoredKeys ?? []]);
  const excluded = session.wikiScopeReview?.materials.filter(item => (item.keys ?? [item.key]).every(key => ignored.has(key))) ?? [];
  const ignoredIds = new Set(excluded.flatMap(item => item.evidenceIds));
  const inScope = (unit: WikiKnowledgeUnit) => {
    const { conversationId, messageId, quote, evidenceId } = unit.evidence;
    return session.sourceConversationIds.includes(conversationId) && !ignoredIds.has(evidenceId)
      && !excluded.some(item => item.quote.trim().length >= 12 && quote.includes(item.quote.trim()))
      && (session.scope?.kind !== "goal" || session.scope.blocks?.some(block => block.conversationId === conversationId && block.messageIds.includes(messageId)));
  };
  const requirements = planRequiredWikiSourceBlocks(resolved.ledger, resolved.units.filter(inScope), resolved.statuses);
  const refFor = (unit: WikiKnowledgeUnit): FocusEvidence | undefined => {
    const { conversationId, messageId, quote } = unit.evidence, versions = session.sourceSignatures?.[conversationId];
    if (!quote.trim() || versions && !versions[messageId]) return;
    const same = session.evidence.filter(ref => ref.conversationId === conversationId && ref.messageId === messageId && ref.excerpt.trim() === quote.trim());
    const existing = same.find(ref => !ignoredIds.has(ref.id) && (!ref.sourceSignature || !versions || ref.sourceSignature === versions[messageId]));
    if (existing || same.length) return existing;
    return { id: `wiki-source-block:${unit.id}`, conversationId, messageId, excerpt: quote, title: resolved.ledger.sources?.[conversationId]?.title ?? "",
      sourceVersionId: session.sourceVersionIds?.[conversationId], sourceSignature: versions?.[messageId] };
  };
  const refs = new Map<string, FocusEvidence>();
  const projection = reconcileRequiredWikiSourceBlocks(session.sections.filter(section => selected.has(section.id) && drafts.has(section.id)).map(section => ({ ...section, paragraphs: drafts.get(section.id)!.paragraphs })),
    requirements, zh, (unit, section) => {
      if (section.userEdited || section.origin) return false;
      const ref = refFor(unit);
      if (!ref) return false;
      refs.set(unit.id, ref);
      return true;
    }, id => selected.has(id) && !byId.get(id)?.userEdited && !byId.get(id)?.origin);
  const evidence = new Map(session.evidence.map(ref => [ref.id, ref]));
  for (const chapter of projection.chapters) {
    const original = byId.get(chapter.id)!;
    const bound = (projection.bindings.get(chapter.id) ?? []).flatMap(({ unit, markdown }) => {
      const ref = refs.get(unit.id);
      return ref ? [{ unit, markdown, evidence: ref }] : [];
    });
    if (!bound.length) continue;
    for (const item of bound) evidence.set(item.evidence.id, item.evidence);
    bindings.set(chapter.id, bound);
    const section: FocusSection = { ...original, body: chapter.body, evidenceIds: [...new Set([...original.evidenceIds, ...bound.map(item => item.evidence.id)])] };
    byId.set(chapter.id, section);
  }
  if (!bindings.size) return { session, bindings, issues: projection.issues };
  const projected = { ...session, evidence: [...evidence.values()], sections: [...byId.values()] };
  if (session.wikiOverview?.signature === wikiOverviewSignature(session)) projected.wikiOverview = { ...session.wikiOverview, signature: wikiOverviewSignature(projected) };
  return { session: projected, bindings, issues: projection.issues };
}
