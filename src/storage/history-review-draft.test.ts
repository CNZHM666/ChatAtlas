import "fake-indexeddb/auto";
import {expect,it} from "vitest";
import {getDatabase} from "./db";
import {saveProjectHistoryTask,saveHistoryReviewDraft,readProjectHistoryTask,type ProjectHistoryTask} from "./project-history-tasks";
it("preserves a manual review patch when an older model checkpoint finishes later",async()=>{
 const task:ProjectHistoryTask={id:"evolution:review-race",kind:"evolution",signature:"s",scopeSignature:"scope",results:{},status:"pending",updatedAt:1};
 await(await getDatabase()).delete("projectHistoryTasks",task.id);await saveProjectHistoryTask(task);
 await saveHistoryReviewDraft("review-race",{selection:{first:false},edits:{},updatedAt:10});
 await saveProjectHistoryTask({...task,results:{completed:{events:[]}},reviewDraft:{selection:{first:true},edits:{},updatedAt:2}});
 expect((await readProjectHistoryTask("review-race",undefined,"evolution"))?.reviewDraft?.selection.first).toBe(false);
 expect((await readProjectHistoryTask("review-race",undefined,"evolution"))?.results.completed).toBeDefined();
});
