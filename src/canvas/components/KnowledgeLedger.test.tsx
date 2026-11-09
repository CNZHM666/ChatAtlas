import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { KnowledgeLedger } from "./KnowledgeLedger";
import { projectSession } from "../../test/project-fixture";
import type { WikiKnowledgeUnit } from "../../shared/wiki-knowledge";

afterEach(cleanup);
const unit = (index: number, statement: string, extra: Partial<Pick<WikiKnowledgeUnit, "kind" | "delivery">> & { role?: "user" | "assistant"; adoption?: WikiKnowledgeUnit["adoption"]["status"] } = {}): WikiKnowledgeUnit =>
  ({ id: `unit:${index}`, subject: "检索", statement, kind: extra.kind ?? "mechanism", details: [], evidence: { evidenceId: `e${index}`, conversationId: "c", messageId: `m${index}`, messageIndex: index, role: extra.role ?? "assistant", pasted: false, quote: statement }, adoption: { status: extra.adoption ?? "proposal" }, delivery: extra.delivery ?? "unknown" });

it("counts only the user's own decisions as theirs, shows plans the AI later replaced as earlier, and hides empty filters", () => {
  const units = [
    unit(1, "我们只做 Chrome 版本。", { kind: "decision", role: "user", adoption: "user_decision" }),
    unit(2, "导入已经可以用了。", { kind: "report", role: "user", delivery: "user_reported" }),
    unit(3, "M1 全文检索，M2 混合检索。", { kind: "plan" }),
    unit(4, "M1 消息定位，M2 项目重建。", { kind: "plan" }),
    unit(5, "索引放在内存里。"), unit(6, "索引改放 IndexedDB。"),
  ];
  const session = projectSession();
  session.wikiKnowledge = { version: 1, generatedAt: 0, status: "complete", materials: units.length, batches: [{ sourceIds: [], status: "ok", units, rejected: {} }],
    organization: { version: 1, generatedAt: 0, status: "complete", subjects: [{ id: "s", name: "检索", aliases: [], unitIds: units.map(item => item.id) }], merged: [],
      relations: [{ older: "unit:5", newer: "unit:6", kind: "replaces", status: "unresolved" }], report: {}, chapters: [{ id: "ch", title: "检索", question: "?", group: "", subtopics: [{ title: "路线", subjectIds: ["s"] }] }] } };
  render(<KnowledgeLedger session={session} zh onLocate={vi.fn()} />);
  expect(screen.getByRole("tab", { name: /你的决定/u })).toHaveTextContent("你的决定1");
  expect(screen.getByRole("tab", { name: /你的决定/u }).title).toMatch(/你亲口做的选择/u);
  expect(screen.getByRole("tab", { name: /你的资料与看法/u })).toHaveTextContent("1");
  // The older roadmap and the store the AI replaced are earlier plans; nothing is open, so that filter is hidden.
  expect(screen.getByRole("tab", { name: /早期方案/u })).toHaveTextContent("早期方案2");
  expect(screen.queryByRole("tab", { name: /仍在讨论/u })).toBeNull();
  expect(screen.getAllByText("早先方案")).toHaveLength(2);
});

it("opens each point at its own words, so a second point of the same message moves the open panel", () => {
  const units = [unit(1, "索引放在内存里。"), { ...unit(2, "索引改放 IndexedDB。"), evidence: { ...unit(2, "").evidence, messageId: "m1", quote: "索引改放 IndexedDB。" } }];
  const session = projectSession();
  session.wikiKnowledge = { version: 1, generatedAt: 0, status: "complete", materials: 2, batches: [{ sourceIds: [], status: "ok", units, rejected: {} }],
    organization: { version: 1, generatedAt: 0, status: "complete", subjects: [{ id: "s", name: "检索", aliases: [], unitIds: units.map(item => item.id) }], merged: [], relations: [], report: {}, chapters: [{ id: "ch", title: "检索", question: "?", group: "", subtopics: [{ title: "存储", subjectIds: ["s"] }] }] } };
  const onLocate = vi.fn();
  render(<KnowledgeLedger session={session} zh onLocate={onLocate} />);
  fireEvent.click(screen.getByText("检索", { selector: "strong" }));
  fireEvent.click(screen.getByText("索引放在内存里。"));
  fireEvent.click(screen.getByText("索引改放 IndexedDB。"));
  expect(onLocate.mock.calls.map(call => call[1].quote)).toEqual(["索引放在内存里。", "索引改放 IndexedDB。"]);
  expect(onLocate.mock.calls[1][1]).toMatchObject({ claim: "索引改放 IndexedDB。", mode: "view" });
});
