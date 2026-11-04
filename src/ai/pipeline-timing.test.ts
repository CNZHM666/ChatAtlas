import "fake-indexeddb/auto";
import { expect,it } from "vitest";
import { measureAILocalStep,markAIFirstReadable,recordAISkippedStep } from "./pipeline-timing";
import { getOrganizationRun,saveOrganizationRun } from "../storage/organization-runs";
it("includes work that started while another phase was still running",async()=>{
 const id=crypto.randomUUID(),since={monotonic:performance.now()-250,startedAt:Date.now()-250};
 await measureAILocalStep(id,"wiki","wiki:topic-planning",()=>true,undefined,since);
 expect((await getOrganizationRun(id))?.pipelineSpans?.[0]).toMatchObject({startedAt:since.startedAt,status:"completed"});
 expect((await getOrganizationRun(id))?.pipelineSpans?.[0].durationMs).toBeGreaterThanOrEqual(250);
});
it("preserves local phase receipts when the actual owner saves the same run and never stores results",async()=>{
 const id=`timing-${crypto.randomUUID()}`;
 expect(await measureAILocalStep(id,"project_query","retrieval:local",()=>"PRIVATE SOURCE")).toBe("PRIVATE SOURCE");
 const diagnostic=(await getOrganizationRun(id))!;expect(diagnostic.pipelineSpans).toHaveLength(1);expect(JSON.stringify(diagnostic)).not.toContain("PRIVATE SOURCE");
 await saveOrganizationRun({...diagnostic,diagnosticOnly:undefined,title:"Actual owner",pipelineSpans:undefined,status:"waiting_review"});
 const owned=(await getOrganizationRun(id))!;expect(owned.title).toBe("Actual owner");expect(owned.pipelineSpans).toHaveLength(1);
 await expect(measureAILocalStep(id,"wiki","source:load",()=>{throw Error("PRIVATE ERROR");})).rejects.toThrow("PRIVATE ERROR");
 const after=(await getOrganizationRun(id))!;expect(after.pipelineSpans?.at(-1)?.status).toBe("failed");expect(after.status).toBe("waiting_review");expect(JSON.stringify(after)).not.toContain("PRIVATE ERROR");
});

it("retains first-readable and skipped-stage receipts across owner saves",async()=>{
 const id=crypto.randomUUID();await measureAILocalStep(id,"wiki","source:load",()=>true);
 await markAIFirstReadable(id);const first=(await getOrganizationRun(id))!;
 await markAIFirstReadable(id);await recordAISkippedStep(id,"wiki","wiki:directory","no_mergeable_generated_chapters");
 await saveOrganizationRun({...first,firstReadableAt:undefined,executionStartedAt:undefined,pipelineSpans:undefined});
 const result=(await getOrganizationRun(id))!;expect(result.firstReadableAt).toBe(first.firstReadableAt);expect(result.pipelineSpans?.at(-1)).toMatchObject({status:"skipped",durationMs:0,reason:"no_mergeable_generated_chapters"});
});
