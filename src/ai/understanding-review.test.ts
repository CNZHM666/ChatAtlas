import { expect, it, vi } from "vitest";
import type { SemanticStructure } from "../shared/focus-session";
import type { AtlasAI } from "./atlas-ai";
import { reviewUnderstanding } from "./understanding-review";
import { validateSemanticStructure } from "../shared/semantic-structure";

const graph: SemanticStructure = { nodes: [
  { key: "ir", title: "Hardware IR", description: "保存硬件方案", inputs: ["方案"], outputs: ["结构化方案"], quote: "Hardware IR 保存方案，BYOK 用于密钥隔离。", evidenceIds: ["p1"], status: "discussed" },
  { key: "key", title: "BYOK", description: "用户自带密钥", quote: "Hardware IR 保存方案，BYOK 用于密钥隔离。", evidenceIds: ["p1"], status: "proposal" },
], relations: [{ from: "ir", to: "key", kind: "flow", label: "传递方案", quote: "Hardware IR 保存方案，BYOK 用于密钥隔离。", evidenceIds: ["p1"], status: "supported" }] };
const sources = [{ id: "p1", text: graph.nodes[0].quote, role: "assistant" }];
const ai = (verdicts: string[]) => ({ modelId: "fixture", synthesize: vi.fn(async request => {
  const data = JSON.parse(request.prompt);
  return request.validate({ checks: data.facts.map((fact: { id: string }, i: number) => ({ id: fact.id, verdict: verdicts[i] })) });
}) }) as unknown as AtlasAI;

it("rejects a fabricated pipeline even when the quotation is literally present", async () => {
  expect(validateSemanticStructure(graph, sources)?.relations).toHaveLength(1);
  const result = await reviewUnderstanding(graph, sources, ai(["supported", "supported", "unsupported"]), ["c"]);
  expect(result.relations).toEqual([]);
  expect(result.nodes[1].status).toBe("proposal");
});

it("retains source text but removes unsupported interface claims and suppresses dependent arrows", async () => {
  const result = await reviewUnderstanding(graph, sources, ai(["unsupported", "supported", "supported"]), ["c"]);
  expect(result.nodes[0]).toMatchObject({ description: graph.nodes[0].quote, status: "uncertain" });
  expect(result.nodes[0].outputs).toBeUndefined();
  expect(result.relations[0].status).toBe("uncertain");
});

it("never promotes secondary quotations into supported relationships", async () => {
  const result = await reviewUnderstanding(graph, sources.map(source => ({ ...source, secondary: true })), ai(["supported", "supported", "supported"]), ["c"]);
  expect(result.relations[0].status).toBe("uncertain");
});

it("fails a missing or foreign verdict instead of treating an incomplete review as approval", async () => {
  const client = { modelId: "fixture", synthesize: vi.fn(async request => request.validate({ checks: [{ id: "other", verdict: "supported" }] })) } as unknown as AtlasAI;
  await expect(reviewUnderstanding(graph, sources, client, ["c"])).rejects.toThrow("Incomplete structure review");
});

it("preserves bounded module interfaces and concise transfer labels through schema validation", () => {
  const result = validateSemanticStructure(graph, sources)!;
  expect(result.nodes[0].outputs).toEqual(["结构化方案"]);
  expect(result.relations[0].label).toBe("传递方案");
  expect(validateSemanticStructure({ ...graph, nodes: [{ ...graph.nodes[0], inputs: [null] }, graph.nodes[1]] }, sources)?.nodes[0].inputs).toBeUndefined();
});
