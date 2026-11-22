import { statementsConflict, type WikiKnowledgeUnit, type WikiUnitRelation } from "../shared/wiki-knowledge";
import { knowledgeOwner, knowledgeScopesAgree, knowledgeStage, knowledgeTerms } from "../shared/knowledge-subject";
import { distinctWikiStageScopes, wikiRoadmapScope } from "../shared/wiki-roadmap-scope";

const REPLACES = /取代|替代|代替|(?:已(?:经)?\s*(?:被\s*)?(?:弃用|废弃|停用|淘汰)|不再(?:沿用|采用)旧)|(?:现|现在|现已|改|后续|后来|随后)(?:简化|改写|调整|切换|改|换|转)(?:成|为)|\b(?:replaced|superseded|supplanted|retired|abandoned|switched to|now simplified to)\b/iu;
const CONTINUES = /继续保留|仍(?:然)?保留|沿用|保留.{0,36}(?:再|并|同时|另外|但)?(?:增加|新增)|\b(?:still|continue to) (?:keep|use|retain)\b/iu;
const NON_REPLACEMENT = /(?:无需|并未|没有|从未|并不|不应|不能|不再|避免|排除)(?:直接)?(?:替代|取代|代替)|(?:是否|可能)(?:已经?|被)?(?:替代|取代|代替|弃用|废弃|停用)|\b(?:never|not|whether|may)\s+(?:be\s+|been\s+|it\s+was\s+)?(?:replaced|superseded|supplanted|retired|abandoned)\b/giu;
export const assertsWikiReplacement = (text: string) => REPLACES.test(text.replace(NON_REPLACEMENT, ""));

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
  if (cited.some(unit => unit.evidence.quote.split(/[。！？\n]|\.(?=\s)/u)
    .some(value => assertsWikiReplacement(value) && !CONTINUES.test(value) && mentions(value)))) return true;
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

const CREDENTIAL = /API\s*Key|密钥|凭据|BYOK|\bcredentials?\b/iu;
const STORAGE = /运行(?:时|期)内存|(?:页面|浏览器)?内存|\b(?:runtime |in[- ]?)?memory\b|sessionStorage|localStorage|环境变量|\benvironment variables?\b/iu;
const STORE_DEFAULT = /(?<!非)默认(?!不|禁止|禁用|情况下不)|\bby default\b|\bdefault(?:s? to| storage| is)\b/iu;
const STORED = /存放|存储|保存|保留|持久化|存于|存入|(?:仅|只)存|\b(?:stored?|kept|saved|persisted|defaults? to)\b/iu;
const PROPOSAL = /讨论|建议|提案|拟(?:议|使用)|\b(?:proposal|proposed|suggestion|suggested)\b/iu;
const STORAGE_STANDING = /(?:\b(v\d+(?:\.\d+)*|(?:Phase|Milestone|Stage)\s+[\d.a-z]+)|((?:第[一二三四五六七八九十\d]+|首)(?:版|阶段)))[^。！？：:\n]{0,25}?(?:先只支持|仅支持|只支持|暂只允许|only (?:support|allow|use))\s*[*_`]*\s*(sessionStorage|localStorage|运行时内存|(?:runtime )?memory)/iu;
const store = (text: string) => text.match(STORAGE)?.[0].toLowerCase().replace(/.*内存|.*memory/u, "memory");

export function wikiCredentialStorageOpening(opening: string, detail: string): string {
  // A summary which only lists alternate storage locations loses the opt-in rule.
  // The full rule already appears under the chapter heading.
  if (!/(?:仅当|只有|明确选择|主动勾选|\bonly (?:if|when)\b|\bopt[s -]in\b)[^。！？\n]{0,90}sessionStorage/iu.test(detail)
    || !/(?:默认[^。！？\n]{0,30}内存|\b(?:memory[^.\n]{0,15}by default|default[^.\n]{0,20}memory)\b)/iu.test(detail)) return opening;
  return opening.replace(/([，,])\s*(?:(?:用户的?\s*)?API\s*Key|(?:用户的?)?密钥|credentials?)\s*(?:仅|只)?(?:存于|存储于|保存在|(?:are|is) (?:only )?(?:stored|kept) in)\s*(?:页面)?(?:运行时内存|(?:runtime )?memory)\s*(?:或|or)\s*`?sessionStorage`?(?=[。.!！？])/giu, "");
}

/** The source may give a phase-specific option or an optional store even
 * when its saved paraphrase presents that store as the universal default. */
export function wikiCredentialStorageProse(text: string, units: readonly WikiKnowledgeUnit[], statuses: ReadonlyMap<string, string>, zh: boolean): { text: string; source?: WikiKnowledgeUnit } | undefined {
  const relevant = units.filter(unit => !unit.about && CREDENTIAL.test(`${unit.subject} ${unit.statement} ${unit.evidence.quote.slice(0, 160)}`) && STORAGE.test(unit.statement));
  if (!relevant.length || !STORAGE.test(text) || !STORED.test(text) || /[？?]\s*$/u.test(text)) return;
  const named = CREDENTIAL.test(text);
  if (!named && !relevant.some(unit => unit.statement.includes(text.trim()))) return;
  const defaultStore = store(text);
  const owners = knowledgeOwner(text);
  const linked = relevant.filter(unit => (!owners || !knowledgeOwner(unit.statement) || knowledgeOwner(unit.statement) === owners)
    && (!knowledgeStage(text) || !knowledgeStage(unit.statement) || knowledgeStage(unit.statement) === knowledgeStage(text)));
  if (linked.some(unit => statuses.get(unit.id) === "confirmed" && store(unit.statement) === defaultStore)) return;
  const staged = STORE_DEFAULT.test(text) && linked.flatMap(unit => {
    const status = statuses.get(unit.id);
    const scope = STORAGE_STANDING.exec(unit.evidence.quote);
    return status !== "confirmed" && scope && store(scope[3]) === defaultStore && store(unit.statement) === defaultStore
      && !knowledgeStage(text) && !STORE_DEFAULT.test(unit.evidence.quote) ? [{ scope, unit }] : [];
  });
  if (staged && staged.length === 1) {
    const { scope: [, version, phase, location], unit } = staged[0];
    return { text: zh ? `密钥存储的讨论方案为 ${version ?? phase} 先只支持 \`${location}\`。`
      : `The discussion proposed supporting only \`${location}\` for key storage in ${version ?? phase}.`, source: unit };
  }
  if (!STORE_DEFAULT.test(text) || PROPOSAL.test(text) || !linked.some(unit => STORE_DEFAULT.test(unit.statement) && store(unit.statement) === defaultStore)) return;
  return { text: zh ? `讨论建议：${text}` : `Proposal from the discussion: ${text}` };
}

/** A change needs to answer the same question. A delivery date and inclusion
 * in the shipped product can both be true, as can key ownership and storage. */
export function wikiDifferentDecisionAxis(older: WikiKnowledgeUnit, newer: WikiKnowledgeUnit): boolean {
  const axis = (unit: WikiKnowledgeUnit) => {
    const subject = `${unit.subject} ${unit.facet ?? ""}`, text = `${subject} ${unit.statement}`;
    if (/API\s*Key|密钥|凭据|BYOK|\bcredentials?\b/iu.test(text)) {
      const owner = /归属|提供方|由谁|自带|自备|自填|自己(?:接|提供)|用户提供|\b(?:ownership|bring your own|user.supplied)\b/iu;
      const storage = /存储|存放|保存|保管|持久化|环境变量|内存|sessionStorage|localStorage|\b(?:storage|stored|persistence|environment variables?)\b/iu;
      if (!storage.test(subject) && owner.test(unit.statement) && !storage.test(unit.statement)) return "credential-owner";
      if (!owner.test(subject) && storage.test(unit.statement) && !owner.test(unit.statement)) return "credential-storage";
    }
    const order = /先.{0,35}(?:发布|上线|交付)|发布.{0,25}(?:之后|之前)|\b(?:ship|release)\b.{0,24}\b(?:first|before|after)\b/iu;
    if (/发布顺序|交付顺序|发布时机|\b(?:release sequence|shipping order|release timing)\b/iu.test(subject)
      && order.test(unit.statement)) return "release-order";
    if (/功能(?:范围|边界)|版本(?:范围|边界)|是否开放|\b(?:feature scope|version scope|availability)\b/iu.test(subject)
      && /(?:包含|纳入|支持|开放|提供|不做)|\b(?:include|support|exclude|available)\b/iu.test(unit.statement)
      && !order.test(unit.statement)) return "feature-scope";
  };
  const before = axis(older), after = axis(newer);
  return before === "credential-owner" && after === "credential-storage" || before === "credential-storage" && after === "credential-owner"
    || before === "release-order" && after === "feature-scope" || before === "feature-scope" && after === "release-order";
}

/** A generated replacement edge is a candidate, not proof of an exclusive choice.
 * Style and journey, or a mock and deferred API integration, can hold together. */
export function exclusiveWikiVersions(older: WikiKnowledgeUnit, newer: WikiKnowledgeUnit): boolean {
  if (older.about?.name !== newer.about?.name) return false;
  if (wikiDifferentDecisionAxis(older, newer)) return false;
  if (older.facet && newer.facet && older.facet !== newer.facet) return false;
  if (!knowledgeScopesAgree(older.statement, newer.statement)
    || distinctWikiStageScopes(older.statement, newer.statement)) return false;
  const first = knowledgeStage(older.statement), second = knowledgeStage(newer.statement);
  const named = (stage: string | undefined) => stage && /^(?:phase|milestone|stage)/u.test(stage);
  if (first && second && first !== second && named(first) && named(second)) return false;
  const olderScope = wikiRoadmapScope(older), newerScope = wikiRoadmapScope(newer);
  const differentExclusion = (limit: typeof olderScope, alternative: typeof olderScope) => {
    if (limit.exclusionType !== "phase_only" || alternative.exclusionType === "permanent") return false;
    if (alternative.bucket === "next" || alternative.bucket === "later") return true;
    const key = (label: string) => label.toLowerCase().replace(/\s+/gu, "");
    return Boolean(limit.exclusionLabels?.length && alternative.rawLabels.length
      && !limit.exclusionLabels.some(label => alternative.rawLabels.some(other => key(label) === key(other))));
  };
  if (differentExclusion(olderScope, newerScope) || differentExclusion(newerScope, olderScope)) return false;
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
