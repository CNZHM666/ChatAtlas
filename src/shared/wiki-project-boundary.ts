import type {FocusSession} from "./focus-session";
import {projectIntroduction} from "./project-knowledge-view";
import {knowledgeOverlap} from "./knowledge-subject";
import {aboutNameKey,wikiLedgerUnits,type WikiKnowledgeLedger} from "./wiki-knowledge";

/** Saved project identity is context, never new source proof or a chapter list. */
export interface WikiProjectBoundary { name:string; purpose?:string }
/** Only the project name and a description the user wrote. An introduction
 * derived from the Wiki's own conclusions adds no new identity, and it changes
 * with every organizing run, which would invalidate every planning and writing
 * cache keyed on this boundary. */
export function savedWikiProjectBoundary(session:FocusSession):WikiProjectBoundary {
 const introduction=projectIntroduction(session);
 const text=introduction.source==="personal"?introduction.text.trim():"";
 return {name:session.title.trim(),...(text&&text.length<=1200?{purpose:text}:{})};
}

const OWN_NAME = /(?:^|[。！？!?，,\n])\s*(?:(?:(?:我(?:们)?的|这个|本|该)\s*)?(?:项目|产品|工具|应用)\s*(?:叫做?|名为|(?:的?(?:名称|名字))\s*(?:是|暂定为|[:：]))|(?:我们?|项目组)(?:把(?:这个|该)(?:产品|项目|工具))?(?:正式)?命名为|(?:our|this)\s+(?:project|product|app|tool)\s+(?:is\s+called|is\s+named)|(?:we|I)\s+named\s+(?:it|the\s+(?:project|product)))[\s*]*[「“"'《]?([^。！？!?，,\n」”"'》:：]{2,48})(?=[。！？!?，,\n」”"'》]|$)/iu;
const GENERIC_TITLE = /^(?:项目|产品|工具|应用|对话整理|项目文档|方向推荐|Project|Product|App|Tool|Project Wiki|Untitled)$/iu;

/** Reuse the organized source scope to choose a title without paying for a
 * second naming request. A brand named by the author outranks a descriptive
 * name from the directory planner. */
export function wikiProjectTitleFromLedger(ledger: WikiKnowledgeLedger | undefined, sourceTitles: readonly string[] = []): string | undefined {
  if (!ledger?.organization || ledger.documentType === "learning") return;
  const nameOf = (value: string) => value.trim().replace(/^[\s*]+|[\s*]+$/gu, "");
  const excluded = (name: string) => ledger.scopeAnswers?.[aboutNameKey(name)] === "exclude"
    || ledger.explicitProjectExclusions?.some(item => aboutNameKey(item) === aboutNameKey(name));
  const units = wikiLedgerUnits(ledger);
  const inScope = new Set(ledger.organization.subjects.flatMap(subject => subject.unitIds));
  const own = units.filter(unit => inScope.has(unit.id) && !unit.about && unit.adoption.status !== "rejected"
    && ledger.decisions?.[unit.id]?.verdict !== "rejected");
  const pointsByMessage = new Set<string>();
  const names = new Map<string, string>();
  for (const unit of own) {
    const { role, pasted, quote, messageId } = unit.evidence;
    if (role !== "user" || pasted || pointsByMessage.has(messageId)) continue;
    const named = OWN_NAME.exec(quote)?.[1];
    if (!named) continue;
    const title = nameOf(named);
    if (GENERIC_TITLE.test(title) || excluded(title)) continue;
    pointsByMessage.add(messageId);
    names.set(aboutNameKey(title), title);
  }
  if (names.size === 1) return names.values().next().value;

  for (const candidate of [ledger.organization.projectName, ledger.organization.documentTitle]) {
    const title = nameOf(candidate ?? "");
    if (!title || /[\r\n]/u.test(title) || GENERIC_TITLE.test(title) || excluded(title)) continue;
    const key = aboutNameKey(title);
    if (sourceTitles.some(source => aboutNameKey(source) === key) || units.some(unit => unit.about && aboutNameKey(unit.about.name) === key)) continue;
    const dependencyNames = new Set(own.flatMap(unit => [...unit.evidence.quote.matchAll(/(?:使用|采用|基于|\busing\b|\bbased on\b|用)\s*[`*]*([A-Z][\w.-]{2,})/gu)]
      .map(match => match[1].toLowerCase())));
    if (own.some(unit => knowledgeOverlap(title, unit.statement).some(term => !/^(?:ai|web|项目|产品|工具)$/iu.test(term) && !dependencyNames.has(term)))) return title;
  }
}

export function wikiProjectTitleSuggestion(session: FocusSession, title = session.title): string | undefined {
  const titles = Object.values(session.wikiKnowledge?.sources ?? {}).map(source => source.title ?? "");
  const suggested = session.wikiSuggestedTitle?.trim() || (titles.some(source => aboutNameKey(source) === aboutNameKey(title))
    ? wikiProjectTitleFromLedger(session.wikiKnowledge, titles) : undefined);
  if (suggested && suggested !== title && session.wikiKnowledge?.scopeAnswers?.[aboutNameKey(suggested)] !== "exclude") return suggested;
}
