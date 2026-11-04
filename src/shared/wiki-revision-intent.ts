/** Useful without prompt writing; custom requests remain optional. */
export function wikiRevisionInstruction(instruction:string,zh:boolean):string {
  return instruction.trim() || (zh
    ? "按实际内容理顺章节归属，合并重复说明，使用具体准确的标题；统一 AI 称呼，突出关键结论、决策和完整约束。保留技术条件、独立版本、原始来源和状态归属，不把建议写成已实现。"
    : "Reconcile topic ownership and repetition, use concrete accurate titles, unify AI narration and emphasize key conclusions, decisions and complete constraints. Preserve technical conditions, independent versions, original sources and attribution; proposals are not delivered features.");
}
