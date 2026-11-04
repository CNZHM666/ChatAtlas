import {cleanup,fireEvent,render,screen} from "@testing-library/react";
import {afterEach,expect,it,vi} from "vitest";
import {FocusGenerationErrorCard} from "./FocusGenerationErrorCard";
import {wikiPlanFailureMessage} from "../../ai/wiki-plan-contract";
import {wikiOutlineError} from "../../ai/wiki-outline-policy";
import {AIProviderValidationError} from "../../ai/provider-errors";
import {AIProviderResponseError} from "../../ai/provider-errors";
afterEach(cleanup);
it("shows retained directory assignments as paused and does not imply continuing work",()=>{
 render(<FocusGenerationErrorCard zh message="Wiki 目录材料归属未通过校验" code="PROVIDER_SCHEMA_wiki_directory_identity" progress={{processedSegments:554,totalSegments:554,completed:55,total:55,stage:"synthesis",phase:"directory",final:false,round:2,completedSourceIds:[],totalSources:1,elapsedMs:1,directory:{completedWindows:3,totalWindows:4,reusedWindows:2,confirmedAssignments:4,pendingAssignments:1,quarantinedReferences:1}}} onSources={vi.fn()} onSettings={vi.fn()}/>);
 expect(screen.getByText(/当前停在目录核对，正文尚未开始/u)).toBeVisible();
 expect(screen.getByText("材料归属核对已暂停：已确认 4 项，剩余 1 项。")).toBeVisible();
 expect(screen.queryByText(/正在局部核对材料归属/u)).toBeNull();
});
it("presents an allowance pause without implying account failure and retains diagnostic details",()=>{
 const retry=vi.fn();
 render(<FocusGenerationErrorCard zh message="已预留 45000/48000 Token。" code="PROVIDER_SCHEMA_wiki_writing_recovery_limit" onRetry={retry} onSources={vi.fn()} onSettings={vi.fn()}/>);
 expect(screen.getByRole("heading",{name:"正文补写已暂停"})).toBeVisible();
 expect(screen.getByText(/不是账户余额不足/)).not.toBeVisible();
 fireEvent.click(screen.getByRole("button",{name:"继续补写"}));expect(retry).toHaveBeenCalledOnce();
 fireEvent.click(screen.getByText("诊断信息"));expect(screen.getByText("已预留 45000/48000 Token。")).toBeVisible();
});
it("shows completed writing batches separately from completed reading",()=>{
 render(<FocusGenerationErrorCard zh message="本批正文漏了引用编号。" code="PROVIDER_SCHEMA_missing_evidence_ids" progress={{processedSegments:554,totalSegments:554,completed:55,total:61,stage:"synthesis",final:true,round:2,completedSourceIds:["source"],totalSources:1,elapsedMs:100}} onSources={vi.fn()} onSettings={vi.fn()}/>);
 expect(screen.getByText("材料分析已完成（554 段）")).toBeVisible();
 expect(screen.getByText("正文完成 55/61 个步骤")).toBeVisible();
});
it.each([true,false])("shows incomplete ownership repair counts as the primary reason (Chinese=%s)",zh=>{
 const error=new AIProviderValidationError("wiki_directory_ownership_incomplete");error.wikiOwnershipDetails={expectedSlots:17,receivedSlots:2,reason:"count"};
 const {container}=render(<FocusGenerationErrorCard zh={zh} message={wikiPlanFailureMessage(error,zh?"zh-CN":"en")} code={error.code} onSources={vi.fn()} onSettings={vi.fn()}/>);
 expect(container.querySelector(".focus-generation-error-reason")).toHaveTextContent("17");expect(container.querySelector(".focus-generation-error-reason")).toHaveTextContent("2");
});
it.each([true,false])("shows actual chapter counts in the primary error reason (Chinese=%s)",zh=>{
 const error=wikiOutlineError("no_convergence");error.wikiDirectoryCounts={mainCount:12,maxMainCount:8,subtopicCount:33};const message=wikiPlanFailureMessage(error,zh?"zh-CN":"en");
 const {container}=render(<FocusGenerationErrorCard zh={zh} message={message} code={error.code} onSources={vi.fn()} onSettings={vi.fn()}/>);
 const reason=container.querySelector(".focus-generation-error-reason")!;expect(reason).toHaveTextContent("12");expect(reason).toHaveTextContent("8");expect(screen.queryByText(zh?"目录整理未通过校验，请重试生成。":"The chapter outline could not be validated. Please retry.")).toBeNull();expect(container.querySelector("details")?.open).toBe(false);
});
it("explains retained analysis for a legacy routing error instead of implying that sources need replacing",()=>{
 const retry=vi.fn();
 render(<FocusGenerationErrorCard zh message="Wiki 目录的小节标识缺失或冲突。" code="PROVIDER_SCHEMA_wiki_directory_topic_key" progress={{processedSegments:554,totalSegments:554,completed:1,total:1,stage:"reading",final:false,round:1,completedSourceIds:[],totalSources:1,elapsedMs:1}} onRetry={retry} onSources={vi.fn()} onSettings={vi.fn()}/>);
 expect(screen.getByText("材料分析已完成（554 段）")).toBeVisible();expect(screen.getByText(/目录格式未能对齐/)).toBeVisible();fireEvent.click(screen.getByRole("button",{name:"重试目录"}));expect(retry).toHaveBeenCalledOnce();
});

it("updates the visible failure when switching language without rerunning generation",()=>{
 const props={message:"Wiki 正文章节缺少有效目录归属，本批正文尚未采用。 (Wiki 正文批次 34/34)",code:"PROVIDER_SCHEMA_wiki_owner_missing_or_unknown",onSources:vi.fn(),onSettings:vi.fn(),onRetry:vi.fn()};
 const {rerender,container}=render(<FocusGenerationErrorCard {...props} zh/>);
 expect(screen.getByText("部分正文未能对应到正确章节，需要重新整理。")).toBeVisible();
 rerender(<FocusGenerationErrorCard {...props} zh={false}/>);
 expect(screen.getByRole("heading",{name:"Generation paused"})).toBeVisible();
 expect(screen.getByText("Some writing could not be matched to its chapter and needs another pass.")).toBeVisible();
 expect(container.querySelector(".focus-generation-error-reason")).not.toHaveTextContent("Wiki 正文批次");
 expect(screen.getByText(props.message)).not.toBeVisible();
 fireEvent.click(screen.getByText("Diagnostic details"));expect(screen.getByText(props.message)).toBeVisible();
});
it("localizes a provider's Chinese timeout and keeps its original message in diagnostics",()=>{
 const error=new AIProviderResponseError("PROVIDER_TIMEOUT");
 const {container}=render(<FocusGenerationErrorCard zh={false} message={error.message} code={error.code} onSources={vi.fn()} onSettings={vi.fn()}/>);
 expect(screen.getByText("The model response timed out. Please retry shortly.")).toBeVisible();
 expect(container.querySelector(".focus-generation-error-reason")).not.toHaveTextContent("超时");
 expect(screen.getByText(error.message)).not.toBeVisible();
});
it("identifies an omitted writing chapter as writing progress rather than outline planning",()=>{
 render(<FocusGenerationErrorCard zh message="Wiki 正文遗漏章节。" code="PROVIDER_SCHEMA_wiki_directory_missing_owner" progress={{processedSegments:554,totalSegments:554,completed:34,total:35,stage:"synthesis",final:true,round:2,completedSourceIds:[],totalSources:1,elapsedMs:1}} onSources={vi.fn()} onSettings={vi.fn()}/>);
 expect(screen.getByText("正文完成 34/35 个步骤")).toBeVisible();
 expect(screen.getByText("部分章节尚未生成，可以继续完成剩余正文。")).toBeVisible();
});
