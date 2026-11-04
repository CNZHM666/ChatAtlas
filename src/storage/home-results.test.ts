import "fake-indexeddb/auto";
import { beforeEach, expect, it } from "vitest";
import { getDatabase } from "./db";
import { listHomeResults, saveHomeResult } from "./home-results";
import { projectSession } from "../test/project-fixture";
beforeEach(async () => { const db = await getDatabase(); await db.clear("homeResults"); });
const result = (id: string, createdAt: number) => ({ id, question: "硬件 AI 有哪些决定？", topicGoal: "硬件AI", poolIds: ["one"], answer: projectSession(), createdAt });
it("retains independent completed answers in order and never overwrites original conversations or projects", async () => {
  const db = await getDatabase(); await db.put("conversations", { id: "one", title: "原始讨论", platform: "chatgpt", url: "", updatedAt: 1, messageCount: 0 }); const project = projectSession(); await db.put("focusSessions", project);
  await saveHomeResult(result("old", 1)); await saveHomeResult(result("new", 2)); await saveHomeResult({ ...result("old", 1), question: "旧结果重新保存" });
  expect((await listHomeResults()).map(row => row.id)).toEqual(["new", "old"]);
  expect((await db.get("conversations", "one"))?.title).toBe("原始讨论"); expect(await db.get("focusSessions", project.id)).toEqual(project);
});
it("does not persist cancelled generations", async () => { const controller = new AbortController(); controller.abort(); await expect(saveHomeResult(result("cancelled", 1), controller.signal)).rejects.toThrow(); expect(await listHomeResults()).toEqual([]); });
it("stores search and discovery activities alongside legacy answers without replacing their content",async()=>{
  const old=result("legacy",1);await saveHomeResult(old);
  await saveHomeResult({id:"search",kind:"search",question:"Orama",topicGoal:"Orama",poolIds:["one"],createdAt:2,status:"completed",matchCount:0});
  await saveHomeResult({id:"discover",kind:"discovery",question:"值得继续的项目",topicGoal:"值得继续的项目",poolIds:["one","two"],createdAt:3,status:"started"});
  const records=await listHomeResults();expect(records.map(row=>row.id)).toEqual(["discover","search","legacy"]);expect(records[2]).toEqual(old);expect("answer" in records[0]).toBe(false);
});
