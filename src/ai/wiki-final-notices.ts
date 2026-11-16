import { wikiDocumentBlocks } from "../shared/wiki-document-blocks";
import { conditionKept, groupMemberConditions, keepsDetail, type WikiDraftChapter, type WikiExplanationGroup, type WikiKnowledgeUnit } from "../shared/wiki-knowledge";

const key = (text: string) => text.normalize("NFKC").replace(/\*\*|__|〔[^〕\n]+〕|\[S-\d+-[a-z0-9]+\]/gu, "").replace(/\s+/gu, "");
const GROUP_CONDITION = /^"([\s\S]+?)…" drops the condition "(.+)" of k\d+/u;
const DETAILS = /^"([\s\S]+?)…" drops the exact details (.+)$/u;

/** Resolve old notices against final prose only when a unique complete
 * requirement is recoverable from its cited source. Uncertain notices stay. */
export function resolvedWikiFinalNotices(chapter: WikiDraftChapter, units: ReadonlyMap<string, WikiKnowledgeUnit>, groups: readonly WikiExplanationGroup[], body = chapter.body) {
  const resolved = new Set<string>();
  const candidates = chapter.problems.filter(problem => GROUP_CONDITION.test(problem) || DETAILS.test(problem));
  if (!candidates.length) return resolved;
  const prose = wikiDocumentBlocks(body).filter(block => block.kind === "paragraph" || block.kind === "list" || block.kind === "table")
    .map(block => ({ text: block.text, key: key(block.text) }));
  const memberConditions = new Map<string, string[]>();
  for (const group of groups) for (const member of group.members) {
    const unit = units.get(member.unitId);
    if (unit) memberConditions.set(unit.id, [...memberConditions.get(unit.id) ?? [], ...groupMemberConditions(member, unit)]);
  }
  for (const problem of candidates) {
    const condition = problem.match(GROUP_CONDITION), details = problem.match(DETAILS);
    const head = key((condition ?? details)![1]);
    const paragraphs = chapter.paragraphs.filter(paragraph => key(paragraph.text).startsWith(head));
    if (paragraphs.length !== 1) continue;
    const ids = new Set(paragraphs[0].unitIds);
    const cited = [...ids].flatMap(id => units.get(id) ?? []);
    if (!cited.length) continue;
    // Each passage of the final chapter must keep its own source binding.
    const own = chapter.paragraphs.filter(paragraph => paragraph.unitIds.some(id => ids.has(id)));
    const shown = own.flatMap(paragraph => {
      const claims = (paragraph.claims ?? []).filter(claim => claim.unitIds.some(id => ids.has(id)));
      const values = [paragraph.text, ...claims.map(claim => claim.text)].map(key).filter(Boolean);
      return prose.filter(block => values.some(value => block.key.includes(value))).map(block => block.text);
    }).join("\n");
    if (!shown) continue;
    if (condition) {
      const prefix = condition[2];
      const matching = new Set(cited.flatMap(unit => [unit.statement, ...memberConditions.get(unit.id) ?? []])
        .filter(value => value.startsWith(prefix)));
      if (matching.size !== 1) continue;
      const [complete] = matching;
      if (conditionKept(complete, shown)) resolved.add(problem);
    } else if (details) {
      const required = details[2].split(/,\s*/u);
      // A diagnostic can cut an identifier. Accept only a full detail that its
      // own source actually gives, never a prefix found elsewhere.
      if (required.every(detail => cited.some(unit => [unit.statement, ...unit.details].some(value => value.includes(detail)))
        && keepsDetail(shown, detail))) resolved.add(problem);
    }
  }
  return resolved;
}
