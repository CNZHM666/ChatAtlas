const GENERIC = /^(?:AI|UI|UX|API|APP|LLM|SDK|ID|KEY|TOKEN|WEB|URL)$/iu;
const GENERIC_ACTIVITY = /^(?:开发|设计|部署|验证|推广|发布|测试|维护)$/u;
/** A compound feature name is not identified by one shared word such as Preview or Provider. */
export function wikiScopeNamesAgree(item: string, clause: string) {
  if (GENERIC_ACTIVITY.test(item.trim())) return false;
  const names = [...new Set(item.match(/[A-Za-z][\w.+#-]*/gu)?.filter(name => name.length >= 3 && !GENERIC.test(name)) ?? [])];
  return names.length < 2 || names.every(name => new RegExp(`(?<![A-Za-z0-9])${name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}(?![A-Za-z0-9])`, "iu").test(clause));
}
export function withoutUnrelatedScopeNotes(body: string) {
  return body.replace(/^> (?:\*\*)?范围有分歧(?:\*\*)?[：:]「([^」]+)」([^\n]*?又(?:建议|写)「([^」]+)」[^\n]*)$/gmu, (line, item: string, _rest: string, clause: string) => wikiScopeNamesAgree(item, clause) ? line : "");
}
