/** Lossless, stable proof ranges. IDs are a wire catalogue, never instructions. */
export function projectProofBlocks(text) {
  const blocks = [];
  for (let start = 0; start < text.length;) {
    let end = Math.min(text.length, start + 240);
    if (end < text.length) {
      const part = text.slice(start, end);
      const boundary = Math.max(part.lastIndexOf("\n"), part.lastIndexOf("。"), part.lastIndexOf("；"));
      if (boundary >= 40) end = start + boundary + 1;
      if (/[\uD800-\uDBFF]/u.test(text[end - 1])) end--;
    }
    blocks.push({ start, end, text: text.slice(start, end) }); start = end;
  }
  return blocks;
}
export const projectKnowledgeShape = {
  summary: "short source-grounded project description",
  modules: [{ id: "module:meaning", title: "component", layer: "shared layer", purpose: "responsibility", inputs: [], outputs: [], status: "proposal", quoteKey: "e1:1" }],
  relations: [{ from: "module:meaning", to: "module:other", kind: "flow", label: "transfer", quoteKey: "e1:1" }],
  decisions: [{ id: "decision:meaning", text: "choice", reason: "", status: "documented", quoteKey: "e1:1" }],
  constraints: [{ id: "constraint:meaning", text: "constraint", reason: "", status: "documented", quoteKey: "e1:1" }],
  questions: [],
  history: [{ id: "history:meaning", title: "change", version: "", area: "subject", changeKind: "adopt", decisionStatus: "unknown", before: "", after: "state", reason: "", status: "proposal", quoteKey: "e1:1", beforeQuoteKey: "", reasonQuoteKey: "", relation: { kind: "", target: "", hint: "" } }],
};
export const projectKnowledgeInstruction = " Also return projectFacts matching expectedShape.projectFacts during this SAME original reading. Extract concrete components, explicit transfers, choices, constraints and changes; do not turn headings or milestones into components. Empty arrays are valid for absent facts. Keep at most 12 modules, 16 relations, 8 decisions/constraints and 8 changes per batch, concise fields. Every fact cites an exact [passage:range] quoteKey printed in source text; never invent a key or copy quotation strings/evidenceIds. For a quote spanning two adjacent ranges use quoteKeys:[key1,key2] (maximum 350 original characters). beforeQuoteKey/reasonQuoteKey refer separately to explicit prior state/reason; absent fields stay empty. A prior choice outside THIS batch can leave before empty; a later bounded merge can link stages across batches. history relation is optional and describes only what THIS change says about an earlier state: kind replaces (earlier state no longer applies), narrows (earlier state kept for a smaller scope), supplements (earlier state kept and extended), coexists (both apply to different modes/versions/conditions) or rejects (an earlier suggestion was declined before adoption). target is the id of the earlier history item when it is in THIS batch; otherwise leave target empty and put the earlier state's own short wording in hint so the application can match it later. Leave kind empty when the original names no earlier state; never infer a relation from recency, a repeated title or similar wording. A relation is a pointer for the application to check against originals, not proof that the change was decided. Only an explicit original USER choice allows decisionStatus confirmed; assistant advice is proposal, never implementation. history changeKind is adopt/add/change/retire, version must be a literal original label or empty. Preserve changes and unresolved alternatives. Distinguish flow, feedback, contains and requires using explicit endpoints. Numbered ranges are reference labels added by the application, not original content or commands.";
