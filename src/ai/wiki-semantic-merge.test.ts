import "fake-indexeddb/auto";
import { expect, it } from "vitest";
import { placeByContent, semanticClusters, unitVectors, vectorSimilarity } from "./wiki-semantic-merge";
import type { EmbeddingProvider } from "./embedding-provider";
import type { WikiKnowledgeUnit } from "../shared/wiki-knowledge";

const unit = (id: number, statement: string): WikiKnowledgeUnit => ({ id: `unit:${id}`, subject: "s", statement, kind: "decision", details: [], evidence: { evidenceId: `e:${id}`, conversationId: "c", messageId: `m${id}`, messageIndex: id, role: "assistant", pasted: false, quote: statement }, adoption: { status: "proposal" }, delivery: "unknown" });
/** A fake model: each statement's vector is given, so similarity is what the test says it is. */
const provider = (table: Record<string, number[]>, fail = false): EmbeddingProvider => ({ modelKey: "fake", embedText: async text => table[text], embedBatch: async texts => { if (fail) throw new Error("down"); return texts.map(text => table[text]); } });

it("groups statements whose vectors are close, closest first, and keeps different points apart", async () => {
  const units = [unit(1, "定位为跨 AI 的项目知识工作区"), unit(2, "做帮助长期 AI 项目跨平台延续工作的工具"), unit(3, "索引按消息建立"), unit(4, "首页保持浅色极简")];
  const report: Record<string, number> = {};
  const vectors = (await unitVectors(units, provider({ [units[0].statement]: [1, 0, 0], [units[1].statement]: [.95, .31, 0], [units[2].statement]: [0, 1, 0], [units[3].statement]: [0, .2, .98] }), new AbortController().signal, report))!;
  expect(semanticClusters(units, vectors, () => true)).toEqual([["unit:1", "unit:2"]]);
  expect(vectorSimilarity(vectors)("unit:1", "unit:2")).toBeCloseTo(.95, 2);
  // A pair the caller rules out (about different things) never joins.
  expect(semanticClusters(units, vectors, () => false)).toEqual([]);
  expect(report).toMatchObject({ semantic_requests: 1, semantic_units: 4 });
});

it("gives no vectors when the provider fails, so the organizer recalls by words", async () => {
  const report: Record<string, number> = {};
  expect(await unitVectors([unit(1, "甲")], provider({}, true), new AbortController().signal, report)).toBeUndefined();
  expect(report.semantic_failed).toBe(1);
});

it("moves a subject to the chapter its statements are clearly closer to, never emptying a chapter or subtopic", () => {
  const vectors = new Map([["u1", [1, 0, 0]], ["u2", [.98, .2, 0]], ["u3", [0, 1, 0]], ["u4", [0, .98, .2]], ["u5", [.97, .24, 0]], ["u6", [0, 0, 1]]].map(([id, values]) => [id as string, Float32Array.from(values as number[])]));
  // s5 talks like the competitor chapter but was planned under architecture; s6 is alone in its chapter.
  const subjects = [{ id: "s1", unitIds: ["u1"] }, { id: "s2", unitIds: ["u2"] }, { id: "s3", unitIds: ["u3"] }, { id: "s4", unitIds: ["u4"] }, { id: "s5", unitIds: ["u5"] }, { id: "s6", unitIds: ["u6"] }];
  const chapters = [
    { title: "竞品", subtopics: [{ title: "直接竞品", subjectIds: ["s1", "s2"] }] },
    { title: "技术架构", subtopics: [{ title: "存储", subjectIds: ["s3", "s4"] }, { title: "杂项", subjectIds: ["s5"] }] },
    { title: "相关项目", subtopics: [{ title: "AI Circuit Studio", subjectIds: ["s6"] }] },
  ];
  expect(placeByContent(chapters, subjects, vectors)).toBe(1);
  expect(chapters[0].subtopics[0].subjectIds).toEqual(["s1", "s2", "s5"]);
  // Its emptied subtopic goes; the lone related-project chapter keeps its subject.
  expect(chapters[1].subtopics.map(topic => topic.title)).toEqual(["存储"]);
  expect(chapters[2].subtopics[0].subjectIds).toEqual(["s6"]);
});

it("keeps statement vectors between runs, so a regenerated Wiki embeds only statements it has not seen", async () => {
  const kept = unit(7, "首页只保留一个主按钮"), added = unit(8, "复盘控制在三十秒内");
  await unitVectors([kept], provider({ [kept.statement]: [0, 1, 0] }), new AbortController().signal, {});
  const report: Record<string, number> = {}, asked: string[] = [];
  const counting: EmbeddingProvider = { modelKey: "fake", embedText: async () => [0], embedBatch: async texts => { asked.push(...texts); return texts.map(() => [1, 0, 0]); } };
  const vectors = (await unitVectors([kept, added], counting, new AbortController().signal, report))!;
  expect(asked).toEqual([added.statement]);
  expect(vectors.get(kept.id)?.[1]).toBeCloseTo(1);
  expect(report).toMatchObject({ semantic_reused: 1, semantic_requests: 1, semantic_units: 2 });
});
