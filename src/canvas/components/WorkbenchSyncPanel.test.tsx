import "fake-indexeddb/auto";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Conversation, ImportJob } from "../../shared/types";
import { PreferencesProvider } from "../preferences";
import { WorkbenchSyncPanel } from "./WorkbenchSyncPanel";

afterEach(cleanup);
describe("material list responsiveness during import", () => {
  it("combines AI categories, sync state and title search, selecting only the filtered results",()=>{
    localStorage.setItem("atlas-locale","zh-CN");
    const conversations=[{id:"gpt",platform:"chatgpt",title:"GPT title",messageCount:null,importState:"discovered",updatedAt:1},{id:"claude-ready",platform:"claude",title:"Claude ready",messageCount:2,importState:"complete",hydrationState:"hydrated",updatedAt:2},{id:"claude-pending",platform:"claude",title:"Claude pending",messageCount:null,importState:"discovered",updatedAt:3}] as Conversation[];
    const onSelectedIds=vi.fn(),onHydrate=vi.fn();
    render(<PreferencesProvider><WorkbenchSyncPanel conversations={conversations} importJob={null} importSource="web" selectedIds={new Set(["gpt"])} onSelectedIds={onSelectedIds} onPrioritize={vi.fn()} onScan={vi.fn()} onHydrate={onHydrate} onZip={vi.fn()} onPause={vi.fn()} onConnect={vi.fn()}/></PreferencesProvider>);
    fireEvent.click(screen.getByRole("button",{name:"Claude 2"}));expect(screen.getByRole("tab",{name:"全部 2"})).toBeVisible();expect(screen.queryByLabelText(/GPT title/)).toBeNull();
    fireEvent.click(screen.getByRole("tab",{name:"已同步 1"}));expect(screen.getByLabelText(/Claude ready/)).toBeVisible();expect(screen.queryByLabelText(/Claude pending/)).toBeNull();
    fireEvent.click(screen.getByRole("button",{name:"全选 1 条"}));expect(onSelectedIds).toHaveBeenCalledWith(new Set(["gpt","claude-ready"]));expect(onHydrate).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole("textbox",{name:"搜索对话标题"}),{target:{value:"missing"}});expect(screen.getByText("没有找到相关对话")).toBeVisible();
    fireEvent.click(screen.getByRole("button",{name:"Gemini 0"}));expect(screen.getByRole("tab",{name:"全部 0"})).toBeVisible();
  });
  it("opens the file export tutorial from the home import tile before choosing a ZIP",()=>{
    localStorage.setItem("atlas-locale","zh-CN");const onZip=vi.fn();
    render(<PreferencesProvider><WorkbenchSyncPanel conversations={[]} initialImport importJob={null} importSource="zip" selectedIds={new Set()} onSelectedIds={vi.fn()} onPrioritize={vi.fn()} onScan={vi.fn()} onHydrate={vi.fn()} onZip={onZip} onPause={vi.fn()} onConnect={vi.fn()}/></PreferencesProvider>);
    fireEvent.click(screen.getByRole("button",{name:"导入对话文件"}));expect(screen.getByRole("dialog",{name:"导入 AI 对话"})).toBeVisible();expect(onZip).not.toHaveBeenCalled();
    const file=new File(["zip fixture"],"chatgpt-export.zip",{type:"application/zip"});fireEvent.change(screen.getByLabelText("导入对话文件",{selector:"input"}),{target:{files:[file]}});expect(onZip).toHaveBeenCalledExactlyOnceWith(file);expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("acknowledges a priority click immediately, prevents duplicates, and distinguishes active work from queued work", async () => {
    localStorage.setItem("atlas-locale", "zh-CN");
    const conversations = ["a", "b"].map(id => ({ id, platform: "chatgpt", title: id, messageCount: null, importState: "discovered", updatedAt: 1 })) as Conversation[];
    let release!: (value: boolean) => void;
    const onHydrate = vi.fn(() => new Promise<boolean>(resolve => { release = resolve; }));
    const props = { conversations, importJob: { status: "syncing", phase: "syncing", retryScope: "selected", pendingIds: ["old"] } as ImportJob, importSource: "web" as const, selectedIds: new Set(["a", "b"]), onSelectedIds: vi.fn(), onPrioritize: vi.fn(), onScan: vi.fn(), onHydrate, onZip: vi.fn(), onPause: vi.fn(), onConnect: vi.fn() };
    const { rerender } = render(<PreferencesProvider><WorkbenchSyncPanel {...props} /></PreferencesProvider>);
    fireEvent.click(screen.getByRole("button", { name: "优先同步所选 2 条" }));
    const submitting = screen.getByRole("button", { name: "正在提交同步…" }); expect(submitting).toBeDisabled();
    fireEvent.click(submitting); expect(onHydrate).toHaveBeenCalledOnce();
    await act(async () => { release(true); });
    rerender(<PreferencesProvider><WorkbenchSyncPanel {...props} importJob={{ ...props.importJob, activeIds: ["a"], priorityPendingIds: ["a", "b"], pendingIds: ["a", "b", "old"] }} /></PreferencesProvider>);
    expect(screen.queryByRole("button", { name: "所选 2 条同步中" })).toBeNull();
    expect(screen.getByText("1 同步中 · 1 排队")).toBeVisible();
    rerender(<PreferencesProvider><WorkbenchSyncPanel {...props} importJob={{ ...props.importJob, activeIds: ["a"], retryingIds: ["a"], priorityPendingIds: ["a", "b"], pendingIds: ["a", "b", "old"] }} /></PreferencesProvider>);
    expect(screen.getByText("1 等待重试")).toBeVisible();
    expect(onHydrate).toHaveBeenCalledWith(["a", "b"]);
  });
  it("merges progress and notices, displays platforms, and resumes paused work", async () => {
    localStorage.setItem("atlas-locale", "zh-CN");
    const pending = { id: "pending", platform: "chatgpt", title: "活动计划", updatedAt: 1, messageCount: null, importState: "discovered" } as Conversation;
    const props = { conversations: [pending], importJob: { status: "syncing", retryScope: "selected", pendingIds: [pending.id] } as ImportJob, importSource: "web" as const, selectedIds: new Set<string>(), onSelectedIds: vi.fn(), onPrioritize: vi.fn(), onScan: vi.fn(), onHydrate: vi.fn(), onZip: vi.fn(), onPause: vi.fn(), onResume: vi.fn(), onConnect: vi.fn() };
    const { container, rerender } = render(<PreferencesProvider><WorkbenchSyncPanel {...props} /></PreferencesProvider>);
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(container.querySelector('.workbench-sync-top [role="status"]')).toBeTruthy();
    expect(screen.queryByRole("button",{name:/优先同步并用于/})).toBeNull();expect(container.querySelector(".workbench-source-platform")).toHaveTextContent("ChatGPT");
    expect(props.onPrioritize).not.toHaveBeenCalled();
    rerender(<PreferencesProvider><WorkbenchSyncPanel {...props} importJob={{ ...props.importJob, status: "paused" }} /></PreferencesProvider>);
    expect(screen.getAllByRole("status")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "继续同步" }));
    expect(props.onResume).toHaveBeenCalledOnce();
  });
  it("lets one conversation from a bulk priority queue move ahead of the others", async () => {
    localStorage.setItem("atlas-locale", "zh-CN");
    const conversations = ["a", "b", "c"].map(id => ({ id, platform: "deepseek", nativeHistorySourceId: "deepseek", title: id, messageCount: null, importState: "discovered", updatedAt: 1 })) as Conversation[];
    const props = { conversations, importJob: { status: "syncing", phase: "syncing", retryScope: "selected", activeIds: ["a"], pendingIds: ["a", "b", "c"], priorityPendingIds: ["b", "c"] } as ImportJob, importSource: "web" as const, selectedIds: new Set(["c"]), onSelectedIds: vi.fn(), onPrioritize: vi.fn(), onScan: vi.fn(), onHydrate: vi.fn().mockResolvedValue(true), onZip: vi.fn(), onPause: vi.fn(), onConnect: vi.fn() };
    const { rerender } = render(<PreferencesProvider><WorkbenchSyncPanel {...props} /></PreferencesProvider>);
    fireEvent.click(screen.getByRole("button", { name: "优先同步所选 1 条" }));
    await waitFor(() => expect(props.onHydrate).toHaveBeenCalledExactlyOnceWith(["c"]));
    rerender(<PreferencesProvider><WorkbenchSyncPanel {...props} importJob={{ ...props.importJob, pendingIds: ["c", "a", "b"], priorityPendingIds: ["c", "b"] }} /></PreferencesProvider>);
    expect(screen.queryByRole("button", { name: "优先同步所选 1 条" })).toBeNull();
    expect(screen.getByText("1 排队")).toBeVisible();
  });

  it("allows choosing materials during a file import without starting competing web sync", () => {
    localStorage.setItem("atlas-locale", "zh-CN");
    const pending = { id: "pending", platform: "chatgpt", title: "文件中的计划", updatedAt: 1, messageCount: null, importState: "discovered" } as Conversation;
    const props = { conversations: [pending], importJob: { status: "syncing", discovered: 2, completed: 1 } as ImportJob, importSource: "zip" as const, selectedIds: new Set<string>(), onSelectedIds: vi.fn(), onPrioritize: vi.fn(), onScan: vi.fn(), onHydrate: vi.fn(), onZip: vi.fn(), onPause: vi.fn(), onConnect: vi.fn() };
    render(<PreferencesProvider><WorkbenchSyncPanel {...props} /></PreferencesProvider>);
    fireEvent.click(screen.getByRole("checkbox"));
    expect(props.onSelectedIds).toHaveBeenCalledWith(new Set([pending.id]));
    expect(screen.queryByRole("button", { name: /优先同步并用于/ })).toBeNull();expect(screen.getByText("ChatGPT",{selector:".workbench-source-platform"})).toBeVisible();
    expect(props.onPrioritize).not.toHaveBeenCalled();
  });
  it("shows a persistent file error and lets the same corrected file be selected again", () => {
    localStorage.setItem("atlas-locale", "en");
    const props = { conversations: [], importJob: { status: "failed", lastError: "No conversations.json found", failed: 0 } as ImportJob, importSource: "zip" as const, selectedIds: new Set<string>(), onSelectedIds: vi.fn(), onPrioritize: vi.fn(), onScan: vi.fn(), onHydrate: vi.fn(), onZip: vi.fn(), onPause: vi.fn(), onConnect: vi.fn() };
    render(<PreferencesProvider><WorkbenchSyncPanel {...props} /></PreferencesProvider>);
    expect(screen.getByRole("status")).toHaveTextContent("No conversations.json found");
    expect(screen.getByRole("button", { name: "Import files" })).toBeEnabled();
    const input = screen.getByLabelText("Import conversation file"), file = new File(["{}"], "conversations.json", { type: "application/json" });
    fireEvent.change(input, { target: { files: [file] } });
    fireEvent.change(input, { target: { files: [file] } });
    expect(props.onZip).toHaveBeenCalledTimes(2);
    expect(props.onZip).toHaveBeenLastCalledWith(file);
  });

  it("keeps imported materials usable while showing partial failures", () => {
    localStorage.setItem("atlas-locale", "en");
    const ready = { id: "ready", platform: "chatgpt", title: "Imported", updatedAt: 1, messageCount: 1, hydrationState: "hydrated", importState: "complete" } as Conversation;
    const props = { conversations: [ready], importJob: { status: "completed_with_warnings", completed: 1, failed: 2 } as ImportJob, importSource: "zip" as const, selectedIds: new Set<string>(), onSelectedIds: vi.fn(), onPrioritize: vi.fn(), onScan: vi.fn(), onHydrate: vi.fn(), onZip: vi.fn(), onPause: vi.fn(), onConnect: vi.fn() };
    render(<PreferencesProvider><WorkbenchSyncPanel {...props} /></PreferencesProvider>);
    expect(screen.getByRole("status")).toHaveTextContent("1 imported · 2 failed");
    fireEvent.click(screen.getByRole("checkbox"));
    expect(props.onSelectedIds).toHaveBeenCalledWith(new Set(["ready"]));
  });
  it("does not rerender material rows on progress-only updates and uses current event handlers", () => {
    localStorage.setItem("atlas-locale", "en");
    let titleReads = 0;
    const conversations: Conversation[] = Array.from({ length: 1000 }, (_, index) => ({ id: `material-${index}`, platform: "chatgpt", get title() { titleReads++; return `Material ${index}`; }, url: "", updatedAt: 1, messageCount: null, importState: "discovered" }));
    const props = { conversations, importJob: { status: "syncing", retryScope: "selected", pendingIds: ["material-20"], completed: 0, discovered: 1000 } as ImportJob, importSource: "web" as const, selectedIds: new Set<string>(), onSelectedIds: vi.fn(), onPrioritize: vi.fn(), onScan: vi.fn(), onHydrate: vi.fn(), onZip: vi.fn(), onPause: vi.fn(), onConnect: vi.fn() };
    const { container, rerender } = render(<PreferencesProvider><WorkbenchSyncPanel {...props} /></PreferencesProvider>);
    expect(container.querySelectorAll('.workbench-sync-item')).toHaveLength(8);
    expect(titleReads).toBeGreaterThan(1000);
    titleReads = 0;
    const changedSelection = vi.fn(), changedPrioritize = vi.fn();
    for (let completed = 1; completed <= 10; completed++) {
      const job = { status: "syncing", retryScope: "selected", pendingIds: ["material-20"], completed, discovered: 1000 } as ImportJob;
      rerender(<PreferencesProvider><WorkbenchSyncPanel {...props} importJob={job} onSelectedIds={changedSelection} onPrioritize={changedPrioritize} /></PreferencesProvider>);
    }
    expect(titleReads).toBe(0);
    fireEvent.click(container.querySelector<HTMLInputElement>('.workbench-sync-item input')!);
    expect(changedSelection).toHaveBeenCalledWith(new Set(["material-0"]));
    expect(props.onSelectedIds).not.toHaveBeenCalled();
    expect(screen.queryByRole("button",{name:/Prioritize and use/})).toBeNull();expect(changedPrioritize).not.toHaveBeenCalled();
  });
  it("keeps the search input focused while filtering and selects only current matches without starting sync",async()=>{
    localStorage.setItem("atlas-locale","zh-CN");
    const conversations:Conversation[]=Array.from({length:20},(_,index)=>({id:`row-${index}`,platform:"chatgpt",title:index===0?"Orama 索引":`硬件讨论 ${index}`,url:"",updatedAt:index,messageCount:null,importState:"discovered"}));
    const props={conversations,importJob:null,importSource:"web" as const,selectedIds:new Set(["row-7"]),onSelectedIds:vi.fn(),onPrioritize:vi.fn(),onScan:vi.fn(),onHydrate:vi.fn(),onZip:vi.fn(),onPause:vi.fn(),onConnect:vi.fn()};
    const {container}=render(<PreferencesProvider><WorkbenchSyncPanel {...props}/></PreferencesProvider>);
    fireEvent.click(screen.getByRole("button",{name:/加载更多/}));expect(container.querySelectorAll('.workbench-sync-item')).toHaveLength(20);
    const input=screen.getByRole("textbox",{name:"搜索对话标题"});input.focus();fireEvent.change(input,{target:{value:"Orama"}});
    await waitFor(()=>expect(container.querySelectorAll('.workbench-sync-item')).toHaveLength(1));expect(input).toHaveFocus();
    fireEvent.click(screen.getByRole("button",{name:"全选搜索结果 1 条"}));expect(props.onSelectedIds).toHaveBeenCalledWith(new Set(["row-7","row-0"]));expect(props.onHydrate).not.toHaveBeenCalled();expect(props.onScan).not.toHaveBeenCalled();
    fireEvent.change(input,{target:{value:"没有这种标题"}});await screen.findByText("没有找到相关对话");expect(screen.getByRole("button",{name:"全选搜索结果 0 条"})).toBeDisabled();expect(screen.getByRole("textbox",{name:"搜索对话标题"})).toBe(input);
    fireEvent.change(input,{target:{value:""}});await waitFor(()=>expect(container.querySelectorAll('.workbench-sync-item')).toHaveLength(8));expect(props.onSelectedIds).toHaveBeenCalledOnce();
  });
});
