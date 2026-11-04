import { expect, it } from "vitest";
import { validateProjectState } from "./project-state";
import { projectFixture, projectText, projectWire } from "../test/project-fixture";

const event = { id: "history:v01", title: "采购范围收敛", version: "V0.1", before: "完整采购闭环", after: "只生成缺件清单", reason: "", status: "documented", quote: "V0.1只生成缺件清单", evidenceIds: ["e1"], beforeQuote: "初版考虑完整采购闭环", beforeEvidenceIds: ["e1"], discussedAt: Date.now() };
const text = `${projectText}\n${event.quote}\n${event.beforeQuote}`;
it("derives history dates from original messages and validates both versions' quotations", () => {
  const date = Date.UTC(2026, 8, 14);
  const state = validateProjectState({ ...projectWire, history: [event] }, [{ id: "e1", text, discussedAt: date }], projectFixture);
  expect(state.history?.[0].discussedAt).toBe(date);
  expect(state.history?.[0].beforeEvidenceIds).toEqual(["e1"]);
  expect(() => validateProjectState({ ...projectWire, history: [{ ...event, beforeQuote: "无来源的旧方案" }] }, [{ id: "e1", text }], projectFixture)).toThrow("supplied evidence");
  expect(() => validateProjectState({ ...projectWire, history: [{ ...event, version: "V9.9" }] }, [{ id: "e1", text }], projectFixture)).toThrow("version");
});
it("does not use today's save date as a product date and requires selected evidence", () => {
  expect(validateProjectState({ ...projectWire, history: [event] }, [{ id: "e1", text }], projectFixture).history?.[0].discussedAt).toBeUndefined();
  expect(() => validateProjectState({ ...projectWire, history: [event] }, [{ id: "e1", text }], { ...projectFixture, scope: { kind: "goal", blocks: [] } })).toThrow("evidence");
});
