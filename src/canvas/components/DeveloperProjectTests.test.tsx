import { runAIChainLocalChecks } from "../ai-chain-local-checks";
import { runProjectLocalChecks } from "../project-local-checks";
import {runKnowledgeLocalChecks} from "../knowledge-local-checks";
import {projectTestCases} from "../project-test-plan";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { DeveloperProjectTests } from "./DeveloperProjectTests";

afterEach(()=>{cleanup();localStorage.removeItem("atlas-project-test-report-v1");vi.restoreAllMocks();});
it("records manual cases separately from local checks and restores them after reload",()=>{
 const view=render(<DeveloperProjectTests zh/>);
 fireEvent.click(screen.getByText("开发者测试"));
 fireEvent.click(screen.getByRole("button",{name:"运行本地回归"}));
 const count=runAIChainLocalChecks().length+runProjectLocalChecks().length+runKnowledgeLocalChecks().length;expect(screen.getByRole("region",{name:"最近本地回归"})).toHaveTextContent(`${count}/${count}`);
 expect(screen.getByText("人工测试方案").closest("details")).not.toHaveAttribute("open");fireEvent.click(screen.getByText("人工测试方案"));
 expect(screen.getByText(new RegExp(`已记录 0/${projectTestCases.length} 项`))).toBeVisible();
 fireEvent.change(screen.getByLabelText("测试对象"),{target:{value:"architecture"}});
 expect(view.container.querySelectorAll(".developer-project-test-case").length).toBeLessThan(projectTestCases.length);
 expect([...view.container.querySelectorAll(".developer-project-test-case > summary")].some(summary=>summary.textContent?.startsWith("V01 ·"))).toBe(false);
 fireEvent.change(screen.getByLabelText("测试阶段"),{target:{value:"maintain"}});
 const item=screen.getByText(/^A04 ·/,{selector:"summary > span"}).closest("details")!;fireEvent.click(within(item).getByText(/^A04 ·/));
 fireEvent.change(within(item).getByLabelText("人工测试结果"),{target:{value:"failed"}});
 fireEvent.change(within(item).getByLabelText("任务 ID、指标与差异备注"),{target:{value:"test-run · 历史连线未隔离"}});
 view.unmount();render(<DeveloperProjectTests zh/>);fireEvent.click(screen.getByText("开发者测试"));fireEvent.click(screen.getByText("人工测试方案"));
 expect(screen.getByText(new RegExp(`已记录 1/${projectTestCases.length} 项`))).toBeVisible();
 const restored=screen.getByText(/^A04 ·/,{selector:"summary > span"}).closest("details")!;fireEvent.click(within(restored).getByText(/^A04 ·/));
 expect(within(restored).getByLabelText("人工测试结果")).toHaveValue("failed");
 expect(within(restored).getByLabelText("任务 ID、指标与差异备注")).toHaveValue("test-run · 历史连线未隔离");
});
it("exports plan and entered report without reading project data",()=>{
 const blobs:Blob[]=[];vi.spyOn(URL,"createObjectURL").mockImplementation(blob=>{blobs.push(blob as Blob);return "blob:test";});vi.spyOn(URL,"revokeObjectURL").mockImplementation(()=>undefined);const click=vi.spyOn(HTMLAnchorElement.prototype,"click").mockImplementation(()=>undefined);
 render(<DeveloperProjectTests zh/>);fireEvent.click(screen.getByText("开发者测试"));fireEvent.click(screen.getByText("导出"));
 fireEvent.click(screen.getByRole("button",{name:"导出测试方案"}));fireEvent.click(screen.getByRole("button",{name:"导出测试报告"}));
 expect(click).toHaveBeenCalledTimes(2);expect(blobs.map(blob=>blob.type)).toEqual(["text/markdown;charset=utf-8","application/json"]);
});

it("preserves entered results when the plan gains P1 cases",()=>{
 localStorage.setItem("atlas-project-test-report-v1",JSON.stringify({version:1,planVersion:"2026-10-13.1",sample:"旧样本",model:"旧模型",scope:"旧范围",cases:{A04:{result:"passed",note:"保留备注",updatedAt:1}}}));
 render(<DeveloperProjectTests zh/>);fireEvent.click(screen.getByText("开发者测试"));fireEvent.click(screen.getByText("人工测试方案"));fireEvent.click(screen.getByText("样本与运行信息"));expect(screen.getByLabelText("样本名称")).toHaveValue("旧样本");expect(screen.getByText(new RegExp(`已记录 1/${projectTestCases.length} 项`))).toBeVisible();
});
it("searches manual cases and filters failures without overwriting existing results",()=>{
 localStorage.setItem("atlas-project-test-report-v1",JSON.stringify({version:1,planVersion:"old",sample:"",model:"",scope:"",cases:{Q01:{result:"failed",note:"人工发现错误",updatedAt:1},Q02:{result:"passed",note:"保留通过",updatedAt:2}}}));
 render(<DeveloperProjectTests zh embedded/>);fireEvent.click(screen.getByText("人工测试方案"));fireEvent.click(screen.getByLabelText("只看失败"));
 expect(document.querySelectorAll(".developer-project-test-case")).toHaveLength(1);fireEvent.change(screen.getByLabelText("查找测试项"),{target:{value:"Q02"}});expect(screen.getByText("没有匹配的测试项。")).toBeVisible();
 fireEvent.click(screen.getByRole("button",{name:"运行本地回归"}));expect(JSON.parse(localStorage.getItem("atlas-project-test-report-v1")!).cases.Q02.note).toBe("保留通过");
});
