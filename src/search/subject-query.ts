/** Retrieval vocabulary only. Equivalence here never confirms or replaces a project fact. */
export const defaultSubjectAliases = [
  ["结构化执行器", "确定性执行器", "deterministic executor"], ["画布", "canvas"],
  ["索引持久化", "保存搜索索引", "index persistence"], ["暂缓开发", "延期", "postponed", "先不做"],
  ["视觉识别", "拍照识别", "拍照辨识", "visual recognition", "photo recognition"],
  ["实时采购比价", "自动采购", "采购比价", "price comparison"],
  ["上下文收藏", "context collection", "context bundle"],
];
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
const pattern = (name: string) => new RegExp(`${/^[a-z0-9]/iu.test(name) ? "(?<![a-z0-9_$])" : ""}${escape(name)}${/[a-z0-9]$/iu.test(name) ? "(?![a-z0-9_$])" : ""}`, "giu");

/** Bounded alternatives preserve identifiers and exact quoted searches. */
export function subjectQueryVariants(input: string, groups: string[][] = [], limit = 8): string[] {
  if (/["“]/u.test(input)) return [input];
  const variants = new Set([input]);
  for (const group of [...groups, ...defaultSubjectAliases]) {
    const name = [...group].sort((a, b) => b.length - a.length).find(name => pattern(name).test(input));
    if (!name) continue;
    for (const alias of group) {
      if (variants.size >= limit) break;
      variants.add(input.replace(pattern(name), alias));
    }
  }
  return [...variants];
}
