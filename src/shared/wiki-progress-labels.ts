import type { WikiProgress } from "./wiki-knowledge";

/** The ledger pipeline's three steps and the seven parts of organizing, named once for every progress view. */
export const WIKI_ORGANIZE_STAGES: WikiProgress["stage"][] = ["name", "attach", "split", "same", "merge", "group", "plan"];

export function wikiProgressStep(stage: WikiProgress["stage"]): 0 | 1 | 2 {
  return stage === "extract" ? 0 : stage === "write" ? 2 : 1;
}

export function wikiStepTitle(step: 0 | 1 | 2, zh: boolean): string {
  return (zh ? ["读取对话并抽取知识点", "整理主题与目录", "按章节写作"] : ["Read conversations and extract knowledge", "Organize subjects and directory", "Write chapters"])[step];
}

/** "命名主题" for a part of organizing, with its place among the seven when asked. */
export function wikiStageName(stage: WikiProgress["stage"], zh: boolean, numbered = false): string {
  const names: Record<WikiProgress["stage"], [string, string]> = {
    extract: ["抽取知识点", "Extracting knowledge"], name: ["命名主题", "Naming subjects"], attach: ["归并小主题", "Attaching small subjects"], split: ["拆分大主题", "Splitting broad subjects"],
    same: ["合并同义主题", "Merging synonymous subjects"], merge: ["去重与关系", "Duplicates and relations"], group: ["解释组", "Explanation groups"], plan: ["规划目录", "Planning the directory"], write: ["写作章节", "Writing chapters"],
  };
  const name = names[stage][zh ? 0 : 1], part = WIKI_ORGANIZE_STAGES.indexOf(stage);
  return numbered && part >= 0 ? zh ? `整理 ${part + 1}/7 · ${name}` : `Organizing ${part + 1}/7 · ${name}` : name;
}

/** The count with its unit: batches while extracting, units while deduplicating and grouping, chapters while writing. */
export function wikiStageCount(progress: WikiProgress, zh: boolean): string {
  const unit = progress.stage === "extract" ? zh ? " 批" : " batches" : progress.stage === "merge" || progress.stage === "group" ? zh ? " 条" : " units" : progress.stage === "write" ? zh ? " 章" : " chapters" : "";
  return `${progress.done}/${progress.total}${unit}`;
}
