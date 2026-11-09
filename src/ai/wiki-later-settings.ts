import { knowledgeTerms } from "../shared/knowledge-subject";
import type { WikiKnowledgeOrganization, WikiKnowledgeUnit } from "../shared/wiki-knowledge";
import { wikiByDiscussion, wikiSaidLater } from "../shared/wiki-sources";

/** The property a measure in a clause sets: the nearest property word before it ("max-width 760~800px", "宽约600～720px"),
 * or a duration by its unit ("200ms 左右的过渡"). */
const PROPERTIES: Array<[string, RegExp]> = [
  ["width", /宽|width/giu], ["height", /高度|height/giu], ["radius", /圆角|radius/giu], ["padding", /padding|内边距/giu],
  ["font", /字号|font-size|title|标题/giu], ["gap", /间距|gap|spacing/giu],
];
const MEASURE = /(\d+(?:\.\d+)?)\s*(?:[-–~～至到]\s*(\d+(?:\.\d+)?)\s*)?(px|ms|毫秒)/giu, LOOK_BACK = 16;
/** property → the values a statement gives it, as ranges. */
export function settingsOf(statement: string): Map<string, Array<[number, number]>> {
  const found = new Map<string, Array<[number, number]>>();
  for (const clause of statement.split(/[，,；;。]/u)) for (const match of clause.matchAll(MEASURE)) {
    const at = match.index ?? 0, before = clause.slice(Math.max(0, at - LOOK_BACK), at);
    let property: string | undefined, last = -1;
    for (const [name, word] of PROPERTIES) for (const hit of before.matchAll(word)) if ((hit.index ?? 0) > last) { last = hit.index ?? 0; property = name; }
    if (!property && /ms|毫秒/iu.test(match[3])) property = "duration";
    if (!property) continue;
    const low = Number(match[1]), high = match[2] ? Number(match[2]) : low;
    found.set(property, [...found.get(property) ?? [], [Math.min(low, high), Math.max(low, high)]]);
  }
  return found;
}
/** A clause that is a property and its value alone ("padding 16px", "title 24~28px"), with nothing else it says. */
export function bareSetting(clause: string): boolean {
  if (!settingsOf(clause).size) return false;
  let rest = clause.replace(MEASURE, "");
  for (const [, word] of PROPERTIES) rest = rest.replace(word, "");
  return rest.replace(/[\s:：约为是~～\-–]/gu, "").length === 0;
}
/** The screen size a line is about (移动端 / Desktop), which two equal values must share to be one rule. */
export const screenSizeOf = (text: string) => [/mobile|移动端|手机/iu, /desktop|桌面/iu].map(word => word.test(text) ? "1" : "0").join("");
/** A property both give, with no value the same in both: "宽约600～720px" and "max-width 760~800px", "200ms 左右" and
 * "150~220ms". The same value told again ("padding 16px" twice) is a restatement, not another version. */
function conflicting(a: Map<string, Array<[number, number]>>, b: Map<string, Array<[number, number]>>): string | undefined {
  return [...a.keys()].find(property => b.has(property) && !a.get(property)!.some(value => b.get(property)!.some(other => other[0] === value[0] && other[1] === value[1])));
}

/** The part of the interface a statement is about, by its common names in both languages: "Landing Page" and "Welcome
 * Screen" are the 首页, "输入框" and "Composer" one box. */
const SCREENS: Array<[string, RegExp]> = [["首页", /首页|欢迎页|landing\s*page|welcome|\bhero\b/iu], ["工作区", /workspace|工作区|canvas|画布/iu]];
const PARTS: Array<[string, RegExp]> = [
  ...SCREENS, ["输入框", /输入框|composer/iu], ["右侧面板", /右侧面板|右栏|inspector|right\s*panel/iu], ["左侧栏", /左侧栏|左栏|sidebar|explorer|left\s*panel/iu],
  ["顶部栏", /顶部栏|顶栏|\bheader\b|toolbar|工具栏/iu], ["底部栏", /底部栏|bottom\s*bar|drawer/iu], ["节点", /节点|\bnode\b/iu],
];
const named = (names: Array<[string, RegExp]>, text: string) => [...names.filter(([, word]) => word.test(text)).map(([name]) => name)].sort().join(",");
const SETTING_SHARED = 5, SETTING_COVER = .25;
/** One setting: on the same screen (首页, 工作区, or neither named), and either of the same subject by its common names
 * ("Landing Page" and "Welcome Screen" are the 首页) or in most of the same words ("动画克制，允许 hover……200ms" and
 * "动画必须克制，允许 150~220ms……hover"). The workspace toolbar (44~50px) and the 首页 header (56~64px) are two bars, and
 * the Welcome composer and a component card share only 圆角、边框、无阴影. */
function sameSetting(a: WikiKnowledgeUnit, b: WikiKnowledgeUnit): boolean {
  const all = (unit: WikiKnowledgeUnit) => `${unit.subject} ${unit.facet ?? ""} ${unit.statement}`;
  if (named(SCREENS, all(a)) !== named(SCREENS, all(b))) return false;
  const subject = named(PARTS, a.subject);
  if (subject && subject === named(PARTS, b.subject)) return true;
  const ta = knowledgeTerms(a.statement), tb = knowledgeTerms(b.statement);
  let common = 0; for (const term of ta) if (tb.has(term)) common++;
  return common >= SETTING_SHARED && common / Math.max(1, Math.min(ta.size, tb.size)) >= SETTING_COVER;
}

/** A setting the discussion gave again later with another value: the first design's "宽约600～720px的输入框" (message 24)
 * and the redesign's "max-width 760~800px" (message 97) were written side by side as two rules. The earlier value is
 * replaced; the user's own words and a decision they confirmed are not replaced by a later suggestion. Returns the
 * organization with those relations added. */
export function laterSettings(organization: WikiKnowledgeOrganization, units: Map<string, WikiKnowledgeUnit>, report: Record<string, number> = {}, confirmed: (id: string) => boolean = () => false): WikiKnowledgeOrganization {
  const live = [...new Set(organization.subjects.flatMap(subject => subject.unitIds))].map(id => units.get(id)).filter((unit): unit is WikiKnowledgeUnit => Boolean(unit) && !unit!.about)
    .map(unit => ({ unit, settings: settingsOf(unit.statement) })).filter(item => item.settings.size);
  const related = new Set(organization.relations.flatMap(relation => [`${relation.older}|${relation.newer}`, `${relation.newer}|${relation.older}`]));
  const added: WikiKnowledgeOrganization["relations"] = [], replaced = new Set<string>();
  for (const older of live) {
    if (replaced.has(older.unit.id) || older.unit.evidence.role === "user" || confirmed(older.unit.id)) continue;
    const newer = live.find(item => wikiSaidLater(item.unit, older.unit)
      && !related.has(`${older.unit.id}|${item.unit.id}`) && conflicting(older.settings, item.settings) && sameSetting(older.unit, item.unit));
    if (!newer) continue;
    added.push({ older: older.unit.id, newer: newer.unit.id, kind: "replaces", status: "resolved" });
    replaced.add(older.unit.id);
  }
  // Colours of one theme ("Dark 主背景 #0D0D0D ~ #111111" at message 24, "背景色 #101011/#111112" at 101) and how much a
  // small screen is served ("手机仅要求 Landing Page 正常" before "Welcome/Discovery 优先支持移动端"): the same rule given
  // again later, read like the measures above.
  const later = (older: WikiKnowledgeUnit, newer: WikiKnowledgeUnit) => wikiSaidLater(newer, older) && !related.has(`${older.id}|${newer.id}`);
  const all = [...new Set(organization.subjects.flatMap(subject => subject.unitIds))].map(id => units.get(id)).filter((unit): unit is WikiKnowledgeUnit => Boolean(unit) && !unit!.about)
    .sort(wikiByDiscussion);
  const colours = all.map(unit => ({ unit, colours: coloursOf(unit) })).filter(item => item.colours.size);
  for (const older of colours) {
    if (replaced.has(older.unit.id) || older.unit.evidence.role === "user" || confirmed(older.unit.id)) continue;
    const newer = colours.find(item => later(older.unit, item.unit) && colourConflict(older.colours, item.colours));
    if (!newer) continue;
    added.push({ older: older.unit.id, newer: newer.unit.id, kind: "replaces", status: "resolved" });
    replaced.add(older.unit.id);
  }
  const responsive = (unit: WikiKnowledgeUnit) => RESPONSIVE.test(`${unit.subject} ${unit.facet ?? ""}`);
  for (const older of all) {
    if (replaced.has(older.id) || older.evidence.role === "user" || confirmed(older.id) || !responsive(older) || !MOBILE_LIMITED.test(older.statement)) continue;
    const newer = all.find(unit => later(older, unit) && responsive(unit) && MOBILE_SERVED.test(unit.statement) && !MOBILE_LIMITED.test(unit.statement));
    if (!newer) continue;
    added.push({ older: older.id, newer: newer.id, kind: "replaces", status: "resolved" });
    replaced.add(older.id);
  }
  if (!added.length) return organization;
  report.settings_replaced = added.length;
  return { ...organization, relations: [...organization.relations, ...added] };
}

/** The theme a colour is set for, by the clause naming it, else by the unit's subject ("Dark Mode 设计"). */
const THEMES: Array<[string, RegExp]> = [["dark", /dark|深色|暗色|夜间/iu], ["light", /light|浅色|亮色/iu]];
/** What a colour colours: the nearest such word before it. */
const COLOUR_PROPERTIES: Array<[string, RegExp]> = [["background", /主背景|背景色|背景|background|\bpage\b/giu], ["canvas", /canvas|画布|工作区/giu], ["panel", /panel|surface|面板/giu], ["border", /border|边框/giu], ["text", /主文字|主要文字|正文|\btext\b/giu]];
const HEX = /#[0-9a-f]{6}\b/giu, COLOUR_LOOK_BACK = 30;
/** theme:property → the colours a unit gives it. */
export function coloursOf(unit: WikiKnowledgeUnit): Map<string, Set<string>> {
  const found = new Map<string, Set<string>>();
  const own = THEMES.filter(([, word]) => word.test(`${unit.subject} ${unit.facet ?? ""}`)).map(([name]) => name);
  for (const clause of unit.statement.split(/[；;。]/u)) {
    const named = THEMES.filter(([, word]) => word.test(clause)).map(([name]) => name), theme = named.length === 1 ? named[0] : !named.length && own.length === 1 ? own[0] : undefined;
    if (!theme) continue;
    for (const part of clause.split(/[，,]/u)) for (const match of part.matchAll(HEX)) {
      const at = match.index ?? 0, before = part.slice(Math.max(0, at - COLOUR_LOOK_BACK), at);
      let property: string | undefined, last = -1;
      for (const [name, word] of COLOUR_PROPERTIES) for (const hit of before.matchAll(word)) if ((hit.index ?? 0) > last) { last = hit.index ?? 0; property = name; }
      if (!property) continue;
      const key = `${theme}:${property}`;
      found.set(key, new Set([...found.get(key) ?? [], match[0].toLowerCase()]));
    }
  }
  return found;
}
/** The same theme's background given with no colour in common: another version of the palette. */
function colourConflict(a: Map<string, Set<string>>, b: Map<string, Set<string>>): boolean {
  return [...a.keys()].some(key => key.endsWith(":background") && b.has(key) && ![...a.get(key)!].some(colour => b.get(key)!.has(colour)));
}
const RESPONSIVE = /responsive|mobile|移动|narrow|响应式|小屏/iu;
/** A small screen served only in part ("手机仅要求 Landing Page 正常"), and served in its own right later ("Welcome/Discovery
 * 优先支持移动端", "必须保证桌面、平板、移动端正常阅读"). */
const MOBILE_LIMITED = /(?:手机|移动端|mobile)[^。；;]{0,6}(?:仅|只)|(?:仅|只)[^。；;]{0,6}(?:手机|移动端)|desktop\s*first/iu;
const MOBILE_SERVED = /(?:优先|必须|保证)[^。；;]{0,12}(?:移动端|mobile)|移动端(?:优先|正常)|mobile\s*first/iu;
