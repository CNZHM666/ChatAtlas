import { render,screen,within } from "@testing-library/react";
import { expect,it } from "vitest";
import { AIChainDiagnostics } from "./AIChainDiagnostics";
import { analyzeAILifecycle } from "../../ai/lifecycle-analysis";
import type { AIUsageEvent } from "../../shared/types";

it("shows missing legacy timings as unknown and derives each request feature from its own metadata",()=>{
 const legacy:AIUsageEvent={id:"legacy",createdAt:1,taskType:"other",stage:"wiki_topic_plan",providerId:"fixture",modelId:"fixture",conversationIds:[],inputTokens:0,outputTokens:0,tokenSource:"unavailable",attempt:1,status:"failed"};
 render(<AIChainDiagnostics data={analyzeAILifecycle([legacy])} zh/>);
 const row=screen.getByText("wiki_topic_plan").closest("tr")!;
 expect(within(row).getByText("— / — / —")).toBeInTheDocument();
 expect(screen.getByText("部分记录没有完整计时，不能据此补算各阶段耗时。")).toBeInTheDocument();
 expect(screen.getAllByText(/总览与 Wiki/)).toHaveLength(2);
});
