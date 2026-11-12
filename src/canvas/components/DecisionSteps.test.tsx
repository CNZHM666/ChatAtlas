import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { KeyDecisions } from "./KeyDecisions";
import { DecisionSteps } from "./DecisionSteps";
import type { WikiKnowledgeLedger, WikiKnowledgeUnit } from "../../shared/wiki-knowledge";

afterEach(cleanup);

it("asks which version holds now before the key decisions, and applies the answer to the ledger", async () => {
  const unit = (index: number, statement: string): WikiKnowledgeUnit => ({ id: `u${index}`, subject: "存储", statement, kind: "mechanism", details: [], evidence: { evidenceId: `e${index}`, conversationId: "c", messageId: `m${index}`, messageIndex: index, role: "assistant", pasted: false, quote: statement }, adoption: { status: "proposal" }, delivery: "unknown" });
  const units = [unit(1, "索引放在内存里。"), unit(2, "索引改放 IndexedDB。")];
  const ledger = { version: 1, generatedAt: 1, status: "complete", materials: 2, batches: [{ sourceIds: [], status: "ok", units, rejected: {} }],
    organization: { version: 1, generatedAt: 1, status: "complete", subjects: [{ id: "s", name: "存储", aliases: [], unitIds: ["u1", "u2"] }], merged: [], report: {},
      relations: [{ older: "u1", newer: "u2", kind: "replaces", status: "unresolved" }], chapters: [{ id: "a", title: "技术架构", question: "?", group: "", subtopics: [{ title: "存储", subjectIds: ["s"] }] }] } } as WikiKnowledgeLedger;
  let saved = ledger;
  const onLedger = vi.fn((change: (value: WikiKnowledgeLedger) => WikiKnowledgeLedger) => { saved = change(saved); });
  render(<KeyDecisions ledger={ledger} zh onDecide={vi.fn()} onLedger={onLedger} />);
  expect(screen.getByText("「存储」先后有两种说法，现在用哪个？")).toBeVisible();
  fireEvent.click(screen.getByRole("radio", { name: /后来\s*索引改放 IndexedDB/u }));
  expect(screen.getByRole("radio", { name: /后来\s*索引改放 IndexedDB/u })).toHaveAttribute("aria-checked", "true");
  expect(saved.decisions).toMatchObject({ u2: { verdict: "confirmed" }, u1: { verdict: "rejected" } });
  expect(screen.getByRole("radio", { name: "两个都要" })).toBeVisible();
  expect(screen.getByRole("radio", { name: "还没定" })).toBeVisible();
});

it("asks the writer's questions one at a time, moves on after an answer, and starts writing from the last", () => {
  const unit = (index: number, statement: string): WikiKnowledgeUnit => ({ id: `u${index}`, subject: "存储", statement, kind: "decision", details: [], evidence: { evidenceId: `e${index}`, conversationId: "c", messageId: `m${index}`, messageIndex: index, role: "assistant", pasted: false, quote: statement }, adoption: { status: "proposal" }, delivery: "unknown" });
  const units = [unit(1, "索引放在内存里。"), unit(2, "索引改放 IndexedDB。"), unit(3, "第一版使用 MIT 许可证开源。")];
  const ledger = { version: 1, generatedAt: 1, status: "complete", materials: 3, batches: [{ sourceIds: [], status: "ok", units, rejected: {} }],
    organization: { version: 1, generatedAt: 3, status: "complete", subjects: [{ id: "s", name: "存储", aliases: [], unitIds: ["u1", "u2", "u3"] }], merged: [], report: {},
      relations: [{ older: "u1", newer: "u2", kind: "replaces", status: "unresolved" }], chapters: [{ id: "a", title: "技术架构", question: "?", group: "", subtopics: [{ title: "存储", subjectIds: ["s"] }] }] },
    writingQuestions: [
      { id: "ask:3:1", about: "索引位置", ask: "索引放内存还是 IndexedDB？", unitIds: ["u1", "u2"], organization: 3, options: [{ id: "o1", label: "放 IndexedDB", actions: [{ do: "confirm", units: ["u2"] }, { do: "reject", units: ["u1"] }] }, { id: "o2", label: "还没定", actions: [{ do: "open", units: ["u1", "u2"] }] }] },
      { id: "ask:3:2", about: "开源许可", ask: "第一版用 MIT 开源吗？", unitIds: ["u3"], organization: 3, options: [{ id: "o1", label: "用 MIT", actions: [{ do: "confirm", units: ["u3"] }] }, { id: "o2", label: "还不开源", actions: [{ do: "reject", units: ["u3"] }] }] },
      // Asked of an earlier organization: not asked now.
      { id: "ask:1:1", about: "旧问题", ask: "？", unitIds: ["u1"], organization: 1, options: [{ id: "o1", label: "a", actions: [] }, { id: "o2", label: "b", actions: [] }] },
    ] } as WikiKnowledgeLedger;
  let saved = ledger;
  const onDone = vi.fn();
  render(<DecisionSteps ledger={ledger} zh onChange={change => { saved = change(saved); }} onDone={onDone} />);
  expect(screen.getByText("1 / 2")).toBeVisible();expect(screen.getByRole("button", { name: "全部跳过" })).toBeVisible();
  fireEvent.click(screen.getByRole("radio", { name: /放 IndexedDB/u }));
  expect(screen.getByText("2 / 2")).toBeVisible();expect(screen.getByText("第一版用 MIT 开源吗？")).toBeVisible();
  expect(saved.decisions).toMatchObject({ u2: { verdict: "confirmed" }, u1: { verdict: "rejected" } });
  fireEvent.click(screen.getByRole("radio", { name: /用 MIT/u }));
  expect(saved.decisions).toMatchObject({ u3: { verdict: "confirmed" } });
  expect(screen.getByRole("button", { name: "直接写作" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "上一题" }));
  expect(screen.getByRole("radio", { name: /放 IndexedDB/u })).toHaveAttribute("aria-checked", "true");
  fireEvent.click(screen.getByRole("button", { name: "跳过此题" }));
  fireEvent.click(screen.getByRole("button", { name: "开始写作" }));
  expect(onDone).toHaveBeenCalled();
});

it("asks the writer's own questions first, and takes an answer in the user's own words", () => {
  const unit = (index: number, statement: string): WikiKnowledgeUnit => ({ id: `u${index}`, subject: "密钥", statement, kind: "constraint", details: [], evidence: { evidenceId: `e${index}`, conversationId: "c", messageId: `m${index}`, messageIndex: index, role: "assistant", pasted: false, quote: statement }, adoption: { status: "proposal" }, delivery: "unknown" });
  const units = [unit(1, "可选存 localStorage。"), unit(2, "禁止写入 localStorage。")];
  const ledger = { version: 1, generatedAt: 1, status: "complete", materials: 2, batches: [{ sourceIds: [], status: "ok", units, rejected: {} }],
    organization: { version: 1, generatedAt: 5, status: "complete", subjects: [{ id: "s", name: "密钥", aliases: [], unitIds: ["u1", "u2"] }], merged: [], report: {},
      relations: [{ older: "u1", newer: "u2", kind: "replaces", status: "unresolved" }], chapters: [{ id: "a", title: "安全", question: "?", group: "", subtopics: [{ title: "密钥", subjectIds: ["s"] }] }] },
    writingQuestions: [{ id: "ask:5:1", about: "API Key 存储", ask: "允许存 localStorage 吗？", unitIds: ["u1", "u2"], organization: 5,
      options: [{ id: "o1", label: "一律禁止", actions: [{ do: "confirm", units: ["u2"] }, { do: "reject", units: ["u1"] }] }, { id: "o2", label: "可选保存", actions: [{ do: "confirm", units: ["u1"] }] }] }] } as WikiKnowledgeLedger;
  let saved = ledger;
  render(<DecisionSteps ledger={ledger} zh onChange={change => { saved = change(saved); }} onDone={vi.fn()} />);
  // Only the writer's question: no fixed version question about the same points.
  expect(screen.getByText("1 / 1")).toBeVisible();
  expect(screen.getByText("API Key 存储")).toBeVisible();expect(screen.getByText("允许存 localStorage 吗？")).toBeVisible();
  expect(screen.getByText("禁止写入 localStorage。")).toBeVisible();
  fireEvent.change(screen.getByRole("textbox", { name: "用自己的话回答" }), { target: { value: "会话内可记住，跨会话不保存" } });
  fireEvent.click(screen.getByRole("button", { name: "确定" }));
  expect(saved.userAnswers?.[0]).toMatchObject({ unitIds: ["u1", "u2"], answer: "会话内可记住，跨会话不保存" });
  fireEvent.click(screen.getByRole("radio", { name: /一律禁止/u }));
  expect(saved.decisions).toMatchObject({ u2: { verdict: "confirmed" }, u1: { verdict: "rejected" } });
  expect(saved.userAnswers).toHaveLength(1);
});

it("first lists the other products and projects named, to tick those left out, with no model", () => {
  const unit = (index: number, statement: string, about?: WikiKnowledgeUnit["about"]): WikiKnowledgeUnit => ({ id: `u${index}`, subject: "s", statement, kind: "fact", details: [], evidence: { evidenceId: `e${index}`, conversationId: "c", messageId: `m${index}`, messageIndex: index, role: "assistant", pasted: false, quote: statement }, adoption: { status: "proposal" }, delivery: "unknown", ...(about ? { about } : {}) });
  const units = [unit(1, "ChatAtlas 生成的综述混入了旧建议。", { name: "ChatAtlas", role: "other_project" }), unit(2, "Boardly 面向专业工程师。", { name: "Boardly", role: "competitor" }), unit(3, "Hardware IR 是唯一事实源。")];
  const ledger = { version: 1, generatedAt: 1, status: "complete", materials: 3, batches: [{ sourceIds: [], status: "ok", units, rejected: {} }],
    organization: { version: 1, generatedAt: 2, status: "complete", subjects: [{ id: "s", name: "s", aliases: [], unitIds: ["u1", "u2", "u3"] }], merged: [], report: {}, relations: [], chapters: [{ id: "a", title: "技术", question: "?", group: "", subtopics: [{ title: "s", subjectIds: ["s"] }] }] } } as WikiKnowledgeLedger;
  let saved = ledger;
  render(<DecisionSteps ledger={ledger} zh onChange={change => { saved = change(saved); }} onDone={vi.fn()} />);
  expect(screen.getByText("排除项目")).toBeVisible();
  expect(screen.getByRole("checkbox", { name: /ChatAtlas.*另一个项目/u })).toHaveAttribute("aria-checked", "false");
  expect(screen.getByRole("checkbox", { name: /Boardly.*竞品/u })).toBeVisible();
  fireEvent.click(screen.getByRole("checkbox", { name: /ChatAtlas/u }));
  expect(screen.getByRole("checkbox", { name: /ChatAtlas/u })).toHaveAttribute("aria-checked", "true");
  expect(saved.scopeAnswers).toEqual({ chatatlas: "exclude" });
  fireEvent.change(screen.getByRole("textbox", { name: "输入要排除的名字" }), { target: { value: "灵犀造物" } });
  fireEvent.click(screen.getByRole("button", { name: "排除" }));
  expect(saved.scopeAnswers).toEqual({ chatatlas: "exclude", "灵犀造物": "exclude" });
  expect(screen.getByRole("checkbox", { name: /灵犀造物/u })).toHaveAttribute("aria-checked", "true");
  fireEvent.click(screen.getByRole("checkbox", { name: /ChatAtlas/u }));
  expect(saved.scopeAnswers).toEqual({ "灵犀造物": "exclude" });
});

it("shows the writer's questions as they come while writing, and says writing goes on", () => {
  const unit = (index: number, statement: string): WikiKnowledgeUnit => ({ id: `u${index}`, subject: "s", statement, kind: "constraint", details: [], evidence: { evidenceId: `e${index}`, conversationId: "c", messageId: `m${index}`, messageIndex: index, role: "assistant", pasted: false, quote: statement }, adoption: { status: "proposal" }, delivery: "unknown" });
  const units = [unit(1, "开发按 7 个 Phase 推进。"), unit(2, "开发按 7 个里程碑推进。")];
  const ledger = { version: 1, generatedAt: 1, status: "complete", materials: 2, batches: [{ sourceIds: [], status: "ok", units, rejected: {} }],
    organization: { version: 1, generatedAt: 4, status: "complete", subjects: [{ id: "s", name: "s", aliases: [], unitIds: ["u1", "u2"] }], merged: [], report: {}, relations: [], chapters: [{ id: "a", title: "计划", question: "?", group: "", subtopics: [{ title: "s", subjectIds: ["s"] }] }] } } as WikiKnowledgeLedger;
  const ask = (id: string, about: string) => ({ id, about, ask: `${about}按哪一套？`, unitIds: ["u1", "u2"], organization: 4, stage: "writing" as const, options: [{ id: "o1", label: "Phase", actions: [{ do: "confirm" as const, units: ["u1"] }] }, { id: "o2", label: "里程碑", actions: [{ do: "confirm" as const, units: ["u2"] }] }] });
  let saved = ledger;
  const onDone = vi.fn();
  const view = render(<DecisionSteps ledger={ledger} zh writing busy questions={[ask("w1", "开发路线")]} onChange={change => { saved = change(saved); }} onDone={onDone} />);
  expect(screen.getByText("写作中发现")).toBeVisible();expect(screen.queryByText("排除项目")).toBeNull();
  expect(screen.getByRole("button", { name: "答完了，继续写" })).toBeVisible();
  // Another question comes while the first is open: it joins the list.
  view.rerender(<DecisionSteps ledger={ledger} zh writing busy questions={[ask("w1", "开发路线"), ask("w2", "里程碑数量")]} onChange={change => { saved = change(saved); }} onDone={onDone} />);
  expect(screen.getByText("1 / 2")).toBeVisible();
  fireEvent.click(screen.getByRole("radio", { name: /Phase/u }));
  expect(saved.userAnswers?.[0]).toMatchObject({ questionId: "w1", answer: "Phase" });
  expect(saved.decisions?.u1).toBeUndefined();
  expect(screen.getByText("2 / 2")).toBeVisible();
});
