import type { FocusEvidence, FocusSection, FocusSession } from "../shared/focus-session";
import { aboutNameKey, statesCore, statementsConflict, wikiBlockedUnitIds, wikiResearchSelection, type WikiDraftChapter, type WikiKnowledgeLedger, type WikiKnowledgeUnit, type WikiUnitStatus } from "../shared/wiki-knowledge";
import { wikiDocumentBlocks } from "../shared/wiki-document-blocks";
import { wikiExampleDisplayKey, wikiExampleKey, wikiExampleStage, wikiExampleStanding } from "../shared/wiki-example-identity";
import { wikiOverviewSignature } from "../shared/wiki-overview";
import { isRequiredWikiSourceBlock, sourceBlockSupportsRows, wikiSourceBlockCaption, wikiSourceBlockMarkdown, wikiSourceExampleScope, wikiSourceTableRole } from "../shared/wiki-source-code";
import type { resolveWikiReading } from "./wiki-knowledge-reading";
import { wikiUnitChapterHomes } from "../shared/wiki-chapter-links";
import { wikiSourceBackedStageOrder } from "./wiki-unit-fidelity";
import { currentWikiEvidence, wikiEvidenceKey } from "../shared/wiki-evidence-link";
import { wikiIsDocumentReviewTable } from "../shared/wiki-editorial-cleanup";
import { wikiSourceLabel } from "../shared/source-quote-text";
import { wikiTableCells, wikiTableKey } from "../shared/wiki-table-source";

export function recordedWikiOrderUnits(reading:Pick<ReturnType<typeof resolveWikiReading>,"organization"|"units"|"statuses">) {
  const homes=wikiUnitChapterHomes(reading.organization);
  return reading.units.flatMap(unit=>{
    const chapterId=homes.get(unit.id),status=reading.statuses.get(unit.id);
    return chapterId&&status&&status!=="history"&&!unit.about&&!unit.evidence.pasted&&wikiSourceBackedStageOrder(unit)
      ?[{chapterId,unit,confirmed:status==="confirmed"}]:[];
  });
}

export function projectRecordedWikiOrders(session:FocusSession, reading:ReturnType<typeof resolveWikiReading>, selected:readonly string[]) {
  const chapters=new Set(session.sections.filter(section=>selected.includes(section.id)
    &&!section.origin&&!section.userEdited).map(section=>section.id));
  const excluded=new Set([...session.wikiScopeReview?.ignoredKeys??[],...session.wikiScopeReview?.excludeKeys??[]]);
  const ignored=session.wikiScopeReview?.materials.filter(item=>(item.keys??[item.key]).every(key=>excluded.has(key)))??[];
  const refs=new Map(currentWikiEvidence(session).map(ref=>[wikiEvidenceKey(ref),ref]));
  const savedRefs=new Set(session.evidence.map(wikiEvidenceKey));
  const orders=new Map<string,Array<{unit:WikiKnowledgeUnit;evidence:FocusEvidence;confirmed:boolean}>>();
  for(const {chapterId,unit,confirmed} of recordedWikiOrderUnits(reading)){
    if(!chapters.has(chapterId))continue;
    const {conversationId,messageId,quote,evidenceId}=unit.evidence;
    if(!session.sourceConversationIds.includes(conversationId)||ignored.some(item=>item.evidenceIds.includes(evidenceId)
      || item.quote.trim().length>=12&&quote.includes(item.quote.trim()))
      ||session.scope?.kind==="goal"&&!session.scope.blocks?.some(block=>block.conversationId===conversationId&&block.messageIds.includes(messageId)))continue;
    const versions=session.sourceSignatures?.[conversationId];
    if(versions&&!versions[messageId])continue;
    const role=session.sourceRoles?.[conversationId]?.[messageId];
    if(role&&role!==unit.evidence.role)continue;
    const key=wikiEvidenceKey({conversationId,messageId,excerpt:quote});
    const original=refs.get(key);
    if(!original&&savedRefs.has(key))continue;
    const evidence=original??{id:`wiki-source-order:${unit.id}`,conversationId,messageId,excerpt:quote,title:reading.ledger.sources?.[conversationId]?.title??"",
      sourceVersionId:session.sourceVersionIds?.[conversationId],sourceSignature:versions?.[messageId]};
    orders.set(chapterId,[...orders.get(chapterId)??[],{unit,evidence,confirmed}]);
  }
  return orders;
}

interface Home { chapterId: string; subtopic: string }
interface SourceCandidate { unit: WikiKnowledgeUnit; status: WikiUnitStatus; homes: Home[] }
interface RequiredBlock { markdown: string; stage: string; standing: string; candidates: SourceCandidate[]; optional: boolean }
interface SourceBlockScope { stage: string; standing: string }
export interface WikiSourceBlockBinding extends SourceBlockScope { unit: WikiKnowledgeUnit; markdown: string; evidence: FocusEvidence }
export const SOURCE_BLOCK_PROBLEM = /required source block is missing/u;

/** Planned, in-scope originals are checked independently of what the writer cited. */
export function planRequiredWikiSourceBlocks(ledger: WikiKnowledgeLedger, units: WikiKnowledgeUnit[], statuses: ReadonlyMap<string, WikiUnitStatus>, includeComparisons = false): RequiredBlock[] {
  const organization = ledger.organization;
  if (!organization || ledger.documentType === "learning") return [];
  const research = wikiResearchSelection(ledger, units), blocked = wikiBlockedUnitIds(ledger);
  const excluded = new Set([...Object.entries(ledger.scopeAnswers ?? {}).filter(([, value]) => value === "exclude").map(([name]) => name), ...(ledger.explicitProjectExclusions ?? []).map(aboutNameKey)]);
  const homes = new Map<string, Home[]>();
  const members = new Map(organization.subjects.map(subject => [subject.id, subject.unitIds]));
  for (const chapter of organization.chapters) for (const topic of chapter.subtopics) for (const subjectId of topic.subjectIds) for (const id of members.get(subjectId) ?? []) {
    const list = homes.get(id) ?? [];
    if (!list.some(home => home.chapterId === chapter.id && home.subtopic === topic.title)) list.push({ chapterId: chapter.id, subtopic: topic.title });
    homes.set(id, list);
  }
  const requirements = new Map<string, RequiredBlock>();
  for (const unit of units) {
    const code = unit.evidence.code, locations = homes.get(unit.id), status = statuses.get(unit.id);
    if (!code || code.language === "table" && wikiIsDocumentReviewTable(code.text) || !locations?.length || !status || status === "history" || unit.adoption.status === "rejected" || blocked.has(unit.id)
      || ledger.decisions?.[unit.id]?.verdict === "rejected" || unit.about && excluded.has(aboutNameKey(unit.about.name))) continue;
    const role = wikiSourceTableRole(code), comparison = (research || includeComparisons) && role === "comparison";
    const optional = comparison && !research;
    if (!comparison && !isRequiredWikiSourceBlock(unit)) continue;
    if (ledger.writingMode === "concise" && !comparison && status !== "confirmed" && (unit.kind !== "constraint" || status !== "stated")) continue;
    const scope = wikiSourceExampleScope(unit, status), { standing } = scope, stage = comparison ? "" : scope.stage;
    const original = wikiSourceBlockMarkdown(code);
    const markdown = comparison && excluded.size ? original.split("\n").filter((line, index) => index < 2
      || !excluded.has(aboutNameKey(wikiSourceLabel(wikiTableCells(line)[0] ?? "")))).join("\n") : original;
    if (comparison && markdown.split("\n").length < 3) continue;
    const identity = comparison ? JSON.stringify(["comparison", markdown]) : wikiExampleDisplayKey(code, stage, standing);
    const prior = requirements.get(identity);
    const candidate = { unit, status, homes: locations };
    if (!prior) requirements.set(identity, { markdown, stage, standing, candidates: [candidate], optional });
    else if (status === "confirmed" && prior.candidates[0].status !== "confirmed"
      || comparison && unit.evidence.role === "assistant" && prior.candidates[0].unit.evidence.pasted) {
      prior.candidates.unshift(candidate);
      prior.standing = standing;
    }
    else prior.candidates.push(candidate);
  }
  return [...requirements.values()];
}

type CoverageChapter = Pick<WikiDraftChapter, "id" | "body" | "paragraphs">;
const key = (text: string) => text.normalize("NFKC").replace(/[\s*_`]/gu, "").toLowerCase();
const depth = (heading: string) => heading.match(/^#+/u)?.[0].length ?? (/\n=+$/u.test(heading) ? 1 : 2);
const sourceCaption = /讨论中的原文|(?:Table|Code) from the discussion/iu;
const comparisonDisclaimer = /^(?:(?:以上|上述)?(?:数据|信息)(?:均)?(?:为|来自)讨论中(?:引用的)?外部信息[，,]\s*(?:未经|未)独立核验[。.]?|(?:the |these )?(?:figures|data) (?:are |were )?(?:cited in|from) the discussion[,.]\s*(?:and )?(?:were |are )?not independently verified\.?)[ \t]*$/iu;
const disclaimerKey = (text: string) => key(text.replace(/^(?:以上|上述)/u, ""));
const codeKey=(markdown:string)=>{
 const match=/^(`{3,}|~{3,})([^\n]*)\n([\s\S]*?)\n\1\s*$/u.exec(markdown.trim());
 return match?wikiExampleKey({language:match[2],text:match[3]}):undefined;
};
const isOriginal = (block: ReturnType<typeof wikiDocumentBlocks>[number], markdown: string) =>
  (block.kind === "code" || block.kind === "table") && (block.text.trimEnd() === markdown.trimEnd()||block.kind==="code"&&codeKey(markdown)!==undefined&&codeKey(block.text)===codeKey(markdown));

export function findWikiSourceBlock(blocks: ReturnType<typeof wikiDocumentBlocks>, markdown: string, { stage, standing }: SourceBlockScope, requireScope = false) {
  const originals = blocks.filter(block => isOriginal(block, markdown));
  if (!requireScope && originals.length <= 1) return originals[0];
  return originals.find(block => {
    const index = blocks.indexOf(block), caption = blocks[index - 1]?.text ?? "";
    const heading = blocks.slice(0, index).reverse().find(item => item.kind === "heading")?.text ?? "";
    return wikiExampleStage(caption, heading) === stage && wikiExampleStanding(caption) === standing;
  });
}

function isPartialOriginal(text: string, code: NonNullable<WikiKnowledgeUnit["evidence"]["code"]>) {
  if (!sourceCaption.test(text.split("\n")[0])) return false;
  const block = wikiDocumentBlocks(text).find(block => block.kind === "code" || block.kind === "table");
  if (!block) return false;
  if (block.kind === "table") return sourceBlockSupportsRows(block.text, code);
  const lines = block.text.split("\n").slice(1, -1).map(line => line.trim()).filter(Boolean);
  const original = code.text.split("\n").map(line => line.trim());
  return lines.length > 0 && lines.every(line => original.includes(line));
}

const comparisonRows = (markdown: string) => markdown.split("\n").slice(2).map(row => {
  const [label, ...cells] = wikiTableCells(row);
  return [aboutNameKey(wikiSourceLabel(label ?? "")), cells.map(wikiSourceLabel)] as const;
});
const numbers = (text: string): string[] => text.normalize("NFKC").match(/\d+(?:\.\d+)?/gu) ?? [];
const rowContent = (text: string) => text.normalize("NFKC").replace(/[\s\p{P}]/gu, "").toLocaleLowerCase();

/** A table-backed unit counts when its own row is present in the retained original. */
export function wikiComparisonRowPresent(unit: WikiKnowledgeUnit, markdown: string): boolean {
  if (!unit.about) return false;
  const name = aboutNameKey(unit.about.name);
  return markdown.split("\n").slice(2).some(row => aboutNameKey(wikiSourceLabel(wikiTableCells(row)[0] ?? "")) === name
    && unit.evidence.quote.includes(row.trim()));
}

/** Bind an existing complete original or recover it in its uniquely planned
 * subsection. Keep partial replacements tied to the same source unit. */
export function reconcileRequiredWikiSourceBlocks<T extends CoverageChapter>(chapters: T[], requirements: RequiredBlock[], zh: boolean, canUse: (unit: WikiKnowledgeUnit, chapter: T) => boolean = () => true, include: (chapterId: string) => boolean = () => true, units: readonly WikiKnowledgeUnit[] = []) {
  const documents = new Map(chapters.map(chapter => [chapter.id, chapter]));
  const bindings = new Map<string, Array<Omit<WikiSourceBlockBinding, "evidence">>>(), issues = new Map<string, string[]>();
  let restored = 0, comparisonsDeduplicated = 0;
  const originalTables = new Set(requirements.map(requirement => requirement.markdown.trim()));
  const unitsById = new Map(units.map(unit => [unit.id, unit]));
  const formatCounts = new Map<string, number>();
  for (const requirement of requirements) {
    const format = codeKey(requirement.markdown) ?? requirement.markdown;
    formatCounts.set(format, (formatCounts.get(format) ?? 0) + 1);
  }
  for (const { markdown, stage, standing, candidates, optional } of requirements) {
    const sharedPayload = (formatCounts.get(codeKey(markdown) ?? markdown) ?? 0) > 1;
    const planned = candidates.find(candidate => candidate.homes.some(home => include(home.chapterId)));
    if (!planned) continue;
    const homes = planned.homes.filter(home => include(home.chapterId));
    let existing: { candidate: SourceCandidate; home: Home; markdown:string } | undefined;
    for (const candidate of candidates) {
      for (const chapter of documents.values()) {
        if (!include(chapter.id)) continue;
        const blocks = wikiDocumentBlocks(chapter.body);
        const displayed = findWikiSourceBlock(blocks, markdown, { stage, standing }, sharedPayload);
        const paragraph = displayed && chapter.paragraphs.find(item => item.unitIds.includes(candidate.unit.id) && item.text.trimEnd().endsWith(displayed.text));
        const home = paragraph ? { chapterId: chapter.id, subtopic: paragraph.subtopic } : candidate.homes.find(home => home.chapterId === chapter.id);
        if (home && displayed && canUse(candidate.unit, chapter)) {
          existing = { candidate, home,markdown:displayed.text };
          break;
        }
      }
      if (existing) break;
    }
    const { unit, status } = existing?.candidate ?? planned;
    const comparison = wikiSourceTableRole(unit.evidence.code!) === "comparison";
    const tableChapter = existing?.home.chapterId ?? homes[0]?.chapterId;
    const comparisonHomes = comparison ? candidates.flatMap(candidate => candidate.homes)
      .filter(home => home.chapterId === tableChapter) : [];
    const sharedComparison = new Set(comparisonHomes.map(home => key(home.subtopic))).size > 1
      && candidates.some(candidate => candidate.unit.about?.role === "competitor");
    const comparisonHome = sharedComparison && tableChapter
      ? { chapterId: tableChapter, subtopic: zh ? "主要竞品" : "Competitor comparison" }
      : comparisonHomes.find(home => /竞品|对照|\b(?:competitors?|comparison)\b/iu.test(home.subtopic));
    const home = comparisonHome ?? existing?.home ?? (planned.homes.length === 1 ? homes[0] : homes.find(home => documents.get(home.chapterId)?.body.trim()));
    const chapter = home && documents.get(home.chapterId);
    if (!home || !chapter || !canUse(unit, chapter) || !chapter.body.trim() && wikiSourceTableRole(unit.evidence.code!) !== "comparison") {
      if (optional) continue;
      const chapterId = homes[0].chapterId;
      issues.set(chapterId, [...issues.get(chapterId) ?? [], `"${unit.subject}" required source block is missing`]);
      continue;
    }

    const code = unit.evidence.code!;
    const blockStatus = status === "confirmed" && !unit.statement.includes(code.text.trim()) ? undefined : status;
    const original = `*${wikiSourceBlockCaption(code, unit.evidence.role, zh, blockStatus)}${stage ? ` · ${stage}` : ""}*\n\n${markdown}`;
    let body = chapter.body, paragraphs = chapter.paragraphs;
    const removedSubtopics = new Set<string>();
    if (comparison) {
      if (comparisonHome && existing) {
        const blocks = wikiDocumentBlocks(body);
        const index = blocks.findIndex(block => isOriginal(block, markdown));
        const heading = blocks.slice(0, index).reverse().find(block => block.kind === "heading");
        if (index >= 0 && heading && key(heading.text.replace(/^#+\s+/u, "")) !== key(comparisonHome.subtopic)) {
          const block = blocks[index], caption = blocks[index - 1];
          const start = caption?.kind === "paragraph" && sourceCaption.test(caption.text) ? caption.start : block.start;
          body = (body.slice(0, start) + body.slice(block.end)).replace(/\n{3,}/gu, "\n\n").trim();
          paragraphs = paragraphs.filter(paragraph => !paragraph.text.trimEnd().endsWith(block.text));
          removedSubtopics.add(key(heading.text.replace(/^#+\s+/u, "")));
          existing = undefined;
        }
      }
      const rows = new Map(comparisonRows(markdown));
      const sameEntity = (source: WikiKnowledgeUnit) => Boolean(source.about && source.about.role === unit.about?.role && rows.has(aboutNameKey(source.about.name)));
      const related = new Set(candidates.map(candidate => candidate.unit.id));
      const backed = (id: string) => {
        const source = unitsById.get(id);
        return related.has(id) || Boolean(source && canUse(source, chapter)
          && (source.evidence.code?.text === code.text || sameEntity(source)));
      };
      const tables = wikiDocumentBlocks(body).filter(block => block.kind === "table");
      const duplicates = new Map(paragraphs.flatMap(paragraph => {
        if (!paragraph.text.startsWith("|") || !paragraph.unitIds.length || !paragraph.unitIds.every(backed)) return [];
        const table = wikiDocumentBlocks(paragraph.text)[0];
        if (table?.kind !== "table" || originalTables.has(table.text)) return [];
        const rowOwners = new Set(paragraph.unitIds.flatMap(id => {
          const source = unitsById.get(id) ?? candidates.find(candidate => candidate.unit.id === id)?.unit;
          return source?.about && (sameEntity(source) || wikiComparisonRowPresent(source, markdown)) ? [aboutNameKey(source.about.name)] : [];
        }));
        const tableKey = wikiTableKey(table.text);
        const matches = tables.filter(table => tableKey === wikiTableKey(table.text)
          && !originalTables.has(table.text.trim()));
        if (matches.length !== 1) return [];
        const entries = comparisonRows(matches[0].text);
        if (!entries.length || !entries.every(([name, cells]) => {
          const original = rows.get(name)?.join(" ");
          if (!rowOwners.has(name) || !original) return false;
          const originalKey = rowContent(original), figures = numbers(original);
          return cells.every(cell => {
            const key = rowContent(cell);
            return !key || numbers(cell).every(value => figures.includes(value)) &&
              (originalKey.includes(key) || statesCore(cell, original) && !statementsConflict(cell, original));
          });
        })) return [];
        const remaining = paragraph.text.slice(table.end).trim();
        const companion = comparisonDisclaimer.test(remaining) ? remaining : undefined;
        return [[paragraph, { duplicate: matches[0].text, remaining: companion ? "" : remaining, companion }] as const];
      }));
      for (const { duplicate, companion } of duplicates.values()) {
        const blocks = wikiDocumentBlocks(body);
        const index = blocks.findIndex(block => block.kind === "table" && block.text === duplicate);
        if (index < 0) continue;
        const next = blocks[index + 1];
        const end = companion && next?.kind === "paragraph" && comparisonDisclaimer.test(next.text)
          && disclaimerKey(next.text) === disclaimerKey(companion) ? next.end : blocks[index].end;
        body = [body.slice(0, blocks[index].start).trimEnd(), body.slice(end).trimStart()].filter(Boolean).join("\n\n");
      }
      if (duplicates.size) {
        comparisonsDeduplicated += duplicates.size;
        paragraphs = paragraphs.flatMap(paragraph => {
          const update = duplicates.get(paragraph);
          if (!update) return [paragraph];
          if (!update.remaining) { removedSubtopics.add(key(paragraph.subtopic)); return []; }
          const claims = paragraph.claims?.filter(claim => update.remaining.includes(claim.text));
          return [{ ...paragraph, text: update.remaining, claims, unitIds: [...new Set(claims?.flatMap(claim => claim.unitIds))] }];
        });
      }
    }
    if (!existing) {
      const blocks = wikiDocumentBlocks(body);
      const partial = paragraphs.find(paragraph => paragraph.subtopic === home.subtopic && paragraph.unitIds.length === 1 && paragraph.unitIds[0] === unit.id
        && isPartialOriginal(paragraph.text, code) && body.includes(paragraph.text));
      if (partial) {
        body = body.replace(partial.text, () => original);
        paragraphs = paragraphs.filter(paragraph => paragraph !== partial);
      } else {
        const at = blocks.findIndex(block => block.kind === "heading" && key(block.text.replace(/^#+\s+/u, "")) === key(home.subtopic));
        const next = at < 0 ? (comparisonHome ? blocks.find(block => block.kind === "heading") : undefined)
          : blocks.slice(at + 1).find(block => block.kind === "heading" && depth(block.text) <= depth(blocks[at].text));
        const end = next?.start ?? body.length;
        const heading = at < 0 ? `### ${home.subtopic}\n\n` : "";
        body = `${body.slice(0, end).trimEnd()}\n\n${heading}${original}${next ? `\n\n${body.slice(end)}` : ""}`.trim();
      }
      restored++;
    }
    const displayed=existing?.markdown??markdown;
    if (comparison && body.includes(displayed)) {
      const blocks = wikiDocumentBlocks(body);
      const index = blocks.findIndex(block => isOriginal(block, displayed));
      const caption = blocks[index - 1], before = blocks[sourceCaption.test(caption?.text ?? "") ? index - 2 : index - 1];
      const note = before?.kind === "paragraph" && comparisonDisclaimer.test(before.text) && paragraphs.find(paragraph =>
        !paragraph.unitIds.length && !paragraph.claims?.length && disclaimerKey(paragraph.text.trim()) === disclaimerKey(before.text));
      if (index >= 0 && note) {
        const end = blocks[index].end;
        body = `${body.slice(0, before.start)}${body.slice(before.end, end).trimStart()}\n\n${before.text}${body.slice(end)}`;
        if (note.subtopic !== home.subtopic) paragraphs = paragraphs.map(paragraph => paragraph === note ? { ...note, subtopic: home.subtopic } : paragraph);
      }
    }
    if (!paragraphs.some(paragraph => paragraph.unitIds.includes(unit.id) && paragraph.text.trimEnd().endsWith(displayed) && body.includes(paragraph.text))) {
      paragraphs = [...paragraphs, { subtopic: home.subtopic, text: existing ? displayed : original, unitIds: [unit.id], claims: [] }];
    }
    if (removedSubtopics.size) {
      const blocks = wikiDocumentBlocks(body);
      for (let index = blocks.length - 1; index >= 0; index--) {
        const block = blocks[index], next = blocks[index + 1];
        if (block.kind !== "heading" || !removedSubtopics.has(key(block.text.replace(/^#+\s+/u, "")))
          || next && (next.kind !== "heading" || depth(next.text) > depth(block.text))) continue;
        body = [body.slice(0, block.start).trimEnd(), body.slice(block.end).trimStart()].filter(Boolean).join("\n\n");
      }
    }
    if (body !== chapter.body || paragraphs !== chapter.paragraphs) documents.set(chapter.id, { ...chapter, body, paragraphs });
    const owners=candidates.filter(candidate=>canUse(candidate.unit,chapter)).map(candidate=>({unit:candidate.unit,markdown:displayed,stage,standing}));
    bindings.set(chapter.id, [...bindings.get(chapter.id) ?? [], ...owners]);
  }
  return { chapters: [...documents.values()], bindings, issues, restored, comparisonsDeduplicated };
}

/** Re-export an older saved draft from its own source snapshot, without asking
 * the model or editing saved prose. Source changes and user edits are respected. */
export function projectRequiredWikiSourceBlocks(session: FocusSession, chapterIds: string[], zh: boolean, resolved: ReturnType<typeof resolveWikiReading> | undefined, includeComparisons = false) {
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
  const requirements = planRequiredWikiSourceBlocks(resolved.ledger, resolved.units.filter(inScope), resolved.statuses, includeComparisons);
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
    }, id => selected.has(id) && !byId.get(id)?.userEdited && !byId.get(id)?.origin, resolved.units.filter(inScope));
  const evidence = new Map(session.evidence.map(ref => [ref.id, ref]));
  for (const chapter of projection.chapters) {
    const original = byId.get(chapter.id)!;
    const bound = (projection.bindings.get(chapter.id) ?? []).flatMap(binding => {
      const ref = refs.get(binding.unit.id);
      return ref ? [{ ...binding, evidence: ref }] : [];
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
