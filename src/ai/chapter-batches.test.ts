import { expect, it } from "vitest";
import { planLongConversation } from "./chapter-batches";
import type { AtlasAIProvider, StructuredAIRequest } from "./provider";

const item = { id: "repair-plan", title: "极点与稳定性" };
const snapshots = Array.from({ length: 30 }, (_, index) => ({ conversationId: item.id, questionId: `q${index}`, displayTitle: `系统问题 ${index}`, summary: "稳定性条件与内部模态", concepts: ["稳定性"], sourceHash: `${index}`, analysisVersion: 1, updatedAt: 1 }));
const chapter = (title: string, questionIds: string[]) => ({ title, summary: `${title}的讨论要点。`, questionIds });

it("repairs a plan that drops, repeats or reorders question IDs instead of failing the reader analysis", async () => {
  let calls = 0;
  const provider: AtlasAIProvider = { id: "test", modelId: "main", testConnection: async () => ({ ok: true, model: "main" }), generateStructured: async <T>(request: StructuredAIRequest<T>) => {
    calls++;
    const data = JSON.parse(request.prompt), ids = (data.questions as Array<{ id: string }>).map((question) => question.id);
    // q1 is missing, q3 is claimed twice, and the last two are swapped; eleven chapters exceed the limit.
    const broken = [chapter("开端", [ids[0], ids[2], ids[3]]), chapter("重复", [ids[3], ids[4]]), ...Array.from({ length: 9 }, (_, index) => chapter(`阶段${index}`, ids.slice(5 + index * 2, 7 + index * 2))), chapter("结尾", [ids.at(-1)!, ids.at(-2)!])];
    return request.validate({ chapters: broken, episodes: [], backbone: [], bridgeCandidates: [], freeCardCandidates: [] });
  } };
  const result = await planLongConversation({ conversation: item, snapshots, provider });
  expect(calls).toBeGreaterThan(0);
  // Every question survives once, in the original order, in at most nine contiguous chapters.
  expect(result.chapters.flatMap((entry) => entry.questionIds)).toEqual(snapshots.map((snapshot) => snapshot.questionId));
  expect(result.chapters.length).toBeLessThanOrEqual(9);
  expect(result.chapters[0]).toMatchObject({ title: "开端" });
  expect(result.chapters[0].questionIds.slice(0, 3)).toEqual(["q0", "q1", "q2"]);
});

it("still refuses a reply without any usable chapter", async () => {
  const provider: AtlasAIProvider = { id: "test", modelId: "main", testConnection: async () => ({ ok: true, model: "main" }), generateStructured: async <T>(request: StructuredAIRequest<T>) => request.validate({ chapters: [chapter("无关", ["unknown"])], episodes: [] }) };
  await expect(planLongConversation({ conversation: item, snapshots, provider })).rejects.toMatchObject({ code: "PROVIDER_SCHEMA_chapter_plan_empty" });
});
