import { expect, it } from "vitest";
import { projectSession } from "../test/project-fixture";
import { projectChangeEvents } from "./project-changes";
it("retains both original messages when a decision changes without inventing a reason", () => {
  const previous = projectSession(), next = structuredClone(previous); next.id = "new-version"; next.createdAt = 1700000000000;
  next.evidence.push({ ...next.evidence[0], id: "e2", messageId: "later", excerpt: "改为先扩展功能" });
  next.projectState!.decisions[0] = { ...next.projectState!.decisions[0], text: "先扩展功能", quote: "改为先扩展功能", evidenceIds: ["e2"], reason: "" };
  const change = projectChangeEvents(previous, next).find(item => item.category === "decision")!;
  expect(change).toMatchObject({ kind: "changed", before: "先验证核心流程", after: "先扩展功能", reason: "", affectedSectionIds: ["one"] });
  expect(change.beforeSources[0].messageId).toBe("message"); expect(change.afterSources[0].messageId).toBe("later"); expect(change.acceptedAt).toBeUndefined();
  expect(previous.projectState!.decisions[0].text).toBe("先验证核心流程");
});
it("distinguishes invalid sources, conflicts, and resolved questions", () => {
  const previous = projectSession(); previous.projectState!.questions = [{ ...previous.projectState!.constraints[0], id: "question:scope", text: "发布范围？" }];
  const next = structuredClone(previous); next.projectState!.constraints = []; next.projectState!.decisions[0].status = "uncertain"; next.projectState!.questions![0].status = "superseded";
  const events = projectChangeEvents(previous, next);
  expect(events.find(item => item.category === "constraint")?.kind).toBe("source_changed");
  expect(events.find(item => item.category === "decision")?.kind).toBe("conflict");
  expect(events.find(item => item.category === "question")?.kind).toBe("resolved");
});
it("retains a removed relationship and its original source in history", () => {
  const previous = projectSession(), next = structuredClone(previous);
  next.projectState!.relations = [];
  const change = projectChangeEvents(previous, next).find(item => item.category === "relation")!;
  expect(change.kind).toBe("source_changed");
  expect(change.before).toContain("需求采集");
  expect(change.beforeQuote).toBe(previous.projectState!.relations[0].quote);
  expect(change.beforeSources[0].messageId).toBe("message");
  expect(change.after).toBeUndefined();
});
