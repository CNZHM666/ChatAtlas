import { knowledgeTerms } from "../shared/knowledge-subject";
import { type WikiKnowledgeOrganization, type WikiKnowledgeUnit, type WikiDraftChapter } from "../shared/wiki-knowledge";
import { laterTakenUp } from "./wiki-knowledge-state";

export interface WikiScopeCondition { direction: string; scope: WikiKnowledgeUnit; text?: string }
/** Keep only the source's prohibited objects that actually narrow this direction.
 * Broad refactor instructions must not get pasted wholesale after a buying wish. */
function relevantScope(direction: WikiKnowledgeUnit, scope: WikiKnowledgeUnit): string | undefined {
  const match = scope.statement.match(/(不做|不开发|不包含|不提供|禁止|暂不(?:开发|提供|做)?|暂缓)([^。；;]+)/u);
  if (!match) return undefined;
  const terms = knowledgeTerms(direction.statement);
  const negative = match[2].split(/[，,](?=(?:仅|只|同时|并且|另|但))/u)[0];
  const items = negative.split(/[、/，,]|或|以及|及|和|与/u).map(item => item.trim().replace(/^(?:重写|开发|新建|新增|实现|引入)/u, "")).filter(Boolean);
  const related = items.filter(item => {
    const own = knowledgeTerms(item), shared = [...own].filter(term => terms.has(term));
    return direction.statement.includes(item) || shared.some(term => term.length >= 2 && !/^(?:功能|项目|系统|平台|用户|开发|信息|数据)$/u.test(term));
  });
  if (!related.length) return undefined;
  if (related.length === items.length && scope.statement.length <= 130) return scope.statement;
  const phase = scope.statement.match(/本阶段|本轮|现阶段|第一版|\bV\d+(?:\.\d+)*\b|\bMVP\b/iu)?.[0] ?? "";
  // "本轮禁止比价": a colon here read "阶段范围：本轮禁止：比价" once prefixed.
  return `${phase}${match[1]}${related.join("、")}。`;
}

/** A user's adopted direction and a phase restriction are separate facts. Keep
 * both with their own provenance; an older, subsequently taken-up scope is not current. */
export function wikiScopeConditions(organization: WikiKnowledgeOrganization, units: WikiKnowledgeUnit[]): WikiScopeCondition[] {
  const known = new Map(units.map(unit => [unit.id, unit])), past = laterTakenUp(units);
  return organization.relations.flatMap(relation => {
    const direction = known.get(relation.older), scope = known.get(relation.newer);
    const text = direction && scope ? relevantScope(direction, scope) : undefined;
    return relation.kind === "narrows" && relation.status === "resolved" && direction && scope && text && !direction.about && !scope.about && !past.has(scope.id)
      && /(?:本阶段|本轮|现阶段|第一版|\bV\d|\bMVP\b|\b(?:this phase|first version|current phase)\b)/iu.test(scope.statement)
      && /不做|不开发|不包含|不提供|禁止|暂不|暂缓|\b(?:not|won't|defer)\b/iu.test(scope.statement) ? [{ direction: direction.id, scope, text }] : [];
  });
}

/** Make the phase boundary explicit beside the wider direction. Only generated
 * paragraphs are processed; each appended restriction retains its own unit. A paragraph already saying the
 * restriction ("……提供比价推荐及链接，但本轮禁止比价") gets nothing: one run added 「阶段范围：本轮禁止：比价」 after it.
 * The chapter opening is a paragraph too: "已确认……提供比价推荐功能" opened the chapter with no word of this round. */
export function applyWikiScopeConditions(chapters: WikiDraftChapter[], conditions: WikiScopeCondition[]): number {
  let changed = 0;
  const pending = (text: string, unitIds: string[]) => [...new Map(conditions.filter(condition => unitIds.includes(condition.direction) && !unitIds.includes(condition.scope.id) && !statesScope(text, condition)).map(condition => [condition.scope.id, condition])).values()];
  const line = (condition: WikiScopeCondition) => `阶段范围：${condition.text ?? condition.scope.statement}`;
  for (const chapter of chapters) {
    const opening = chapter.body.startsWith("### ") ? "" : chapter.body.split(/\n### /u)[0].trim();
    const openingScopes = opening && chapter.openingUnitIds?.length ? pending(opening, chapter.openingUnitIds) : [];
    if (openingScopes.length) {
      chapter.body = chapter.body.replace(opening, `${opening}\n\n${openingScopes.map(line).join("\n\n")}`);
      chapter.openingUnitIds = [...new Set([...chapter.openingUnitIds!, ...openingScopes.map(condition => condition.scope.id)])];
      changed++;
    }
    for (const paragraph of chapter.paragraphs) {
      const scopes = pending(paragraph.text, paragraph.unitIds);
      if (!scopes.length) continue;
      const before = paragraph.text;
      paragraph.text = `${before}\n\n${scopes.map(line).join("\n\n")}`;
      paragraph.unitIds = [...new Set([...paragraph.unitIds, ...scopes.map(condition => condition.scope.id)])];
      paragraph.claims = [...paragraph.claims ?? [], ...scopes.map(condition => ({ text: condition.text ?? condition.scope.statement, unitIds: [condition.scope.id] }))];
      chapter.body = chapter.body.replace(before, paragraph.text);
      changed++;
    }
  }
  return changed;
}

/** The objects a scope leaves out ("实时比价" and 比价). */
function scopeObjects({ scope, text: narrowed }: WikiScopeCondition): string[] {
  const left = (narrowed ?? scope.statement).match(/(?:不做|不开发|不包含|不提供|禁止(?:开发)?|暂不(?:开发)?|暂缓)[：:]?\s*([^。；;，,]+)/u)?.[1] ?? "";
  return left.split(/[、/]|或|以及|及|和|与/u).flatMap(item => {
    const clean = item.replace(/^(?:实时|任何|完整的?)/u, "").replace(/(?:功能|信息|系统|服务|等)$/u, "").trim();
    return clean.length >= 2 ? [clean, ...(/\p{Script=Han}{2}$/u.test(clean) ? [clean.slice(-2)] : [])] : [];
  });
}
/** Whether a text already says the scope leaves its object out now: a clause naming the object as left out. */
function statesScope(text: string, condition: WikiScopeCondition): boolean {
  const objects = scopeObjects(condition);
  return text.split(/[。！？!?；;，,\n]/u).some(clause => objects.some(object => clause.toLocaleLowerCase().includes(object.toLocaleLowerCase())) && /暂不|暂缓|禁止|不(?:做|开发|包含|提供|实现)|本轮|本阶段|\b(?:not|won't|defer)\b/iu.test(clause));
}

/** Check the source's excluded objects, rather than a product-specific vocabulary.
 * Describing an excluded feature is allowed when its direction/phase is explicit. */
export function unscopedWikiDirections(text: string, conditions: WikiScopeCondition[]): string[] {
  const objects = conditions.flatMap(scopeObjects);
  return text.split(/(?<=[。！？!?])/u).filter(sentence => {
    const own = knowledgeTerms(sentence);
    return objects.some(object => sentence.toLocaleLowerCase().includes(object.toLocaleLowerCase()) || own.has(object))
      && !/方向|愿景|希望|长期|未来|后续|暂不|暂缓|不(?:做|开发|包含|提供)|禁止|\b(?:goal|future|later|defer|not|won't)\b/iu.test(sentence);
  });
}
