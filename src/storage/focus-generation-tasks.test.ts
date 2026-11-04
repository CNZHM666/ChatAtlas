import "fake-indexeddb/auto";
import { beforeEach, expect, it } from "vitest";
import { getDatabase } from "./db";
import { beginFocusGenerationTask, listFocusGenerationTasks, recoverLegacyFocusTasks, updateFocusGenerationTask } from "./focus-generation-tasks";
import type { AIUsageEvent } from "../shared/types";
import { createAtlasBackup, restoreAtlasBackup } from "./atlas-backup";
import {projectSession} from "../test/project-fixture";
import {saveFocusSession} from "./focus-sessions";

beforeEach(async () => {
  const db = await getDatabase();
  for (const name of ["focusGenerationTasks", "focusSessions", "organizationRuns", "aiUsageEvents"] as const) await db.clear(name);
});
const input = { id: "task", runId: "run", goal: "回顾控制节点", mode: "review" as const, sourceIds: ["selected"], scope: { kind: "all" as const, sourceConversationIds: ["selected"] } };
const event = (id: string, patch: Partial<AIUsageEvent> = {}): AIUsageEvent => ({ id, runId: "legacy", taskType: "focus_session", providerId: "bailian", modelId: "deepseek-v4.1-flash", conversationIds: ["selected"], inputTokens: 10, outputTokens: 10, tokenSource: "provider", status: "completed", attempt: 1, stage: "reading", createdAt: 1, ...patch });

it("retains confirmed inputs across interruption and prevents late callbacks from hiding a preview", async () => {
  await beginFocusGenerationTask(input);
  await updateFocusGenerationTask(input.id, { status: "failed", errorCode: "PROVIDER_OUTPUT_TRUNCATED" });
  const failed = (await listFocusGenerationTasks())[0];
  expect(failed).toMatchObject({ ...input, status: "failed" });
  await updateFocusGenerationTask(input.id, { status: "paused" });
  expect((await listFocusGenerationTasks())[0].status).toBe("failed");
  await beginFocusGenerationTask(input);
  expect((await listFocusGenerationTasks())[0]).toMatchObject({ status: "running", createdAt: failed.createdAt });
  expect((await listFocusGenerationTasks())[0].errorCode).toBeUndefined();
  await updateFocusGenerationTask(input.id, { status: "preview", sessionId: "preview" });
  await updateFocusGenerationTask(input.id, { status: "paused" });
  expect((await listFocusGenerationTasks())[0]).toMatchObject({ status: "preview", sessionId: "preview" });
});

it("recovers logged unfinished runs once, requiring explicit goal and source confirmation", async () => {
  const db = await getDatabase();
  await db.put("aiUsageEvents", event("one"));
  await db.put("aiUsageEvents", event("two", { conversationIds: ["another"], createdAt: 2, status: "failed", errorCode: "PROVIDER_OUTPUT_TRUNCATED" }));
  await db.put("aiUsageEvents", event("done", { runId: "finished", stage: "synthesis:final" }));
  await recoverLegacyFocusTasks(); await recoverLegacyFocusTasks();
  expect(await listFocusGenerationTasks()).toEqual([expect.objectContaining({ id: "legacy", runId: "legacy", goal: "", needsConfirmation: true, sourceIds: ["selected", "another"], status: "failed" })]);
  await beginFocusGenerationTask({ ...input, id: "legacy", runId: "legacy" });
  await recoverLegacyFocusTasks();
  expect(await listFocusGenerationTasks()).toEqual([expect.objectContaining({ goal: input.goal, sourceIds: ["selected"], status: "running" })]);
  expect((await listFocusGenerationTasks())[0].needsConfirmation).toBeUndefined();
});

it("keeps transient generation jobs out of backups and clears them on restore", async () => {
  await beginFocusGenerationTask(input);
  const backup = await createAtlasBackup();
  expect(backup.stores).not.toHaveProperty("focusGenerationTasks");
  await restoreAtlasBackup(backup);
  expect(await listFocusGenerationTasks()).toEqual([]);
});

it("commits the generated result and task completion together, keeping late cleanup from reviving it",async()=>{
 await beginFocusGenerationTask({...input,mode:"work"});
 await updateFocusGenerationTask(input.id,{status:"failed",errorCode:"PROVIDER_TIMEOUT"});
 const session={...projectSession(),runId:input.runId,status:"ready" as const};
 await saveFocusSession(session);
 const db=await getDatabase();
 expect(await db.get("focusSessions",session.id)).toEqual(session);
 expect(await db.get("focusGenerationTasks",input.id)).toMatchObject({status:"preview",sessionId:session.id,errorCode:undefined});
 await updateFocusGenerationTask(input.id,{status:"paused"});
 expect((await listFocusGenerationTasks())[0].status).toBe("preview");
});

it("recognizes legacy result identities but does not complete another run with the same project and sources",async()=>{
 const db=await getDatabase(),session={...projectSession(),runId:"successful-run"};
 await db.put("focusSessions",session);
 await beginFocusGenerationTask({...input,sessionId:session.id});
 await beginFocusGenerationTask({...input,id:"different",runId:"different",goal:session.goal,mode:"work",sourceIds:session.sourceConversationIds});
 const tasks=await listFocusGenerationTasks();
 expect(tasks.find(task=>task.id===input.id)).toMatchObject({status:"preview",sessionId:session.id});
 expect(tasks.find(task=>task.id==="different")?.status).toBe("running");
 expect(await db.count("focusGenerationTasks")).toBe(2);
});

it("does not turn a partial preview or completed passage count into a finished generation",async()=>{
 await beginFocusGenerationTask(input);
 await (await getDatabase()).put("focusSessions",{...projectSession(),id:"partial:run",runId:input.runId,status:"preview"});
 await updateFocusGenerationTask(input.id,{status:"failed"});
 expect((await listFocusGenerationTasks())[0].status).toBe("failed");
});
