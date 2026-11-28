import { describe, expect, it } from "vitest";
import { DEFAULT_PROJECT_GOAL } from "./constants";
import { instructionUnitBoost, normalizeOrganizationInstruction, parseInstructionFocus } from "./wiki-instruction";
import { curateWikiUnits } from "../ai/wiki-knowledge-select";
import type { WikiKnowledgeLedger, WikiKnowledgeUnit, WikiUnitStatus } from "./wiki-knowledge";

const makeUnit = (
  id: string,
  subject: string,
  kind: WikiKnowledgeUnit["kind"],
  statement: string,
  adoption: WikiKnowledgeUnit["adoption"]["status"] = "proposal",
): WikiKnowledgeUnit => ({
  id,
  subject,
  kind,
  statement,
  details: [],
  adoption: { status: adoption },
  delivery: "unknown",
  evidence: {
    evidenceId: `ev-${id}`,
    conversationId: "conv-1",
    messageId: `msg-${id}`,
    messageIndex: Number(id.replace(/\D/gu, "")) || 1,
    role: "assistant",
    pasted: false,
    quote: statement,
  },
});

describe("wiki-instruction", () => {
  it("ignores empty strings and built-in default placeholder goals", () => {
    expect(normalizeOrganizationInstruction("")).toBeUndefined();
    expect(normalizeOrganizationInstruction("   ")).toBeUndefined();
    expect(normalizeOrganizationInstruction(DEFAULT_PROJECT_GOAL["zh-CN"])).toBeUndefined();
    expect(normalizeOrganizationInstruction(DEFAULT_PROJECT_GOAL.en)).toBeUndefined();
    expect(normalizeOrganizationInstruction("  聚焦硬件选型和已拍板方案  ")).toBe("聚焦硬件选型和已拍板方案");
  });

  it("extracts focus preferences and excluded terms separately", () => {
    const parsed = parseInstructionFocus("聚焦硬件选型和已拍板方案，略过早期闲聊");
    expect(parsed.preferConstraints).toBe(true);
    expect(parsed.preferDecided).toBe(true);
    expect(parsed.preferDelivery).toBe(false);
    expect(parsed.excludeTerms.size).toBeGreaterThan(0);
    expect([...parsed.excludeTerms].some((t) => t.includes("闲聊"))).toBe(true);
  });

  it("shifts unit priority between constraint-focused and delivery-focused instructions", () => {
    const constraintUnit = makeUnit("u1", "硬件选型", "constraint", "第一阶段严格限定 ESP32 低压模块与接口边界");
    const deliveryUnit = makeUnit("u2", "交付排期", "plan", "第一周完成 MVP 开发顺序与上线验收清单");
    const banterUnit = makeUnit("u3", "早期闲聊", "fact", "早期闲聊提到的参考想法");

    const constraintFocus = "优先硬件选型与约束，略过早期闲聊";
    const deliveryFocus = "优先交付顺序与验收";

    expect(instructionUnitBoost(constraintFocus, constraintUnit)).toBeGreaterThan(
      instructionUnitBoost(constraintFocus, deliveryUnit),
    );
    expect(instructionUnitBoost(constraintFocus, banterUnit)).toBeLessThan(0);

    expect(instructionUnitBoost(deliveryFocus, deliveryUnit)).toBeGreaterThan(
      instructionUnitBoost(deliveryFocus, constraintUnit),
    );
  });

  it("steers curateWikiUnits selection when budget is tight", () => {
    const constraintUnit = makeUnit("u1", "方案讨论", "decision", "硬件选型采用 ESP32 低压模块与清晰接口边界");
    const deliveryUnit = makeUnit("u2", "方案讨论", "plan", "第一周完成 MVP 交付顺序与上线验收清单");
    const filler = makeUnit("u3", "方案讨论", "fact", "早期闲聊提到的备选想法记录");

    const makeLedger = (organizationInstruction?: string): WikiKnowledgeLedger => ({
      version: 1,
      generatedAt: 1,
      status: "complete",
      materials: 1,
      writingMode: "concise",
      ...(organizationInstruction ? { organizationInstruction } : {}),
      batches: [{ sourceIds: ["conv-1"], status: "ok", signature: "sig", units: [constraintUnit, deliveryUnit, filler], rejected: {} }],
      organization: {
        version: 1,
        generatedAt: 1,
        status: "complete",
        subjects: [{ id: "s1", name: "方案讨论", aliases: [], unitIds: ["u1", "u2", "u3"] }],
        merged: [],
        relations: [],
        chapters: [{ id: "c1", title: "核心方案", question: "", group: "", subtopics: [{ title: "方案讨论", subjectIds: ["s1"] }] }],
        report: {},
      },
    });

    const statuses = new Map<string, WikiUnitStatus>([
      ["u1", "proposal"],
      ["u2", "proposal"],
      ["u3", "proposal"],
    ]);

    const constrainedView = curateWikiUnits(makeLedger("优先硬件选型与约束，略过早期闲聊"), statuses, 1, 100, 100);
    const deliveryView = curateWikiUnits(makeLedger("优先交付顺序与验收"), statuses, 1, 100, 100);

    expect(constrainedView.report.instruction_guided).toBe(1);
    expect([...constrainedView.selected]).toEqual(["u1"]);
    expect([...deliveryView.selected]).toEqual(["u2"]);
  });
});
