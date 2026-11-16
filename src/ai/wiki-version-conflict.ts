import { statementsConflict, type WikiKnowledgeUnit, type WikiUnitRelation } from "../shared/wiki-knowledge";
import { knowledgeOwner, knowledgeScopesAgree, knowledgeStage, knowledgeTerms } from "../shared/knowledge-subject";

const REPLACES = /取代|替代|代替|已被.+废弃|(?:现|现在|现已|改|后续|后来|随后)(?:简化|改写|调整|切换|改|换|转)(?:成|为)|\b(?:replaced?|superseded?|supplanted?|switched to|now simplified to)\b/iu;
const CONTINUES = /继续保留|仍(?:然)?保留|沿用|保留.{0,36}(?:再|并|同时|另外|但)?(?:增加|新增)|\b(?:still|continue to) (?:keep|use|retain)\b/iu;
export const assertsWikiReplacement = (text: string) => REPLACES.test(text);

/** A paraphrase can claim replacement only if its own sources or a resolved
 * relation state that change, and both related points occur in the claim. */
export function wikiReplacementSupported(text: string, cited: WikiKnowledgeUnit[], relations: readonly WikiUnitRelation[]) {
  if (!assertsWikiReplacement(text)) return true;
  const terms = knowledgeTerms(text);
  const mentions = (value: string) => {
    const own = knowledgeTerms(value);
    const shared = [...own].filter(term => terms.has(term)).length;
    return shared >= Math.min(3, own.size) && own.size > 0 && shared / own.size >= .5;
  };
  if (cited.some(unit => [unit.statement, unit.evidence.quote].some(source => source.split(/[。！？\n]|\.(?=\s)/u)
    .some(value => assertsWikiReplacement(value) && !CONTINUES.test(value) && mentions(value))))) return true;
  const byId = new Map(cited.map(unit => [unit.id, unit]));
  return relations.some(relation => {
    if (relation.kind !== "replaces" || relation.status !== "resolved") return false;
    const before = byId.get(relation.older), after = byId.get(relation.newer);
    return before && after && mentions(before.statement) && mentions(after.statement)
      && (Boolean(relation.evidence) || exclusiveWikiVersions(before, after));
  });
}

export function wikiExplicitContinuation(older: WikiKnowledgeUnit, newer: WikiKnowledgeUnit) {
  if (!CONTINUES.test(newer.evidence.quote) || assertsWikiReplacement(newer.statement)) return false;
  const earlier = knowledgeTerms(older.statement), later = knowledgeTerms(newer.statement);
  const shared = [...earlier].filter(term => later.has(term)).length;
  return shared >= Math.min(3, earlier.size) && earlier.size > 0 && shared / earlier.size >= .65
    && !statementsConflict(older.statement, newer.statement);
}

/** Opposing storage constraints for credentials. Unstated ownership stays
 * ambiguous: browser or server wording by itself does not identify the owner. */
export function wikiCredentialStorageCheck(units: readonly WikiKnowledgeUnit[]) {
  const credentials = /API\s*Key|密钥|凭据|\bcredentials?\b/iu;
  const server = /仅在服务器端|仅存于服务端|绝不暴露给浏览器|\bserver[- ]side only\b|\bnever (?:expose|send).{0,25}(?:browser|client)\b/iu;
  const browser = /(?:保存在|存储在|存入|持久化到)[^。；;]{0,24}(?:浏览器|sessionStorage|localStorage)|\b(?:stored?|kept|saved)\b[^.;]{0,30}\b(?:browser|sessionStorage|localStorage)\b/iu;
  const prohibition = /禁止|严禁|不得|不(?:应|能|得)?(?:保存|存储|存入|持久化)|\b(?:never|must not|do not|cannot)\b/iu;
  const choices = units.filter(unit => !unit.about && credentials.test(unit.statement));
  const browserOptions = choices.filter(unit => unit.statement.split(/[。；;，,\n]|\.(?=\s|$)/u).some(clause => browser.test(clause) && !prohibition.test(clause)));
  for (const a of choices.filter(unit => server.test(unit.statement))) for (const b of browserOptions) {
    if (a === b) continue;
    const first = knowledgeOwner(a.statement), second = knowledgeOwner(b.statement);
    const firstVersion = knowledgeStage(a.statement), secondVersion = knowledgeStage(b.statement);
    if (first && second && first !== second || firstVersion && secondVersion && firstVersion !== secondVersion) continue;
    return { ambiguousOwner: !first || !second, unitIds: [a.id, b.id] };
  }
}

/** A generated replacement edge is a candidate, not proof of an exclusive choice.
 * Style and journey, or a mock and deferred API integration, can hold together. */
export function exclusiveWikiVersions(older: WikiKnowledgeUnit, newer: WikiKnowledgeUnit): boolean {
  if (older.about?.name !== newer.about?.name) return false;
  if (older.facet && newer.facet && older.facet !== newer.facet) return false;
  if (!knowledgeScopesAgree(older.statement, newer.statement)) return false;
  const first = knowledgeStage(older.statement), second = knowledgeStage(newer.statement);
  const named = (stage: string | undefined) => stage && /^(?:phase|milestone|stage)/u.test(stage);
  if (first && second && first !== second && named(first) && named(second)) return false;
  if (wikiExplicitContinuation(older, newer)) return false;
  const earlier = knowledgeTerms(older.statement), later = knowledgeTerms(newer.statement);
  const same = [...earlier].filter(term => later.has(term)).length;
  const placement = newer.statement.match(/^(.{2,30}?)\s*(?:改放|改存|改用|改由|switches? to)\s*/iu)?.[1];
  const normalized = (text: string) => text.normalize("NFKC").toLowerCase().replace(/\s+/gu, "");
  if (placement && normalized(older.statement).startsWith(normalized(placement))) return true;
  return statementsConflict(older.statement, newer.statement)
    || (same >= Math.min(3, earlier.size) && earlier.size > 0 && same / earlier.size >= .5
      && /改(?:为|成|放)|换(?:成|为)|取代|替代|而非|不再|\b(?:instead|replace[sd]?|rather than|switch(?:ed)? to)\b/iu.test(newer.statement));
}
