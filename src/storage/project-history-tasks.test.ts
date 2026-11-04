import "fake-indexeddb/auto";
import { expect,it } from "vitest";
import { getDatabase } from "./db";
import { readProjectHistoryTask,saveProjectHistoryTask,markProjectHistoryReviewed } from "./project-history-tasks";
import { projectSession } from "../test/project-fixture";
it("inherits checkpoints across plan revisions while keeping ancestor review state unchanged",async()=>{
 const db=await getDatabase(),parent="inherit-parent",child="inherit-child",grandchild="inherit-grandchild";
 await saveProjectHistoryTask({id:`history:${parent}`,kind:"releases",signature:"request-identity",cacheNamespace:"same-provider-scope",scopeSignature:"scope",status:"pending",results:{known:{events:[]}},analysis:{version:5,kind:"releases",signature:"scope",sourceSignature:"raw",events:[],sources:[],evidence:[],generatedAt:3,pendingBatches:1},updatedAt:1});
 await db.put("focusSessions",{...projectSession(),id:child,previousSessionId:parent});
 expect(await readProjectHistoryTask(grandchild,child)).toMatchObject({id:`history:${grandchild}`,results:{known:{events:[]}}});
 await markProjectHistoryReviewed(grandchild,3,child);expect((await readProjectHistoryTask(grandchild))?.reviewedAnalysisAt).toBe(3);expect((await readProjectHistoryTask(parent))?.reviewedAnalysisAt).toBeUndefined();
});

it("isolates evolution checkpoints from the existing release namespace and inherits each separately",async()=>{const base={signature:"sig",scopeSignature:"scope",status:"pending" as const,results:{},updatedAt:1};await saveProjectHistoryTask({...base,id:"history:kind-parent",kind:"releases",results:{release:1}});await saveProjectHistoryTask({...base,id:"evolution:kind-parent",kind:"evolution",results:{evolution:2}});expect(await readProjectHistoryTask("kind-child","kind-parent")).toMatchObject({id:"history:kind-child",results:{release:1}});expect(await readProjectHistoryTask("kind-child","kind-parent","evolution")).toMatchObject({id:"evolution:kind-child",results:{evolution:2}});});
