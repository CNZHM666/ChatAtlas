import "fake-indexeddb/auto";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type ComponentProps } from "react";
import type { Conversation, ImportJob, OrganizationRun } from "../../shared/types";
import { PreferencesProvider } from "../preferences";
import { ReviewHome } from "./ReviewHome";
import { getDatabase } from "../../storage/db";
import { projectSession } from "../../test/project-fixture";
import { saveAISettings } from "../../storage/knowledge-graph";

vi.mock("../../ai/home-task", async importOriginal => ({ ...await importOriginal<typeof import("../../ai/home-task")>(), planHomeTask: vi.fn(async (_provider, goal: string) => ({ action: /Review|复习/iu.test(goal) ? "review" : /总结|Summarize/iu.test(goal) ? "answer" : "project", queries: [], allSources: true })), retrieveHomeTask: vi.fn(async (_plan, sources) => ({ ids: sources.map((source: Conversation) => source.id), scope: { kind: "all", sourceConversationIds: sources.map((source: Conversation) => source.id) }, pending: [], limited: false })) }));
beforeEach(async () => { await (await getDatabase()).clear("aiSettings"); });

const pending: Conversation = { id: "one", platform: "chatgpt", title: "系统极点", url: "https://chatgpt.com/c/one", updatedAt: 1, messageCount: null, importState: "discovered" };
const ready: Conversation = { ...pending, messageCount: 2, importState: "complete", hydrationState: "hydrated" };
const job: ImportJob = { id: "chatgpt-history", sessionId: "test", status: "inventory_ready", phase: "discovering", retryScope: "titles", discovered: 1, offset: 1, persisted: 1, persistedIds: [], hydrated: 0, completed: 0, failed: 0, pendingIds: ["one"], failedIds: [], startedAt: 1, updatedAt: 1, checkpoint: { sessionId: "test", discoveredIds: ["one"], persistedIds: [], failedIds: [], pendingIds: ["one"], lastCursor: "1", startedAt: 1, updatedAt: 1 } };

const base = (overrides: Partial<ComponentProps<typeof ReviewHome>> = {}): ComponentProps<typeof ReviewHome> => ({
  canvases: [], sessions: [], conversations: [], importJob: null, importSource: "web", selectedIds: new Set(), onSelectedIds: vi.fn(), onPrioritize: vi.fn(), recentReading: [], onStart: vi.fn(), onSession: vi.fn(), onResume: vi.fn(), onSpace: vi.fn(), onScan: vi.fn(), onHydrate: vi.fn(), onZip: vi.fn(), onPause: vi.fn(), onConnect: vi.fn(), onDiscover: vi.fn(), ...overrides,
});

afterEach(() => { cleanup(); vi.clearAllMocks(); localStorage.removeItem("atlas-workbench-onboarding-v1"); });
const openMaterials = () => { if (!screen.queryByRole("group", { name: "选择本次使用的对话" })) fireEvent.click(screen.getByText("来源材料与同步")); };

it("keeps diagnostic-only Wiki records and completed runs out of Continue while preserving History",()=>{
 localStorage.setItem("atlas-locale","en");
 const run:OrganizationRun={id:"analysis",title:"Overview and Wiki analysis",diagnosticOnly:true,targetType:"conversation",targetIds:[ready.id],startedAt:1,updatedAt:2,status:"failed",stage:"preparing",progress:100,events:[]};
 render(<PreferencesProvider><ReviewHome {...base({conversations:[ready],organizationRuns:[run,{...run,id:"running",status:"running"},{...run,id:"completed",diagnosticOnly:false,status:"completed"}],onTask:vi.fn(),onTaskHistory:vi.fn()})}/></PreferencesProvider>);
 expect(screen.queryByRole("heading",{name:"Continue where you left off"})).toBeNull();
 expect(screen.queryByText("Overview and Wiki analysis")).toBeNull();
 expect(screen.queryByRole("button",{name:/organization history/i})).toBeNull();
 expect(screen.getByRole("button",{name:"History"})).toBeVisible();
});

it("retains genuine failed jobs and routes only those jobs to continuation",()=>{
 localStorage.setItem("atlas-locale","en");
 const onTask=vi.fn(),run:OrganizationRun={id:"job",title:"Unfinished source organization",targetType:"conversation",targetIds:[ready.id],startedAt:1,updatedAt:2,status:"failed",stage:"preparing",progress:100,events:[]};
 render(<PreferencesProvider><ReviewHome {...base({conversations:[ready],organizationRuns:[run,{...run,id:"diagnostic",title:"Old Wiki analysis",diagnosticOnly:true}],onTask})}/></PreferencesProvider>);
 fireEvent.click(screen.getByRole("button",{name:/Unfinished source organization/}));expect(onTask).toHaveBeenCalledWith("job");
 expect(screen.queryByRole("button",{name:/Old Wiki analysis/})).toBeNull();
});

it("waits for saved projects before offering a stale task and matches an explicit legacy result ID",()=>{
 localStorage.setItem("atlas-locale","en");
 const session={...projectSession(),id:"saved-result",runId:"new-run",status:"ready" as const},task={id:"task",runId:"old-run",sessionId:session.id,goal:session.goal,mode:"work" as const,sourceIds:session.sourceConversationIds,status:"failed" as const,createdAt:1,updatedAt:2};
 const props=base({conversations:[ready],sessions:[],focusTasks:[task],projectsReady:false,onContinueTask:vi.fn()});
 const view=render(<PreferencesProvider><ReviewHome {...props}/></PreferencesProvider>);
 expect(screen.queryByRole("heading",{name:"Continue where you left off"})).toBeNull();
 view.rerender(<PreferencesProvider><ReviewHome {...props} projectsReady sessions={[session]}/></PreferencesProvider>);
 expect(screen.queryByRole("heading",{name:"Continue where you left off"})).toBeNull();
 view.rerender(<PreferencesProvider><ReviewHome {...props} projectsReady sessions={[session]} focusTasks={[{...task,sessionId:undefined}]}/></PreferencesProvider>);
 expect(screen.getByRole("heading",{name:"Continue where you left off"})).toBeVisible();
});

describe("workbench sync", () => {
  it("resumes a confirmed task directly while preserving the larger selected retrieval pool", () => {
    localStorage.setItem("atlas-locale", "zh-CN");
    const selectedIds = new Set(["one", "two"]);
    const resumeTask = { id: "resume", runId: "same-run", goal: "整理项目", mode: "work" as const, sourceIds: ["one"], scope: { kind: "all" as const, sourceConversationIds: ["one"] }, status: "paused" as const, createdAt: 1, updatedAt: 1 };
    const props = base({ conversations: [ready, { ...ready, id: "two" }], selectedIds, resumeTask, draft: { goal: resumeTask.goal, mode: "review" } });
    render(<PreferencesProvider><ReviewHome {...props} /></PreferencesProvider>);
    fireEvent.click(screen.getByRole("button", {name:/开始整理|搜索历史|开始复习/}));
    expect(props.onStart).toHaveBeenCalledWith(resumeTask.goal, "work", ["one"], resumeTask.scope, ["one", "two"]);
    expect(props.onSelectedIds).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
  it("opens the workspace without the retired dialog or another source picker", async () => {
    localStorage.setItem("atlas-locale", "zh-CN");
    const props = base({ conversations: [{ ...ready, title: "Control" }], selectedIds: new Set([ready.id]), draft: { goal: "Control", mode: "work" } });
    render(<PreferencesProvider><ReviewHome {...props} /></PreferencesProvider>);
    fireEvent.click(screen.getByRole("button", { name:/开始整理|搜索历史|开始复习/ }));
    expect(await screen.findByRole("heading", { name: "找回历史对话" })).toBeVisible();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(props.onStart).not.toHaveBeenCalled(); expect(props.onSelectedIds).not.toHaveBeenCalled();
  });
  it("places the source heading outside the card with one selection status and no duplicate organize button", () => {
    localStorage.setItem("atlas-locale", "zh-CN");
    const props = base({ conversations: [ready], selectedIds: new Set([ready.id]), importJob: { ...job, status: "completed", retryScope: "full", completed: 1 } });
    const { container } = render(<PreferencesProvider><ReviewHome {...props} /></PreferencesProvider>);
    const heading = screen.getByRole("heading", { name: "来源材料与同步" });
    expect(heading.closest(".workbench-materials")).toBeNull();
    expect(container.querySelector(".workbench-sync-heading")).toBeEmptyDOMElement();expect(screen.queryByText("同步完成 · 1 条可用 · 已选 1 条")).toBeNull();
    expect(screen.queryByRole("button", { name: /整理已选/ })).not.toBeInTheDocument();
    expect(container.querySelector(".workbench-materials-label")).toBeNull();
    expect(screen.getByRole("button", { name: "来源材料与同步" })).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(screen.getByRole("button", { name: "来源材料与同步" }));
    expect(screen.getByRole("checkbox", { name: /系统极点/ })).toBeChecked();
  });
  it("keeps legacy projects resumable without pending task counts", () => {
    localStorage.setItem("atlas-locale", "zh-CN");
    const project = projectSession();
    const props = base({ sessions: [project] });
    render(<PreferencesProvider><ReviewHome {...props} /></PreferencesProvider>);
    // A saved project needs no tag; only a preview still to confirm says so.
    expect(screen.queryByText("待确认预览")).toBeNull();
    expect(screen.queryByText("方案草稿")).toBeNull();
    expect(screen.queryByText(/项待完成/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: new RegExp(project.title) }));
    expect(props.onSession).toHaveBeenCalledWith(project.id);
    expect(project.projectState?.actions).toHaveLength(1);
  });
  it("exposes history and layout example without demo generation", () => {
    localStorage.setItem("atlas-locale", "zh-CN");
    const props = base({ selectedIds: new Set([ready.id]), conversations: [ready] });
    render(<PreferencesProvider><ReviewHome {...props} /></PreferencesProvider>);
    expect(screen.queryByRole("button", { name: "体验示例" })).toBeNull();
    expect(screen.getByRole("button", { name: "历史记录" })).toBeVisible();
    expect(screen.getByRole("button", { name: "示例项目" })).toBeVisible();
    expect(props.onStart).not.toHaveBeenCalled();
    expect(props.onSelectedIds).not.toHaveBeenCalled();
  });
  it("keeps source selection and pending sync available without a document guide", () => {
    localStorage.setItem("atlas-locale", "zh-CN");
    const props = base({ conversations: [ready, { ...pending, id: "pending" }], selectedIds: new Set(["pending"]) });
    render(<PreferencesProvider><ReviewHome {...props} /></PreferencesProvider>);
    expect(screen.queryByRole("button", { name: "新手指引" })).toBeNull();
    expect(props.onHydrate).not.toHaveBeenCalled(); expect(props.onStart).not.toHaveBeenCalled();
    openMaterials();
    const list = screen.getByRole("group", { name: "选择本次使用的对话" });
    expect(within(list).getAllByRole("checkbox").filter(node => (node as HTMLInputElement).checked)).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "同步所选 1 条" }));
    expect(props.onHydrate).toHaveBeenCalledWith(["pending"]);
    expect(props.onSelectedIds).not.toHaveBeenCalled();
  });
  it("opens the isolated layout example from home without changing the current view", () => {
    localStorage.setItem("atlas-locale", "zh-CN");
    const props = base({ conversations: [ready], selectedIds: new Set([ready.id]), draft: { goal: "继续验证检索", mode: "work" } });
    render(<PreferencesProvider><ReviewHome {...props} /></PreferencesProvider>);
    fireEvent.click(screen.getByRole("button", { name: "示例项目" }));
    expect(screen.getByRole("region", { name: "示例项目工作区" })).toBeVisible();
    expect(screen.queryByRole("slider")).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "搜索或整理历史对话" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "退出示例" }));
    expect(screen.getByRole("textbox", { name: "搜索或整理历史对话" })).toHaveValue("继续验证检索");
    expect(screen.queryByRole("main", { name: "新手指引" })).toBeNull();
    expect(props.onStart).not.toHaveBeenCalled(); expect(props.onSelectedIds).not.toHaveBeenCalled(); expect(props.onHydrate).not.toHaveBeenCalled();
  });
  it("keeps a natural task in its workspace until AI is connected, then proceeds without another selection", async () => {
    localStorage.setItem("atlas-locale", "en");
    const db = await getDatabase(); await db.clear("aiSettings");
    const onConfigureAI = vi.fn(), props = base({ conversations: [{ ...ready, title: "Control poles" }], selectedIds: new Set([ready.id]), draft: { goal: "Review poles", mode: "review" }, onConfigureAI });
    render(<PreferencesProvider><ReviewHome {...props} /></PreferencesProvider>);
    fireEvent.click(screen.getByRole("button", { name:/Organize project|Search history|Review/ }));
    expect(await screen.findByRole("heading", { name: "Task workspace" })).toBeVisible();
    expect(onConfigureAI).not.toHaveBeenCalled(); expect(props.onStart).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole("button", { name: "Configure model" }));
    expect(onConfigureAI).toHaveBeenCalledOnce();
    expect(screen.getByText("Review poles")).toBeVisible();
    await saveAISettings({ mode: "byok", provider: "openai", baseUrl: "https://fixture.example/v1", apiKey: "fixture", model: "fixture" });
    await screen.findByRole("combobox", { name: "Choose generation AI" });
    await waitFor(() => expect(props.onStart).toHaveBeenCalledWith("Review poles", "work", [ready.id], {kind:"all",sourceConversationIds:[ready.id]}, [ready.id]));
    expect(props.onSelectedIds).not.toHaveBeenCalled();
    await db.clear("aiSettings");
  });
  it("shows unfinished jobs but replaces them with their saved previews", () => {
    localStorage.setItem("atlas-locale", "en");
    const task = { id: "job", runId: "run", goal: "Review failed project", mode: "work" as const, sourceIds: ["one"], status: "failed" as const, createdAt: 1, updatedAt: 1 };
    const onContinueTask = vi.fn();
    const props = base({ focusTasks: [task], onContinueTask });
    const { rerender } = render(<PreferencesProvider><ReviewHome {...props} /></PreferencesProvider>);
    fireEvent.click(screen.getByRole("button", { name: /Review failed project.*Continue generation/ }));
    expect(onContinueTask).toHaveBeenCalledWith(task);
    const preview = { id: "result", runId: "run", status: "preview" as const, goal: task.goal, mode: task.mode, title: "Finished project", sourceConversationIds: ["one"], sections: [], evidence: [], activeSectionId: "", completedSectionIds: [], notes: "", createdAt: 1, updatedAt: 2 };
    rerender(<PreferencesProvider><ReviewHome {...props} sessions={[preview]} /></PreferencesProvider>);
    expect(screen.queryByText("Review failed project")).not.toBeInTheDocument();
    expect(screen.getByText("Finished project")).toBeVisible();
  });
  it("keeps an unaccepted completed preview available under Continue reading", () => {
    localStorage.setItem("atlas-locale", "en");
    const onSession = vi.fn();
    const preview = { id: "pending-preview", status: "preview" as const, goal: "Review", mode: "review" as const, title: "My previous project", sourceConversationIds: ["one"], sections: [], evidence: [], activeSectionId: "", completedSectionIds: [], notes: "", createdAt: 1, updatedAt: 1 };
    render(<PreferencesProvider><ReviewHome {...base({ sessions: [preview], conversations: [ready], onSession })} /></PreferencesProvider>);
    expect(screen.getByText("Preview ready")).toBeVisible();
    expect(screen.queryByText(/Last chapter:/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /My previous project/ }));
    expect(onSession).toHaveBeenCalledWith("pending-preview");
  });
  it("opens a lookup workspace without forcing project generation or changing sources", async () => {
    localStorage.setItem("atlas-locale", "zh-CN");
    const props = base({ conversations: [{ ...ready, title: "Hardware" }], selectedIds: new Set([ready.id]), draft: { goal: "Hardware", mode: "work" } });
    render(<PreferencesProvider><ReviewHome {...props} /></PreferencesProvider>);
    fireEvent.click(screen.getByRole("button", { name:/开始整理|搜索历史|开始复习/ }));
    expect(await screen.findByRole("heading", { name: "找回历史对话" })).toBeVisible();
    expect(props.onStart).not.toHaveBeenCalled(); expect(props.onSelectedIds).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "返回" }));
    expect(screen.getByRole("textbox", { name: "搜索或整理历史对话" })).toHaveValue("Hardware");
  });
  it("shows one project after four modifications, with earlier versions available on demand", () => {
    localStorage.setItem("atlas-locale", "zh-CN");
    const sessions = Array.from({ length: 4 }, (_, index) => ({ id: `version-${index}`, goal: "回顾项目", mode: "work" as const, title: "同一个项目", sourceConversationIds: ["one"], sections: [], evidence: [], activeSectionId: "", completedSectionIds: [], notes: "", createdAt: index + 1, updatedAt: index + 1 }));
    const onSession = vi.fn();
    render(<PreferencesProvider><ReviewHome {...base({ sessions, conversations: [ready], onSession })} /></PreferencesProvider>);
    const visibleProjects = screen.getAllByRole("button", { name: /同一个项目/ });
    expect(visibleProjects).toHaveLength(1);
    fireEvent.click(visibleProjects[0]); expect(onSession).toHaveBeenLastCalledWith("version-3");
    fireEvent.click(screen.getByLabelText("历史版本 3"));
    const previous = screen.getAllByRole("button", { name: /同一个项目.*版本/ });
    expect(previous).toHaveLength(3);
    fireEvent.click(previous[2]); expect(onSession).toHaveBeenLastCalledWith("version-0");
  });
  it("clears selected materials across hidden search results in one action", () => {
    localStorage.setItem("atlas-locale", "zh-CN");
    const conversations = Array.from({ length: 30 }, (_, index) => ({ ...ready, id: `ready-${index}`, title: index === 0 ? "只显示这一条" : `其他对话 ${index}` }));
    const onSelectedIds = vi.fn();
    render(<PreferencesProvider><ReviewHome {...base({ conversations, selectedIds: new Set(conversations.map((item) => item.id)), onSelectedIds })} /></PreferencesProvider>);
    openMaterials();
    fireEvent.change(screen.getByRole("textbox", { name: "搜索对话标题" }), { target: { value: "只显示" } });
    fireEvent.click(screen.getByRole("button", { name: "清空已选 30 条" }));
    expect(onSelectedIds).toHaveBeenLastCalledWith(new Set());
  });

  it("does not reserve an empty sync status row", () => {
    const { container } = render(<PreferencesProvider><ReviewHome {...base({ conversations: [pending] })} /></PreferencesProvider>);
    expect(container.querySelector(".workbench-sync-status-slot")).toBeNull();
  });
  it("uses the single History entry instead of the retired organization-history shortcut", () => {
    localStorage.setItem("atlas-locale", "en");
    const props = base({ organizationRuns: [{ id: "old-run" } as OrganizationRun], onTaskHistory: vi.fn() });
    render(<PreferencesProvider><ReviewHome {...props} /></PreferencesProvider>);
    expect(screen.queryByRole("button", { name: "View organization history (1)" })).toBeNull();
    fireEvent.click(screen.getByRole("button",{name:"History"}));
    expect(screen.getByRole("heading",{name:"History"})).toBeVisible();
    expect(props.onTaskHistory).not.toHaveBeenCalled();
  });

  it("prioritizes first import, distinguishes title discovery from messages, and preserves a hidden draft", () => {
    localStorage.setItem("atlas-locale", "zh-CN");
    const props = base({draft:{goal:"复习控制理论",mode:"review"}});
    const { rerender } = render(<PreferencesProvider><ReviewHome {...props} /></PreferencesProvider>);
    expect(screen.getByRole("heading",{name:"让过去的 AI 对话，重新发挥价值"})).toBeVisible();
    expect(screen.queryByRole("textbox", {name:"搜索或整理历史对话"})).toBeNull();
    expect(screen.queryByText("为你发现")).toBeNull();
    expect(screen.queryByRole("button",{name:"配置模型"})).toBeNull();
    expect(screen.queryByText(/ChatGPT/)).toBeNull();
    expect(screen.getByRole("button",{name:"导入对话文件"})).toHaveTextContent("ZIP / JSON / Markdown / TXT");
    fireEvent.click(screen.getByRole("button",{name:"导入"})); expect(props.onScan).toHaveBeenCalledOnce();
    rerender(<PreferencesProvider><ReviewHome {...props} conversations={[pending]} importJob={{...job,status:"inventory_ready",retryScope:"titles"}} /></PreferencesProvider>);
    expect(screen.getByText(/同步正文后即可全文搜索/)).toBeVisible();
    rerender(<PreferencesProvider><ReviewHome {...props} conversations={[pending]} importJob={{...job,status:"syncing",phase:"syncing",retryScope:"selected",activeIds:[pending.id]}} /></PreferencesProvider>);
    const status=screen.getByRole("status");
    expect(status.closest(".home-import-meta")).not.toBeNull();
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(screen.queryByRole("textbox", {name:"搜索或整理历史对话"})).toBeNull();
    rerender(<PreferencesProvider><ReviewHome {...props} conversations={[ready]} /></PreferencesProvider>);
    expect(screen.getByRole("heading",{name:"今天想找回或继续什么？"})).toBeVisible();
    expect(screen.getByRole("textbox",{name:"搜索或整理历史对话"})).toHaveValue("复习控制理论");
    expect(props.onStart).not.toHaveBeenCalled();
  });

  it("selects every matching title, including results beyond the initial rows", () => {
    localStorage.setItem("atlas-locale", "zh-CN");
    const conversations = Array.from({ length: 10 }, (_, index) => ({ ...pending, id: `item-${index}`, title: index === 9 ? "项目管理" : `系统主题 ${index}` }));
    const onSelectedIds = vi.fn();
    const props = base({ conversations, onSelectedIds });
    const { rerender } = render(<PreferencesProvider><ReviewHome {...props} /></PreferencesProvider>);
    fireEvent.click(screen.getByRole("button", { name: "全选 10 条" }));
    expect(onSelectedIds).toHaveBeenLastCalledWith(new Set(conversations.map((item) => item.id)));
    fireEvent.change(screen.getByRole("textbox", { name: "搜索对话标题" }), { target: { value: "系统" } });
    fireEvent.click(screen.getByRole("button", { name: "全选搜索结果 9 条" }));
    expect(onSelectedIds).toHaveBeenLastCalledWith(new Set(conversations.slice(0, 9).map((item) => item.id)));
    rerender(<PreferencesProvider><ReviewHome {...props} selectedIds={new Set(conversations.map((item) => item.id))} /></PreferencesProvider>);
    fireEvent.click(screen.getByRole("button", { name: "取消全选" }));
    expect(onSelectedIds).toHaveBeenLastCalledWith(new Set(["item-9"]));
  });

  it("keeps the home composer and material filter mounted while previewing the example", () => {
    localStorage.setItem("atlas-locale", "zh-CN");
    const props = base({ conversations: [ready, { ...pending, id: "other", title: "另一条材料" }], selectedIds: new Set(["one"]) });
    render(<PreferencesProvider><ReviewHome {...props} /></PreferencesProvider>);
    fireEvent.change(screen.getByRole("textbox", { name: "搜索或整理历史对话" }), { target: { value: "复习系统极点" } });
    openMaterials();
    fireEvent.change(screen.getByRole("textbox", { name: "搜索对话标题" }), { target: { value: "系统" } });
    const composer = screen.getByRole("textbox", { name: "搜索或整理历史对话" });
    fireEvent.click(screen.getByRole("button", { name: "示例项目" }));
    fireEvent.click(screen.getByRole("button", { name: "退出示例" }));
    expect(screen.getByRole("textbox", { name: "搜索或整理历史对话" })).toBe(composer);
    expect(composer).toHaveValue("复习系统极点");
    expect(screen.getByRole("textbox", { name: "搜索对话标题" })).toHaveValue("系统");
    expect(screen.getByRole("button", { name: "来源材料与同步" })).toHaveAttribute("aria-expanded", "true");
    expect(props.onStart).not.toHaveBeenCalled(); expect(props.onSelectedIds).not.toHaveBeenCalled();
  });
  it("filters synced and pending sources and limits initial rows", () => {
    localStorage.setItem("atlas-locale", "zh-CN");
    const conversations = [ready, ...Array.from({ length: 10 }, (_, index) => ({ ...pending, id: `pending-${index}`, title: `待处理 ${index}` }))];
    render(<PreferencesProvider><ReviewHome {...base({ conversations })} /></PreferencesProvider>);
    openMaterials();
    const list = screen.getByRole("group", { name: "选择本次使用的对话" });
    expect(list.querySelectorAll("label")).toHaveLength(8);
    fireEvent.click(screen.getByRole("tab", { name: "已同步 1" }));
    expect(list).toHaveTextContent("系统极点");
    expect(list).not.toHaveTextContent("待处理 0");
    fireEvent.click(screen.getByRole("tab", { name: "待同步 10" }));
    expect(list).not.toHaveTextContent("系统极点");
    expect(list).toHaveTextContent("待处理 0");
    expect(screen.queryByText(/已选\s*\d+\s*条，\s*\d+\s*条已同步/)).not.toBeInTheDocument();
  });

  it("keeps the Workbench scroll position and material viewport mounted while searching", () => {
    localStorage.setItem("atlas-locale", "zh-CN");
    const conversations = Array.from({ length: 12 }, (_, index) => ({ ...ready, id: `item-${index}`, title: index === 11 ? "目标对话" : `历史对话 ${index}` }));
    const { container } = render(<PreferencesProvider><ReviewHome {...base({ conversations })} /></PreferencesProvider>);
    const home = container.querySelector<HTMLElement>(".review-home")!;
    openMaterials();
    const viewport = container.querySelector<HTMLElement>(".workbench-sync-list-viewport")!;
    home.scrollTop = 320;
    fireEvent.change(screen.getByRole("textbox", { name: "搜索对话标题" }), { target: { value: "目标对话" } });
    expect(home.scrollTop).toBe(320);
    expect(container.querySelector(".workbench-sync-list-viewport")).toBe(viewport);
    expect(viewport).toHaveTextContent("目标对话");
  });

  it("removes the guide entry and view on both first and later visits", () => {
    localStorage.setItem("atlas-locale", "zh-CN");
    localStorage.setItem("atlas-workbench-onboarding-v1", "dismissed");
    const props = base();
    const { unmount, container } = render(<PreferencesProvider><ReviewHome {...props} /></PreferencesProvider>);
    expect(container.querySelector(".home-worklist")).toBeNull();
    expect(screen.queryByRole("button", { name: "新手指引" })).toBeNull();
    expect(screen.queryByRole("main", { name: "新手指引" })).toBeNull();
    unmount();
    render(<PreferencesProvider><ReviewHome {...props} /></PreferencesProvider>);
    expect(screen.queryByRole("main", { name: "新手指引" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "新手指引" })).toBeNull();
    expect(screen.getByRole("region", { name: "同步与选择对话" })).toBeInTheDocument();
  });
  it("prioritizes chosen pending sources while a batch is running", () => {
    localStorage.setItem("atlas-locale", "zh-CN");
    const props = base({ conversations: [pending], selectedIds: new Set([pending.id]), importJob: { ...job, status: "syncing", phase: "syncing", retryScope: "selected" } });
    render(<PreferencesProvider><ReviewHome {...props} /></PreferencesProvider>);
    fireEvent.click(screen.getByRole("button", { name: "优先同步所选 1 条" }));
    expect(props.onHydrate).toHaveBeenCalledWith([pending.id]);
  });

  it("shows the real platform instead of priority buttons while syncing the same chosen sources", () => {
    localStorage.setItem("atlas-locale", "zh-CN");
    const conversations = [pending, { ...pending, id: "other", title: "另一条对话" }];
    const props = base({ conversations, selectedIds: new Set(conversations.map((item) => item.id)), importJob: { ...job, status: "syncing", phase: "syncing", retryScope: "selected" } });
    render(<PreferencesProvider><ReviewHome {...props} /></PreferencesProvider>);
    expect(screen.queryByRole("button",{name:/优先同步并用于/})).toBeNull();fireEvent.click(screen.getByRole("button", { name: "优先同步所选 2 条" }));
    expect(props.onPrioritize).not.toHaveBeenCalled();
    expect(props.onSelectedIds).not.toHaveBeenCalled();
    expect(props.onHydrate).toHaveBeenCalledWith(conversations.map(item=>item.id));
  });

  it("keeps sync focused on the user's selection instead of offering a competing bulk action", () => {
    localStorage.setItem("atlas-locale", "zh-CN");
    const props = base({ conversations: [{ ...pending, id: "newer", updatedAt: 20 }, pending], selectedIds: new Set([pending.id]) });
    render(<PreferencesProvider><ReviewHome {...props} /></PreferencesProvider>);
    expect(screen.queryByRole("button", { name: "同步全部 2 条" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "同步所选 1 条" }));
    expect(props.onHydrate).toHaveBeenCalledWith([pending.id]);
    expect(props.onSelectedIds).not.toHaveBeenCalled();
  });

  it("keeps recent sources first without a duplicate heading count or sort control", () => {
    localStorage.setItem("atlas-locale", "zh-CN");
    const conversations = [ready, { ...ready, id: "recent", title: "最近对话", updatedAt: 30, messageCount: 3 }, { ...ready, id: "long", title: "长对话", updatedAt: 20, messageCount: 12 }];
    render(<PreferencesProvider><ReviewHome {...base({ conversations })} /></PreferencesProvider>);
    openMaterials();
    const list = screen.getByRole("group", { name: "选择本次使用的对话" });
    const titles = () => [...list.querySelectorAll("label > span")].map((item) => item.textContent);
    expect(titles()).toEqual(["最近对话", "长对话", "系统极点"]);
    expect(screen.queryByRole("combobox", { name: "对话材料排序" })).not.toBeInTheDocument();
    expect(screen.queryByText(/条标题 ·/)).not.toBeInTheDocument();
  });
});

it("opens the task workspace with the candidate pool without auto-saving", async () => {
  const onSelectedIds = vi.fn(), onStart = vi.fn();
  const conversations = ["海报设计需求", "海报设计修改", "无关课程学习"].map((title, index) => ({ ...ready, id: `candidate-${index}`, title }));
  const props = base({ conversations, selectedIds: new Set(conversations.map(item => item.id)), onSelectedIds, onStart });
  render(<PreferencesProvider><ReviewHome {...props} experimentalActions /></PreferencesProvider>);
  const db=await getDatabase(),evidence=[];
  const {sourceMessageSignature}=await import("../../shared/source-signature");
  for(const source of conversations.slice(0,2)){const content="海报设计需求与修改";await db.put("conversations",source);await db.put("messages",{id:`${source.id}:proof`,conversationId:source.id,role:"user",messageIndex:0,content,contentHash:"",preview:"",createdAt:1,updatedAt:1});evidence.push({id:source.id,conversationId:source.id,messageId:`${source.id}:proof`,title:source.title,excerpt:content,sourceSignature:sourceMessageSignature(content)});}
  vi.spyOn(await import("../../ai/history-discovery"), "recommendHistory").mockResolvedValue([{title:"海报设计",kind:"project",sourceIds:["candidate-0","candidate-1"],basis:"recommendation",reason:"同一个海报项目",evidence}]);
  await saveAISettings({ mode: "byok", provider: "openai", baseUrl: "https://fixture.example/v1", apiKey: "fixture", model: "fixture" });
  fireEvent.click(screen.getByRole("button", { name:"发现整理主题",hidden:true }));
  fireEvent.change(screen.getByRole("textbox",{name:"搜索或整理历史对话"}),{target:{value:"发现可以继续的海报设计项目"}});
  fireEvent.click(screen.getByRole("button",{name:"发现主题"}));
  fireEvent.click(await screen.findByRole("button", { name: /海报设计.*整理项目/ }));
  expect(await screen.findByRole("heading", { name: "帮我整理成一个项目：海报设计" })).toBeInTheDocument();
  expect(onSelectedIds).toHaveBeenCalledWith(new Set(["candidate-0", "candidate-1"]));
  await waitFor(() => expect(onStart).toHaveBeenCalledWith("帮我整理成一个项目：海报设计", "work", ["candidate-0", "candidate-1"], { kind: "all", sourceConversationIds: ["candidate-0", "candidate-1"] }, ["candidate-0", "candidate-1"]));

});
