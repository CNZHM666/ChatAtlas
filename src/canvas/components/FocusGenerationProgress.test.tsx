import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { FocusGenerationProgress } from "./FocusGenerationProgress";
import type { FocusAnalysisProgress } from "../../shared/focus-progress";
afterEach(cleanup);
it("shows completed directory windows and remaining local assignments without claiming writing is ready",()=>{
 render(<FocusGenerationProgress zh mode="work" detail={{...detail,phase:"directory",stage:"synthesis",directory:{completedWindows:7,totalWindows:8,reusedWindows:6,confirmedAssignments:4,pendingAssignments:1,quarantinedReferences:1}}} sourceCount={1} retrying={false} onCancel={vi.fn()}/>);
 expect(screen.getByText("目录批次已完成 7/8，复用 6 批。")).toBeVisible();
 expect(screen.getByText(/已确认 4 项，剩余 1 项/)).toBeVisible();
 expect(screen.getByText(/已隔离 1 处无效编号引用/)).toBeVisible();
 expect(screen.queryByText("生成项目内容")).toBeNull();
});
it("identifies resumed composition without showing another source understanding stage",()=>{
 render(<FocusGenerationProgress zh mode="work" detail={{...detail,stage:"synthesis",final:true,resumed:true,processedSegments:554,totalSegments:554}} sourceCount={1} retrying={false} onCancel={vi.fn()}/>);
 expect(screen.getByRole("status")).toHaveTextContent("生成项目内容");
 expect(screen.getByText(/从已保存的生成进度继续/u)).toBeVisible();
 expect(screen.queryByText("理解与整理来源")).toBeNull();
});
it("keeps final directory reconciliation in source organization without a false percentage",()=>{
 const {rerender}=render(<FocusGenerationProgress zh mode="work" detail={{...detail,stage:"synthesis",phase:"directory",completed:0,total:0,processedSegments:154,completedSourceIds:["source"]}} sourceCount={1} retrying={false} onCancel={vi.fn()}/>);
 expect(screen.getByRole("status")).toHaveTextContent("理解与整理来源");
 expect(screen.getByText("1/1 条对话已理解")).toBeVisible();
 expect(screen.getByRole("progressbar")).not.toHaveAttribute("value");
 expect(screen.queryByText("100%")).toBeNull();
 // Streaming catalogue callbacks still carry the preceding reading stage.
 rerender(<FocusGenerationProgress zh mode="work" detail={{...detail,stage:"reading",phase:"directory",processedSegments:154,completedSourceIds:["source"]}} sourceCount={1} retrying={false} onCancel={vi.fn()}/>);
 expect(screen.getByRole("progressbar")).not.toHaveAttribute("value");
 expect(screen.queryByText("100%")).toBeNull();
});
it("keeps compact progress expandable and closes it by Escape or an outside click", () => {
  const cancel = vi.fn();
  const { container } = render(<FocusGenerationProgress compact zh detail={detail} sourceCount={1} retrying={false} onCancel={cancel} />);
  const menu = container.querySelector("details")!;
  expect(menu.open).toBe(false);
  fireEvent.click(screen.getByLabelText("查看生成进度"));
  expect(menu.open).toBe(true);
  expect(screen.getByRole("progressbar")).toHaveAttribute("value", "40");
  fireEvent.keyDown(document, { key: "Escape" });
  expect(menu.open).toBe(false);
  expect(screen.getByLabelText("查看生成进度")).toHaveFocus();
  fireEvent.click(screen.getByLabelText("查看生成进度"));
  fireEvent.pointerDown(document.body);
  expect(menu.open).toBe(false);
  fireEvent.click(screen.getByLabelText("查看生成进度"));
  fireEvent.click(screen.getByRole("button", { name: "取消" }));
  expect(cancel).toHaveBeenCalledOnce();
});
const detail: FocusAnalysisProgress = { completed: 2, total: 8, stage: "reading", final: false, round: 1, completedSourceIds: [], totalSources: 1, processedSegments: 40, totalSegments: 154, elapsedMs: 1000, remainingSteps: 7, stepsEstimated: true };
it("explains remaining split repairs near the end instead of implying the whole task is finished",()=>{
 const {rerender}=render(<FocusGenerationProgress zh mode="work" detail={{...detail,stage:"synthesis",final:true,completed:34,total:35,recoverySplits:1}} sourceCount={1} retrying={false} onCancel={vi.fn()}/>);
 expect(screen.getByText("97%")).toBeVisible();
 expect(screen.getByText("正在分批修复剩余正文 · 已完成 34/35 个步骤")).toBeVisible();
 rerender(<FocusGenerationProgress zh={false} mode="work" detail={{...detail,stage:"synthesis",final:true,completed:34,total:35,recoverySplits:1}} sourceCount={1} retrying={false} onCancel={vi.fn()}/>);
 expect(screen.getByText("Repairing remaining writing in smaller batches · 34/35 steps complete")).toBeVisible();
});
it("keeps progress concise while retaining the actual stage and batch counts",()=>{
 const {rerender}=render(<FocusGenerationProgress zh mode="work" detail={{...detail,reusedBatches:2}} sourceCount={1} retrying={false} onCancel={vi.fn()}/>);
 expect(screen.queryByText(/完成材料初读和目录后开始撰写正文/u)).toBeNull();expect(screen.getByText("第 1 轮 · 2/8 批")).toBeVisible();
 rerender(<FocusGenerationProgress zh mode="work" detail={{...detail,stage:"synthesis",final:true,reusedBatches:2,readyChapters:1,firstPreviewMs:3500}} sourceCount={1} retrying={false} onCancel={vi.fn()}/>);
 expect(screen.getByRole("status")).toHaveTextContent("生成项目内容");expect(screen.queryByText(/完成材料初读和目录后/u)).toBeNull();
});
it("shows rounds and batch counts directly, updating them after splitting", () => {
  const { rerender, container } = render(<FocusGenerationProgress zh detail={detail} sourceCount={1} retrying={false} onCancel={vi.fn()} />);
  expect(screen.getByText("第 1 轮 · 2/8 批")).toBeVisible();
  expect(screen.queryByText("查看详情")).not.toBeInTheDocument();
  expect(container.querySelector("details")).toBeNull();
  expect(container.querySelector("ol")).toBeNull();
  rerender(<FocusGenerationProgress zh detail={{ ...detail, total: 9, remainingSteps: 8, recoverySplits: 1 }} sourceCount={1} retrying={false} onCancel={vi.fn()} />);
  expect(screen.getByText("第 1 轮 · 2/9 批")).toBeVisible();
  rerender(<FocusGenerationProgress zh detail={{ ...detail, stage: "synthesis", final: true, completed: 0, total: 2, remainingSteps: 2, stepsEstimated: false }} sourceCount={1} retrying={false} onCancel={vi.fn()} />);
  expect(screen.getByText("第 1 轮 · 0/2 批")).toBeVisible();
  rerender(<FocusGenerationProgress zh detail={{ ...detail, remainingMs: 27000 }} sourceCount={1} retrying={false} onCancel={vi.fn()} />);
  expect(screen.queryByText(/剩余.*秒/u)).not.toBeInTheDocument();
});
it("does not invent a count before the plan is known", () => {
  render(<FocusGenerationProgress zh sourceCount={1} retrying={false} onCancel={vi.fn()} />);
  expect(screen.queryByText(/第 \d 轮/u)).not.toBeInTheDocument();
  expect(screen.getByRole("progressbar")).not.toHaveAttribute("value");
  expect(screen.queryByText(/还剩 \d/u)).not.toBeInTheDocument();
});
it("distinguishes whole-conversation reading from selected passages without claiming completion", () => {
  const { rerender } = render(<FocusGenerationProgress zh detail={detail} scopeKind="all" sourceCount={1} retrying={false} onCancel={vi.fn()} />);
  expect(screen.getByText("全文整理 · 40/154 段 · 0/1 条对话")).toBeVisible();
  rerender(<FocusGenerationProgress zh scopeKind="goal" sourceCount={1} retrying={false} onCancel={vi.fn()} />);
  expect(screen.getByText("片段整理 · 1 条所选对话")).toBeVisible();
  expect(screen.getByRole("progressbar")).not.toHaveAttribute("value");
});
it("names the actual mode, shows rounds without extra explanations, and allows cancellation", () => {
  const cancel = vi.fn();
  const { rerender } = render(<FocusGenerationProgress zh mode="work" detail={{ ...detail, stage: "synthesis", final: true, completed: 1, total: 3 }} sourceCount={1} retrying={false} onCancel={cancel} />);
  expect(screen.getByRole("status")).toHaveTextContent("生成项目内容");
  expect(screen.getByRole("progressbar")).toHaveAttribute("value", "1");
  expect(screen.getByRole("progressbar")).toHaveAttribute("max", "3");
  expect(screen.getByText("第 1 轮 · 1/3 批")).toBeVisible();
  expect(screen.queryByText(/还剩/u)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "取消" })); expect(cancel).toHaveBeenCalledOnce();
  rerender(<FocusGenerationProgress zh mode="review" detail={{ ...detail, stage: "synthesis", final: true, total: 1 }} sourceCount={1} retrying={false} onCancel={cancel} />);
  expect(screen.getByRole("status")).toHaveTextContent("生成复习回顾");
  expect(screen.getByRole("progressbar")).not.toHaveAttribute("value");
  rerender(<FocusGenerationProgress zh mode="work" detail={{ ...detail, stage: "project", final: true }} sourceCount={1} retrying onCancel={cancel} />);
  expect(screen.getByRole("status")).toHaveTextContent("重试中");
});
it("shows the knowledge-unit ledger's three steps with the running part and its count", () => {
  const ledger = (stage: NonNullable<FocusAnalysisProgress["ledger"]>["stage"], done: number, total: number): FocusAnalysisProgress => ({ ...detail, ledger: { stage, done, total } });
  const { rerender, container } = render(<FocusGenerationProgress zh mode="work" scopeKind="all" detail={ledger("extract", 0, 102)} sourceCount={1} retrying={false} onCancel={vi.fn()} />);
  expect(screen.getByRole("status")).toHaveTextContent("读取对话并抽取知识点");
  expect(screen.getByText("0/102 批 · 1 条对话")).toBeVisible();
  expect(screen.getByText("第 1/3 步")).toBeVisible();
  expect(screen.queryByText(/轮|段/u)).toBeNull();
  rerender(<FocusGenerationProgress zh mode="work" detail={ledger("merge", 30, 120)} sourceCount={1} retrying={false} onCancel={vi.fn()} />);
  expect(screen.getByRole("status")).toHaveTextContent("整理主题与目录");
  expect(screen.getByText("整理 5/7 · 去重与关系 · 30/120 条")).toBeVisible();
  expect(screen.getByText("25%")).toBeVisible();
  // Planning the directory is one request: no percentage it cannot measure.
  rerender(<FocusGenerationProgress zh mode="work" detail={ledger("plan", 0, 1)} sourceCount={1} retrying={false} onCancel={vi.fn()} />);
  expect(screen.getByText("整理 7/7 · 规划目录")).toBeVisible();
  expect(screen.getByRole("progressbar")).not.toHaveAttribute("value");
  rerender(<FocusGenerationProgress zh mode="work" detail={ledger("write", 3, 8)} sourceCount={1} retrying={false} onCancel={vi.fn()} />);
  expect(screen.getByRole("status")).toHaveTextContent("按章节写作");
  expect(screen.getByText("已写 3/8 章")).toBeVisible();
  expect(screen.getByText("第 3/3 步")).toBeVisible();
  rerender(<FocusGenerationProgress compact zh mode="work" detail={ledger("write", 3, 8)} sourceCount={1} retrying={false} onCancel={vi.fn()} />);
  expect(container.querySelector("summary")).toHaveTextContent("3/3 步 · 38%");
});
