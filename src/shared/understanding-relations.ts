export const understandingRelationLabels = {
  contains: ["包含", "Contains"],
  requires: ["是前提", "Prerequisite"],
  flow: ["输出给", "Output to"],
  feedback: ["反馈至", "Feedback to"],
  example: ["举例", "Example"],
  comparison: ["比较", "Comparison"],
} as const;

export type UnderstandingRelationKind = keyof typeof understandingRelationLabels;
export const understandingRelationKinds: UnderstandingRelationKind[] = ["contains", "requires", "flow", "feedback", "example", "comparison"];

export function understandingEdgeLabel(kind: UnderstandingRelationKind, zh: boolean): string {
  return understandingRelationLabels[kind][zh ? 0 : 1];
}
