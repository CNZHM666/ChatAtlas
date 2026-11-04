import {afterEach,expect,it} from "vitest";
import {fittingRequest} from "./request-fit";
import {recordTokenSample,resetTokenCalibration} from "./token-calibration";
import {requestBudget} from "./request-policy";
import type {StructuredAIRequest} from "./provider";

afterEach(()=>resetTokenCalibration());
// An overview-sized request whose raw estimate is over its 6,000-token limit.
const variant=(length:number)=>():StructuredAIRequest<unknown>=>({taskType:"other",system:"Write the overview.",prompt:JSON.stringify({presentation:"wiki_project_overview",chapters:Array.from({length:16},(_,index)=>({title:`章节${index}`,opening:"本章说明检索、整理与复用的条件和边界。".repeat(18).slice(0,length)}))}),validate:value=>value});

it("judges fit on the model's calibrated estimate, so a request that really fits keeps its detail",()=>{
 const full=variant(320)();
 const budget=requestBudget(full,"calibrated-model");expect(budget.inputTokens).toBeGreaterThan(budget.maxInputTokens);
 // Uncalibrated: the shorter variant is chosen.
 expect(fittingRequest([variant(320),variant(80)],"calibrated-model").prompt).toBe(variant(80)().prompt);
 // The provider reports about half the local estimate.
 for(let index=0;index<5;index++)recordTokenSample("calibrated-model",10000,5000);
 expect(fittingRequest([variant(320),variant(80)],"calibrated-model").prompt).toBe(full.prompt);
});
