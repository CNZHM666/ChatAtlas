const GENERIC = /^(?:AI|UI|UX|API|APP|LLM|SDK|ID|KEY|TOKEN|WEB|URL)$/iu;
const GENERIC_ACTIVITY = /^(?:开发|设计|部署|验证|推广|发布|测试|维护)$/u;
const EXTERNAL_REFERENCE = /^(?:(?:现有|同类|市面上(?:的)?|多数|其他|外部)\s*(?:开源)?(?:项目|产品|工具|平台|方案)|(?:现有|多数|这些|同类)?(?:竞品|开源(?:项目|工具))|(?:existing|other|competing|open-source)\s+(?:products?|projects?|tools?|platforms?)|competitors?\b)/iu;
export const externalWikiScopeExample = (clause: string) => EXTERNAL_REFERENCE.test(clause.trim().replace(/^(?:[-*+]\s+)?\*{0,2}/u,""))
  && !/本项目(?:将|决定|计划|需要|采用)|\b(?:our|this) project (?:will|plans? to|shall)\b/iu.test(clause);
/** A compound feature name is not identified by one shared word such as Preview or Provider. */
export function wikiScopeNamesAgree(item: string, clause: string) {
  if (GENERIC_ACTIVITY.test(item.trim()) || externalWikiScopeExample(clause)) return false;
  const names = [...new Set(item.match(/[A-Za-z][\w.+#-]*/gu)?.filter(name => name.length >= 3 && !GENERIC.test(name)) ?? [])];
  return names.length < 2 || names.every(name => new RegExp(`(?<![A-Za-z0-9])${name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}(?![A-Za-z0-9])`, "iu").test(clause));
}
export function withoutUnrelatedScopeNotes(body: string) {
  return body.replace(/^> (?:\*\*)?范围有分歧(?:\*\*)?[：:]「([^」]+)」([^\n]*?又(?:建议|写)「([^」]+)」[^\n]*)$/gmu, (line, item: string, _rest: string, clause: string) => wikiScopeNamesAgree(item, clause) ? line : "");
}
/** A proposal explicitly addresses the named project, rather than merely comparing it. */
export function wikiProposalTargetsProject(text: string, project: string): boolean {
  const name = project.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return Boolean(name && new RegExp(
    String.raw`(?:建议|提议|推荐|计划)\s*(?:给|为|替)\s*\*{0,2}${name}(?![A-Za-z0-9_-])\*{0,2}\s*(?:建立?|新增|做|设计|引入|实现|提供|增加)|\b(?:recommend|propose|suggest)\b[^.!?\n]{0,60}\bfor\s+\*{0,2}${name}(?![A-Za-z0-9_-])`,
    "iu",
  ).test(text));
}
