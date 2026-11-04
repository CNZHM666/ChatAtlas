import type { FocusSection } from "../shared/focus-session";
import { AIProviderValidationError } from "./provider-errors";
import { validateWikiDirectory } from "./wiki-directory";
import { assertWikiOutline } from "./wiki-outline-policy";
import { expandWikiAssignments } from "./wiki-plan-assignments";
import {wikiEditorialTitle} from "../shared/wiki-title";
import {expandWikiSlotRouting} from "./wiki-slot-routing";

type Row = Record<string, unknown>;
const row = (value: unknown): Row => value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
const ids = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const unique = (value: unknown) => Array.isArray(value) ? [...new Set(value)] : value;
// A scope label is editorial metadata, not a new question or factual assertion.
const trimMetadata = (value: Row): Row => Object.fromEntries(Object.entries(value).map(([key,item])=>[key,["title","question","group"].includes(key)&&typeof item==="string"?item.trim():item]));
const scopeLabel = (input: Row) => {const value=trimMetadata(input);return (value.question == null || typeof value.question === "string" && !value.question.trim()) && typeof value.title === "string" && value.title.trim() ? { ...value, question: value.title.trim() } : value;};

/** Mechanical normalization only; this is NOT a validated directory. */
export function normalizeWikiPlanInput(value: unknown, sections: FocusSection[]) {
  const expanded = expandWikiAssignments(expandWikiSlotRouting(value,sections), sections);
  const input = Array.isArray(expanded) ? expanded : row(expanded).pages;
  const pages = Array.isArray(input) ? input.map(value => {
    const page = scopeLabel(row(value));
    const subtopics = Array.isArray(page.subtopics) ? page.subtopics.map(value => {
      const topic = scopeLabel(row(value));
      return { ...topic, sectionIds: unique(topic.sectionIds) };
    }) : page.subtopics;
    return { ...page,...(typeof page.title==="string"?{title:wikiEditorialTitle(page.title,/[\p{Script=Han}]/u.test(page.title))}:{}), sectionIds: page.sectionIds === undefined && Array.isArray(subtopics)
      ? [...new Set(subtopics.flatMap(topic => ids(topic.sectionIds)))] : unique(page.sectionIds),
      ...(subtopics === undefined ? {} : { subtopics }) };
  }) : input;
  return pages;
}

/** Only mechanical redundancy is normalized. Ambiguous or missing ownership still fails. */
export function validateWikiPlan(value: unknown, sections: FocusSection[],options?:{candidate?:boolean}) {
  const pages = normalizeWikiPlanInput(value, sections);
  const known = new Set(sections.map(section => section.id)), seen = new Set<string>();
  const duplicateIds = new Set<string>(), unknownIds = new Set<string>(), parentMismatchIds = new Set<string>();
  const invalidLabels = new Map<unknown, string>();
  const alias = (id: unknown) => {
    if (typeof id === "string" && /^m\d{1,5}$/u.test(id)) return id;
    if (!invalidLabels.has(id)) invalidLabels.set(id, `invalid-${invalidLabels.size}`);
    return invalidLabels.get(id)!;
  };
  for (const page of Array.isArray(pages) ? pages : []) {
    const parent = ids(page.sectionIds);
    const leaves = Array.isArray(page.subtopics) ? page.subtopics.flatMap((topic: unknown) => ids(row(topic).sectionIds)) : parent;
    // One parent owns each material. Distinct child questions may share support.
    for (const id of new Set(leaves)) {
      if (typeof id !== "string" || !known.has(id)) unknownIds.add(alias(id));
      else { if (seen.has(id)) duplicateIds.add(id); seen.add(id); }
    }
    for (const id of parent) if (typeof id !== "string" || !known.has(id)) unknownIds.add(alias(id));
    if (Array.isArray(page.subtopics)) for (const id of new Set([...parent, ...leaves])) {
      if (!parent.includes(id) || !leaves.includes(id)) parentMismatchIds.add(alias(id));
    }
  }
  // Discard generated catalogue placeholders whose ownership is explicitly
  // empty, even when ownership is still invalid: the error must then name the
  // missing or unknown material, not an empty subtopic. Never repair ownership here.
  const paths = new Map<string,string>();
  const checkedPages = Array.isArray(pages) ? pages.flatMap((page, index) => {
    const empty = (value: unknown) => Array.isArray(value) && !value.length;
    const children: Row[] | undefined = Array.isArray(page.subtopics) ? page.subtopics : undefined;
    if(empty(page.sectionIds) && (page.subtopics === undefined || children?.every(topic => empty(topic.sectionIds))))return [];
    return [{ page, index, children }];
  }).map(({page,index,children},nextIndex) => {
    paths.set(`pages[${nextIndex}]`,`pages[${index}]`);
    let nextChild=0;
    const subtopics=children?.filter((topic,child)=>{
      if(Array.isArray(topic.sectionIds)&&!topic.sectionIds.length)return false;
      paths.set(`pages[${nextIndex}].subtopics[${nextChild++}]`,`pages[${index}].subtopics[${child}]`);
      return true;
    });
    return {...page,...(subtopics?{subtopics}:{})};
  }) : pages;
  const originalPath=(path:string)=>{
    const prefix=[...paths.keys()].sort((a,b)=>b.length-a.length).find(prefix=>path===prefix||path.startsWith(prefix+".")||path.startsWith(prefix+"["));
    return prefix?paths.get(prefix)!+path.slice(prefix.length):path;
  };
  try {
    const valid = validateWikiDirectory({ pages: checkedPages }, sections, true).map(page => ({ ...page,
      sectionIds: sections.filter(section => page.sectionIds.includes(section.id)).map(section => section.id),
      ...(page.subtopics ? { subtopics: page.subtopics.map(topic => ({ ...topic, sectionIds: sections.filter(section => topic.sectionIds.includes(section.id)).map(section => section.id) })) } : {}) }));
    // Only planner candidates may retain extra chapters or provisional duplicate
    // names. Publication still requires strict counts and unique names.
    assertWikiOutline(valid,true,options?.candidate?sections.length:undefined,{allowDuplicateTitles:options?.candidate});
    return valid;
  } catch (error) {
    if (error instanceof AIProviderValidationError) {
      error.fieldPaths=error.fieldPaths?.map(originalPath);
      error.wikiDirectoryIssues=error.wikiDirectoryIssues?.map(issue=>({...issue,path:originalPath(issue.path)}));
      error.wikiDirectoryDetails = {
      missingIds: sections.filter(section => !seen.has(section.id)).map(section => section.id),
      duplicateIds: [...duplicateIds], unknownIds: [...unknownIds].slice(0, 36), parentMismatchIds: [...parentMismatchIds].slice(0, 36),
      };
    }
    throw error;
  }
}

export function wikiPlanFailureMessage(error: AIProviderValidationError, locale: string) {
  if(error.code.endsWith("_scope_review"))return locale==="zh-CN"?"AI 未返回内容范围核对结果，尚未发布本次目录。原文和已完成的初读已保留，请重试范围核对。":"The AI did not return its content scope review. This outline was not published; originals and completed reading are retained. Retry the scope review.";
  if(error.code.includes("wiki_directory_name_repair")||error.code.endsWith("wiki_directory_duplicate_title"))return locale==="zh-CN"?"Wiki 目录存在尚未区分的重名章节。已保留材料归属和完成的分析；重试将继续核对目录，无需重新导入材料。尚未保存不完整目录。":"Some Wiki chapters still have duplicate names. Material ownership and completed analysis are retained; retry continues directory review without reimporting sources. The incomplete directory was not published.";
  if(error.wikiPlanningResume){const {phase,completed,remaining,reason}=error.wikiPlanningResume;
    if(reason==="stalled"&&phase==="ownership")return locale==="zh-CN"?`Wiki 归属修复本轮未收到新的有效分配，仍有 ${remaining} 项待处理。已确认的 ${completed} 项和待修复草稿已保留；可调整模型，或重试剩余材料。尚未保存不完整目录。`:`Wiki ownership repair received no new valid assignments (${remaining} unresolved). The ${completed} confirmed assignments and repair draft are retained; adjust the model or retry the remaining materials. The incomplete directory was not published.`;
    if(reason==="stalled")return locale==="zh-CN"?`Wiki 目录本轮未能继续归并，仍有 ${remaining} 个候选章节。进度已保存；重试会针对当前候选重新整理，也可调整目标或模型。尚未保存不完整目录。`:`Wiki grouping made no further progress (${remaining} candidates). Progress is saved; retry reconsiders the current candidates, or adjust the goal or model. The incomplete directory was not published.`;
    return locale==="zh-CN"?`Wiki ${phase==="ownership"?`归属修复已确认 ${completed} 项，剩余 ${remaining} 项`: `目录已推进，剩余 ${remaining} 个候选章节`}。本轮自动整理已达上限，进度已保存；重试将从这里继续，无需重新分析材料。尚未保存不完整目录。`:`Wiki ${phase==="ownership"?`ownership has ${completed} confirmed and ${remaining} unresolved assignments`:`grouping has ${remaining} remaining candidates`}. This run reached its limit. Progress is saved; retry continues here without rereading sources. The incomplete directory was not published.`;
  }
  if(error.code.endsWith("_scope_empty"))return locale==="zh-CN"?"所选材料暂未识别到属于本项目的内容，请调整项目目标或来源。原文和分析缓存已保留。":"No project material was identified. Adjust the goal or sources; originals and reading caches are retained.";
  if(error.code.endsWith("_scope"))return locale==="zh-CN"?"材料分流未通过校验，尚未采用删减结果。原文和分析缓存已保留，请重试。":"Source routing failed validation. No omissions were adopted; originals and reading caches are retained. Retry.";
  if(error.wikiOwnershipDetails){const {expectedSlots,receivedSlots,reason}=error.wikiOwnershipDetails;return locale==="zh-CN"?`Wiki 归属修复${reason==="count"?`需要 ${expectedSlots} 项有效分配，模型返回 ${receivedSlots} 项`:"包含无效的主题目标或条目编号"}。已保留完成的分析，未保存不完整目录。`:`Wiki ownership repair ${reason==="count"?`requires ${expectedSlots} assignments but received ${receivedSlots}`:"contains invalid destinations or slot identifiers"}. Completed analysis is retained; the incomplete directory was not saved.`;}
  if(error.wikiDirectoryCounts){const {mainCount,maxMainCount}=error.wikiDirectoryCounts;return locale==="zh-CN"?`Wiki 目录仍有 ${mainCount} 个主章节，目标最多 ${maxMainCount} 个，已停止本次自动收敛。请调整整理目标或来源范围后再试。已保留完成的分析和候选目录，尚未保存不完整目录。`:`The Wiki directory still has ${mainCount} main chapters (maximum ${maxMainCount}). Automatic convergence stopped. Adjust the goal or scope before retrying. Completed analysis and candidates are retained; the incomplete directory was not saved.`;}
  if(error.code === "PROVIDER_SCHEMA_wiki_directory_topic_key" || error.code === "PROVIDER_SCHEMA_wiki_directory_duplicate_topic_key")return locale === "zh-CN"
    ? "Wiki 目录的小节标识缺失或冲突，无法确定材料归属。已保留完成的分析，重试将继续目录整理，无需重新导入材料。"
    : "Wiki subtopic identifiers are missing or conflicting, so material ownership cannot be determined. Completed analysis is retained; retry resumes directory planning without reimporting material.";
  const issue=error.wikiDirectoryIssues?.[0];
  if(issue){
    const target=issue.path.endsWith(".title")?locale==="zh-CN"?"标题":"title":issue.path.endsWith(".question")?locale==="zh-CN"?"范围说明":"scope description":locale==="zh-CN"?"材料列表":"source list";
    const position=issue.path.match(/^pages\[(\d+)\](?:\.subtopics\[(\d+)\])?/u);
    const location=position?locale==="zh-CN"?`第 ${Number(position[1])+1} 章${position[2]===undefined?"":`第 ${Number(position[2])+1} 个子主题`}`:`chapter ${Number(position[1])+1}${position[2]===undefined?"":`, subtopic ${Number(position[2])+1}`}`:locale==="zh-CN"?"目录":"directory";
    return locale==="zh-CN"?`Wiki ${location}的${target}${issue.reason==="text_too_long"?`超过 ${issue.maxLength} 字符`:issue.reason==="empty_source_list"?"没有有效材料":issue.reason==="invalid_source_list"?"格式无效":"缺失或格式无效"}。已保留完成的分析，尚未保存不完整目录。`
      :`Wiki ${location}: ${target} ${issue.reason==="text_too_long"?`exceeds ${issue.maxLength} characters`:issue.reason==="empty_source_list"?"has no sources":issue.reason==="invalid_source_list"?"has an invalid format":"is missing or invalid"}. Completed analysis is retained; the incomplete directory was not saved.`;
  }
  const details = error.wikiDirectoryDetails;
  const count = details ? details.missingIds.length + details.duplicateIds.length + details.unknownIds.length + details.parentMismatchIds.length + (details.invalidAssignmentIds?.length ?? 0) : 0;
  if (details?.invalidAssignmentIds?.length) return locale === "zh-CN"
    ? `Wiki 目录中有 ${details.invalidAssignmentIds.length} 项材料未指定有效子主题${details.missingIds.length ? `，另遗漏 ${details.missingIds.length} 项` : ""}。已保留完成的分析，尚未保存不完整目录。`
    : `Wiki materials have ${details.invalidAssignmentIds.length} invalid subtopic assignments and ${details.missingIds.length} missing assignments. Completed analysis is retained; the incomplete directory was not saved.`;
  if (locale === "zh-CN") return count
    ? `Wiki 目录材料归属未通过校验：遗漏 ${details!.missingIds.length} 项、重复 ${details!.duplicateIds.length} 项、未知编号 ${details!.unknownIds.length} 项、父子归属不一致 ${details!.parentMismatchIds.length} 项。已保留完成的分析，尚未保存不完整目录。`
    : "Wiki 目录的章节、命名或层级未通过校验。已保留完成的分析，尚未保存不完整目录。";
  return count
    ? `Wiki ownership validation failed: ${details!.missingIds.length} missing, ${details!.duplicateIds.length} duplicated, ${details!.unknownIds.length} unknown and ${details!.parentMismatchIds.length} parent/child mismatches. Completed analysis is retained; the incomplete directory was not saved.`
    : "Wiki chapter, naming or hierarchy validation failed. Completed analysis is retained; the incomplete directory was not saved.";
}
