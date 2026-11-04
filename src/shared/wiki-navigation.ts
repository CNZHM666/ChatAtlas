import {wikiEditorialTitle} from "./wiki-title";
import type { FocusSection, FocusSession } from "./focus-session";

const generatedGroups: Record<string, string> = {
  "product positioning": "产品定位", "project positioning": "项目定位", "project goals": "项目定位",
  "product strategy": "产品战略", "technical architecture": "技术架构", "technology architecture": "技术架构",
  "product design": "产品设计", "implementation planning": "实施计划", "implementation plan": "实施计划",
  "development planning": "开发计划", "development plan": "开发计划", "development progress": "开发进度",
  "release and validation": "发布与验证", "feature planning": "功能规划", "uncategorized": "待归类",
  "data architecture":"技术架构","data storage":"技术架构","storage":"技术架构","architecture":"技术架构",
  "user experience":"产品设计","ui ux":"产品设计","ui / ux":"产品设计","interaction design":"产品设计",
  "market strategy":"产品战略","content strategy":"产品战略","context engine":"技术架构",
};
export function localizedWikiGroup(group: string | undefined, zh: boolean): string | undefined {
  if(!group||!zh)return group?.trim();
  const key=group.trim().toLowerCase().replace(/[_-]+/gu," ").replace(/\s+/gu," ");
  return generatedGroups[key]??group.trim();
}

/** Repair generated categories by the page's primary subject; manual categories are authoritative. */
export function wikiCategory(section: FocusSection): string | undefined {
  if (section.wikiGroupEdited) return section.wikiGroup;
  if (section.wikiQuestion && section.wikiGroup?.trim()) return section.wikiGroup.trim();
  const title = (section.wikiOriginalTitle ?? section.title).trim();
  const zh = /[\u4e00-\u9fff]/u.test(title);
  // Mixed headings such as “核心架构与开发阶段规划” describe architecture first.
  if (/^(?:核心|系统|技术|数据|软件|硬件)?架构|^(?:technical|system|core|data) architecture/iu.test(title)) return zh ? "技术架构" : "Technical architecture";
  if (/^(?:UI\/?UX|用户旅程|用户体验|交互|界面|产品设计|新手引导)|^(?:user experience|user journey|interaction|UI design)/iu.test(title)) return zh ? "产品设计" : "Product design";
  if (/^(?:实施里程碑|开发进度|开发记录|开发阶段|Milestone\s*\d|M\d|版本演进|版本变迁)|^(?:development progress|release history)/iu.test(title)) return zh ? "开发进度" : "Development progress";
  if (/^(?:发布策略|验证策略|测试与验证)|^(?:release strategy|validation strategy)/iu.test(title)) return zh ? "发布与验证" : "Release and validation";
  if (section.wikiGroup?.trim()) return section.wikiGroup.trim();
  if (/架构|数据模型|接口设计|电气验证|architecture|data model|interfaces/iu.test(title)) return zh ? "技术架构" : "Technical architecture";
  if (/用户体验|交互|界面|小白|新手|产品设计|user experience|interaction|UI design/iu.test(title)) return zh ? "产品设计" : "Product design";
  if (/愿景|定位|项目目标|vision|positioning|project goals/iu.test(title)) return zh ? "项目定位" : "Project goals";
  if (/里程碑|路线图|开发|roadmap|milestone|development/iu.test(title)) return zh ? "开发进度" : "Development progress";
  if (/采购|实物验证|测试|验证|发布|procurement|testing|validation|release/iu.test(title)) return zh ? "发布与验证" : "Release and validation";
  return undefined;
}

/** Missing automatic taxonomy is not a reading task or an error. */
export function wikiReadingLocation(section:FocusSection,zh:boolean){
 const group=section.wikiGroupEdited?section.wikiGroup:localizedWikiGroup(wikiCategory(section),zh);
 return group?.trim()&&(section.wikiGroupEdited||!/^(?:待归类|未分类|uncategorized)$/iu.test(group.trim()))?`Wiki / ${group.trim()}`:"Wiki";
}

/** Consecutive chapters of wikiSections() under their part. A single part, or
 * none, is not shown: parts are navigation only when they divide the Wiki. */
export function wikiParts<T extends Pick<FocusSection,"wikiGroup">>(pages:T[]):Array<{name:string;pages:T[]}>{
 const name=(page:T)=>{const group=page.wikiGroup?.trim()??"";return /^(?:待归类|未分类|uncategorized)$/iu.test(group)?"":group;};
 const parts:Array<{name:string;pages:T[]}>=[];
 for(const page of pages){const last=parts.at(-1);if(last&&last.name===name(page))last.pages.push(page);else parts.push({name:name(page),pages:[page]});}
 return new Set(parts.map(part=>part.name)).size>1?parts:[];
}

export function wikiSections(session: FocusSession, locale = session.locale): FocusSection[] {
  const ranks = new Map((session.wikiOrder ?? []).map((id, index) => [id, index]));
  const zh = locale === "zh-CN" || !locale && session.sections.some(section => /\p{Script=Han}/u.test(section.title));
  const ordered = session.sections.map(section => ({ ...section, wikiGroup: section.wikiGroupEdited || session.wikiGroups?.includes(section.wikiGroup ?? "") ? section.wikiGroup : localizedWikiGroup(wikiCategory(section), zh) })).sort((a, b) => (ranks.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (ranks.get(b.id) ?? Number.MAX_SAFE_INTEGER));
  const groups = [...new Set([...(session.wikiGroups ?? []), ...ordered.map(section => section.wikiGroup?.trim() ?? "")])];
  return groups.flatMap(group => ordered.filter(section => (section.wikiGroup?.trim() ?? "") === group));
}

export function createWikiGroup(session: FocusSession, name: string): FocusSession {
  const group = name.trim();
  if (!group || group.length > 60) throw new Error("Invalid chapter name");
  const existing = [...(session.wikiGroups ?? []), ...wikiSections(session).map(section => section.wikiGroup ?? "")];
  if (existing.includes(group)) throw new Error("章节已存在 / Chapter already exists");
  return { ...session, wikiGroups: [...(session.wikiGroups ?? []), group], wikiCollapsedGroups: { ...session.wikiCollapsedGroups, [group]: false }, updatedAt: Date.now() };
}

/** Move only navigation metadata; stable page IDs, prose and original chronology remain intact. */
export function placeWikiPage(session: FocusSession, id: string, group: string, before?: string): FocusSession {
  const ordered = wikiSections(session), page = ordered.find(item => item.id === id);
  if (!page || before === id) return session;
  const destination = group.trim();
  if (before && !ordered.some(item => item.id === before && (item.wikiGroup ?? "") === destination)) throw new Error("Invalid chapter destination");
  const ids = ordered.filter(item => item.id !== id).map(item => item.id);
  const last = ordered.filter(item => item.id !== id && (item.wikiGroup ?? "") === destination).at(-1);
  const at = before ? ids.indexOf(before) : last ? ids.indexOf(last.id) + 1 : ids.length;
  ids.splice(at, 0, id);
  return { ...session, sections: session.sections.map(item => item.id === id ? { ...item, wikiGroup: destination || undefined, wikiGroupEdited: true } : item), wikiOrder: ids, wikiCollapsedGroups: { ...session.wikiCollapsedGroups, [destination]: false }, updatedAt: Date.now() };
}

/** User directory edits are presentation, separate from source chronology and facts. */
export function carryWikiNavigation(previous: FocusSession, next: FocusSession) {
  const matched = new Map<string, string>(), used = new Set<string>();
  const sourceKeys = (session: FocusSession, section: FocusSection) => new Set(session.evidence.filter(ref => section.evidenceIds.includes(ref.id)).map(ref => JSON.stringify([ref.conversationId, ref.messageId])));
  for (const old of previous.sections) {
    let candidates = next.sections.filter(section => section.id === old.id && !used.has(section.id));
    if (!candidates.length) candidates = next.sections.filter(section => !used.has(section.id) && [old.title, old.wikiOriginalTitle].includes(section.title));
    if (candidates.length !== 1) {
      const refs = sourceKeys(previous, old);
      candidates = next.sections.filter(section => { const nextRefs = sourceKeys(next, section); return !used.has(section.id) && refs.size > 0 && [...refs].filter(id => nextRefs.has(id)).length / Math.max(refs.size, nextRefs.size) >= .75; });
    }
    if (candidates.length === 1) { matched.set(old.id, candidates[0].id); used.add(candidates[0].id); }
  }
  const sections = next.sections.map(section => {
    const old = previous.sections.find(item => matched.get(item.id) === section.id);
    if (!old) return section;
    const links = {...(old.wikiDiagram?{wikiDiagram:old.wikiDiagram}:{}),...(old.relatedKnowledgeIds ? {relatedKnowledgeIds:old.relatedKnowledgeIds.map(id=>matched.get(id)??id)} : {}), ...(old.matterLinks ? {matterLinks:old.matterLinks} : {})};
    if (old.wikiDisplayTitle === undefined && old.wikiOriginalTitle === undefined && !old.wikiGroupEdited && (section.wikiGroup || !old.wikiGroup)) return {...section,...links};
    return { ...section, ...links, ...(old.wikiDisplayTitle !== undefined ? { wikiDisplayTitle: old.wikiDisplayTitle } : {}), ...(old.wikiOriginalTitle !== undefined ? { title: old.title, wikiOriginalTitle: section.wikiOriginalTitle ?? section.title } : {}), ...(old.wikiGroupEdited ? { wikiGroup: old.wikiGroup, wikiGroupEdited: true } : !section.wikiGroup && old.wikiGroup ? { wikiGroup: old.wikiGroup } : {}) };
  });
  return { sections, ...(previous.wikiGroups ? { wikiGroups: previous.wikiGroups } : {}), ...(previous.wikiOrder ? { wikiOrder: previous.wikiOrder.flatMap(id => matched.has(id) ? [matched.get(id)!] : []) } : {}), ...(previous.wikiCollapsedGroups ? { wikiCollapsedGroups: previous.wikiCollapsedGroups } : {}) };
}

/** Only conventional generated labels are localized. Personal titles and proper names stay intact. */
export function localizedWikiTitle(section:FocusSection,zh:boolean){
 if(!zh||section.origin||section.userEdited||section.wikiOriginalTitle)return section.title;
 const titles:Record<string,string>={"overview":"项目概况","project overview":"项目概况","technical architecture":"技术架构","system architecture":"系统架构","product positioning":"产品定位","product positioning and scope":"产品定位","implementation plan":"实施计划","development plan":"开发计划","key decisions":"关键决策","project boundaries":"项目边界","next steps":"下一步行动","release and validation":"发布准备"};
 return wikiEditorialTitle(titles[section.title.trim().toLowerCase()]??section.title,zh);
}
