const GENERIC = /^(?:AI|UI|UX|API|APP|LLM|SDK|ID|KEY|TOKEN|WEB|URL)$/iu;
/** A compound feature name is not identified by one shared word such as Preview or Provider. */
export function wikiScopeNamesAgree(item: string, clause: string) {
  const names = [...new Set(item.match(/[A-Za-z][\w.+#-]*/gu)?.filter(name => name.length >= 3 && !GENERIC.test(name)) ?? [])];
  return names.length < 2 || names.every(name => new RegExp(`(?<![A-Za-z0-9])${name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}(?![A-Za-z0-9])`, "iu").test(clause));
}
export function withoutUnrelatedScopeNotes(body: string) {
  return body.replace(/^> (?:\*\*)?范围有分歧(?:\*\*)?[：:]「([^」]+)」([^\n]*?又(?:建议|写)「([^」]+)」[^\n]*)$/gmu, (line, item: string, _rest: string, clause: string) => wikiScopeNamesAgree(item, clause) ? line : "");
}
