import { expect, it } from "vitest";
import { withWritingAnswer } from "../ai/wiki-writing-questions";
import { confirmedRoadmaps, unbundleWikiRoadmapList, withPinnedRoadmapChapters } from "./wiki-confirmed-roadmap";
import type { WikiDraftChapter, WikiKnowledgeLedger, WikiKnowledgeUnit, WikiWritingQuestion } from "./wiki-knowledge";

it("freezes the selected Phase order and publishes only stage details from that proposal", () => {
  const proposal = (id: string, messageId: string, statement: string, quote: string): WikiKnowledgeUnit => ({
    id, subject: "交付路线图", kind: "plan", statement, details: [], delivery: "planned",
    evidence: { evidenceId: id, conversationId: "c", messageId, messageIndex: 1, role: "assistant", pasted: false, quote },
    adoption: { status: "proposal" },
  });
  const order = proposal("order", "chosen", "严格按 Phase 1-7 顺序开发。", "严格按 Phase 1–7 顺序开发。\n## Phase 1 — Foundation");
  const stage = proposal("stage", "chosen", "Phase 2 交付硬件领域模型。", "## Phase 2 — Hardware Domain");
  const other = proposal("other", "older", "Phase 5 优先识别零件。", "## Phase 5 — Visual Inventory");
  const chapter = { id: "delivery", title: "交付计划", question: "", group: "", subtopics: [{ title: "迭代路线图", subjectIds: ["s"] }] };
  const ledger: WikiKnowledgeLedger = {
    version: 1, generatedAt: 1, status: "complete", materials: 2,
    batches: [{ sourceIds: ["chosen", "older"], status: "ok", units: [order, stage, other], rejected: {} }],
    organization: { version: 1, generatedAt: 1, status: "complete", chapters: [chapter],
      subjects: [{ id: "s", name: "路线图", unitIds: ["order", "stage", "other"], aliases: [] }], merged: [], relations: [], report: {} },
  };
  const question: WikiWritingQuestion = {
    id: "q", about: "实施顺序", ask: "按 M1-M7 里程碑还是 Phase 1-7 顺序开发？", unitIds: ["order", "other"], organization: 1,
    options: [{ id: "phase", label: "按 Phase 1-7 阶段顺序开发", actions: [{do: "confirm", units: ["order"]}] }],
  };
  const answered = withWritingAnswer(ledger, question, "phase");
  const saved = answered.userAnswers?.[0].roadmap;
  expect(saved?.order).toEqual(["Phase 1", "Phase 2", "Phase 3", "Phase 4", "Phase 5", "Phase 6", "Phase 7"]);
  expect(saved?.stages).toEqual([
    { label: "Phase 1", title: "Foundation", unitId: "order" },
    { label: "Phase 2", title: "Hardware Domain", unitId: "stage" },
  ]);
  const wrong: WikiDraftChapter = { ...chapter, body: "### 迭代路线图\n\n5. **Phase 5**：实施拍照识别零件功能。", problems: [],
    paragraphs: [{ subtopic: "迭代路线图", text: "5. **Phase 5**：实施拍照识别零件功能。", unitIds: ["other"] }] };
  const [pinned] = withPinnedRoadmapChapters([wrong], answered, true);
  expect(pinned.body).toContain("按 Phase 1–7 的阶段顺序推进。");
  expect(pinned.body).toContain("| 阶段 | 交付主题 |");
  expect(pinned.body).toContain("| Phase 2 | Hardware Domain |");
  expect(pinned.body).not.toContain("| Phase 3 |");
  expect(pinned.body.split("### 交付路线图")[1]).not.toContain("拍照识别");
  expect(pinned.body).toContain("其他阶段提案。\n\n5. **Phase 5**：实施拍照识别零件功能。");
  expect(withPinnedRoadmapChapters([pinned], answered, true)[0]).toEqual(pinned);
  expect(confirmedRoadmaps(withWritingAnswer(answered, question, undefined))).toEqual([]);
});

it("retains an order-only legacy confirmation without inventing stage content", () => {
  const order: WikiKnowledgeUnit = {
    id: "legacy", subject: "交付", kind: "plan", statement: "严格按 Phase 1-7 顺序开发。",
    details: [], delivery: "planned", adoption: { status: "proposal" },
    evidence: { evidenceId: "proof", conversationId: "c", messageId: "m", messageIndex: 1, role: "assistant", pasted: false, quote: "严格按 Phase 1-7 顺序开发。" },
  };
  const ledger: WikiKnowledgeLedger = {
    version: 1, generatedAt: 1, status: "complete", materials: 1,
    batches: [{ sourceIds: ["proof"], status: "ok", units: [order], rejected: {} }],
    userAnswers: [{ questionId: "q", unitIds: ["legacy"], question: "选择哪套路线路线图？", answer: "按 Phase 1–7 顺序开发", at: 1 }],
  };
  expect(confirmedRoadmaps(ledger)[0]?.plan.stages).toEqual([]);
  order.statement = "严格按 Phase 1–7 顺序开发：Foundation -> Domain -> Canvas -> Product UI -> AI -> Editing -> Code/Wiring。";
  expect(confirmedRoadmaps(ledger)[0]?.plan.stages).toEqual([]);
  ledger.decisions = { legacy: { verdict: "confirmed", at: 1 } };
  expect(confirmedRoadmaps(ledger)[0]?.plan.stages.map(stage => stage.title)).toEqual(["Foundation", "Domain", "Canvas", "Product UI", "AI", "Editing", "Code/Wiring"]);
});

it("removes duplicate stages while preserving independently cited release requirements",()=>{
  const plan={proposalId:"one",order:["Phase 1","Phase 2"],unitId:"roadmap",stages:[
    {label:"Phase 1",title:"Foundation",unitId:"roadmap"},{label:"Phase 2",title:"Preview",unitId:"roadmap"},
  ]};
  const a="搭建 Next.js 骨架。", b="加入预览。", scope="移动端第一版仅支持查看。";
  const mixed={subtopic:"版本安排",text:`1. **Phase 1**：${a}\n2. **Phase 2: Preview**：${b}${scope}`,unitIds:["roadmap","mobile"],
    claims:[{text:a,unitIds:["roadmap"]},{text:b+scope,unitIds:["roadmap","mobile"]}]};
  expect(unbundleWikiRoadmapList(mixed,plan)).toEqual([
    {text:scope,subtopic:"版本安排",unitIds:["mobile"],claims:[{text:scope,unitIds:["mobile"]}]},
  ]);
  expect(unbundleWikiRoadmapList({...mixed,text:mixed.text.replace("Phase 2: Preview","Milestone 2")},plan)).toBeUndefined();
});
