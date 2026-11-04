import "fake-indexeddb/auto";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { recordAIUsage } from "../../storage/ai-usage";
import { saveConversation } from "../../storage/conversations";
import { getOrganizationRun, saveOrganizationRun } from "../../storage/organization-runs";
import { saveAnalysisDiagnostics } from "../../ai/semantic-analysis";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PreferencesProvider, usePreferences } from "../preferences";
import { SettingsPanel } from "./SettingsPanel";
import { getDatabase } from "../../storage/db";
import { getAISettings } from "../../storage/knowledge-graph";

afterEach(async () => { cleanup(); vi.unstubAllGlobals(); await (await getDatabase()).clear("aiSettings"); });

describe("data privacy settings", () => {
  it("ignores an old provider's model response after switching providers", async () => {
    localStorage.setItem("atlas-locale", "zh-CN");
    let resolveOld!: (response: Response) => void;
    const fetchMock = vi.fn().mockImplementationOnce(() => new Promise<Response>((resolve) => { resolveOld = resolve; })).mockResolvedValueOnce(new Response(JSON.stringify({ output: { total: 1, models: [{ model: "qwen3.8-flash", name: "Qwen3.8-Flash" }] } })));
    vi.stubGlobal("fetch", fetchMock);
    render(<PreferencesProvider><SettingsPanel initialTab="ai" onClose={vi.fn()} /></PreferencesProvider>);
    fireEvent.change(screen.getByLabelText("服务商"), { target: { value: "deepseek" } });
    fireEvent.change(screen.getByLabelText("API Key"), { target: { value: "fixture" } });
    fireEvent.click(screen.getByRole("button", { name: "读取模型" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    fireEvent.change(screen.getByLabelText("服务商"), { target: { value: "qwen" } });
    fireEvent.change(screen.getByLabelText("API Key"), { target: { value: "other-fixture" } });
    fireEvent.click(screen.getByRole("button", { name: "读取模型" }));
    await screen.findAllByRole("option", { name: "Qwen3.8-Flash · qwen3.8-flash" });
    resolveOld(new Response(JSON.stringify({ data: [{ id: "old-deepseek-id" }] })));
    await waitFor(() => expect(screen.queryByRole("option", { name: "old-deepseek-id" })).not.toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("模型"), { target: { value: "qwen3.8-flash" } });
    fireEvent.click(screen.getByRole("button", { name: /保存/ }));
    await waitFor(async () => expect(await getAISettings()).toMatchObject({ provider: "qwen", model: "qwen3.8-flash" }));
  });

  it("allows a documented model ID when a gateway has no model discovery endpoint", async () => {
    localStorage.setItem("atlas-locale", "zh-CN");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("route not found", { status: 404 })));
    render(<PreferencesProvider><SettingsPanel initialTab="ai" onClose={vi.fn()} /></PreferencesProvider>);
    fireEvent.change(screen.getByLabelText("服务商"), { target: { value: "openai-compatible" } });
    fireEvent.change(screen.getByLabelText("Base URL"), { target: { value: "https://gateway.example/v1" } });
    fireEvent.change(screen.getByLabelText("API Key"), { target: { value: "fixture" } });
    fireEvent.click(screen.getByRole("button", { name: "读取模型" }));
    await screen.findByText("所选模型或接口不可用，请在 AI 设置中核对。");
    fireEvent.click(screen.getByText("更多模型选项"));
    fireEvent.change(screen.getByLabelText("主模型 ID"), { target: { value: "Vendor/Qwen3.8-Flash" } });
    fireEvent.click(screen.getByRole("button", { name: /保存/ }));
    await waitFor(async () => expect(await getAISettings()).toMatchObject({ model: "Vendor/Qwen3.8-Flash", baseUrl: "https://gateway.example/v1" }));
  });
  it("shows a compact privacy summary with the full explanation on demand", () => {
    localStorage.setItem("atlas-locale", "en");
    render(<PreferencesProvider><SettingsPanel onClose={vi.fn()} /></PreferencesProvider>);
    expect(screen.getByRole("heading", { name: "Data & Privacy", level: 3 })).toBeVisible();
    expect(screen.getByRole("navigation", { name: "Settings" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Settings", level: 2 })).toBeVisible();
    expect(screen.getByText("This browser on this device")).toBeVisible();
    expect(screen.getByText("Task content is sent directly to your chosen provider")).toBeVisible();
    fireEvent.click(screen.getByText("How data is handled"));
    expect(screen.getByText(/IndexedDB/)).toBeVisible();
    expect(screen.getByText(/does not currently sync your knowledge library/)).toBeVisible();
  });

  it("uses provider presets and a fetched-model selector instead of free text", () => {
    localStorage.setItem("atlas-locale", "zh-CN");
    const { container } = render(<PreferencesProvider><SettingsPanel initialTab="ai" onClose={vi.fn()} /></PreferencesProvider>);
    expect(container.querySelector(".settings-panel > .settings-tabs")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "AI 整理" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "设置" })).toBeVisible();
    const provider = screen.getByLabelText("服务商") as HTMLSelectElement;
    expect([...provider.options].map((option) => option.text)).toEqual(expect.arrayContaining([
      "DeepSeek", "通义千问 / 阿里云百炼", "Kimi / 月之暗面", "百度智能云千帆", "火山引擎方舟 / 豆包", "腾讯云 TokenHub / 混元",
    ]));
    fireEvent.change(provider, { target: { value: "deepseek" } });
    // Three steps: the model list waits for a key, extra model choices are folded, semantic understanding is visible.
    expect(screen.getByRole("button", { name: /先填写 API 密钥/ })).toBeDisabled();
    expect(screen.queryByLabelText("模型")).toBeNull();
    expect(screen.getByText("更多模型选项").closest("details")).not.toHaveAttribute("open");
    expect(screen.getByLabelText("经济模型")).not.toBeVisible();
    expect(screen.getByRole("heading", { name: "语义理解" })).toBeVisible();
    // DeepSeek has no documented embedding model: the field is open for one.
    expect(screen.getByLabelText("向量模型 ID")).toBeVisible();
    fireEvent.change(provider, { target: { value: "qwen" } });
    fireEvent.click(screen.getByRole("button", { name: "开启（使用 text-embedding-v4）" }));
    expect(screen.getByText("已开启 · text-embedding-v4")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "关闭语义理解" }));
    expect(screen.getByRole("button", { name: "开启（使用 text-embedding-v4）" })).toBeVisible();
    expect(screen.queryByLabelText("Base URL")).not.toBeVisible();
    expect(screen.getByText("高级设置 · 可选").closest("details")).not.toHaveAttribute("open");
    fireEvent.click(screen.getByText("高级设置 · 可选"));
    expect(screen.getByLabelText("Base URL")).toBeVisible();
  });

  it("loads selectable model ids from the selected provider", async () => {
    localStorage.setItem("atlas-locale", "zh-CN");
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [{ id: "new-deepseek-model" }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<PreferencesProvider><SettingsPanel initialTab="ai" onClose={vi.fn()} /></PreferencesProvider>);
    fireEvent.change(screen.getByLabelText("服务商"), { target: { value: "deepseek" } });
    fireEvent.change(screen.getByLabelText("API Key"), { target: { value: "test-secret" } });
    fireEvent.click(screen.getByRole("button", { name: "读取模型" }));

    await waitFor(() => expect((screen.getByLabelText("模型") as HTMLSelectElement).querySelector('option[value="new-deepseek-model"]')).toBeInTheDocument());
    expect(screen.getByLabelText("模型")).toBeEnabled();
    expect((screen.getByLabelText("经济模型") as HTMLSelectElement).querySelector('option[value="new-deepseek-model"]')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith("https://api.deepseek.com/v1/models", expect.any(Object));
  });
  it("shows attributed conversation tokens and keeps batch planning in a shared bucket", async () => {
    localStorage.setItem("atlas-locale", "zh-CN");
    await saveConversation({ id: "ledger-conversation", platform: "chatgpt", title: "账单测试对话", url: "https://chatgpt.com/c/ledger-conversation", messageCount: 1, updatedAt: 1 });
    await recordAIUsage({ id: "ledger-single", createdAt: 1, taskType: "chapter_planning", providerId: "openai", modelId: "test", conversationIds: ["ledger-conversation"], inputTokens: 100, outputTokens: 20, tokenSource: "provider", status: "completed", attempt: 1 });
    await recordAIUsage({ id: "ledger-shared", createdAt: 2, taskType: "global_merge", providerId: "openai", modelId: "test", conversationIds: ["ledger-conversation", "another"], inputTokens: 50, outputTokens: 10, tokenSource: "estimated", status: "completed", attempt: 1 });
    render(<PreferencesProvider><SettingsPanel onClose={vi.fn()} /></PreferencesProvider>);
    fireEvent.click(screen.getByText("使用记录"));
    await screen.findByRole("button",{name:"按对话"});
    expect(screen.getByText("对话整理")).toBeVisible();
    expect(screen.getByText("知识整理")).toBeVisible();
    fireEvent.click(screen.getByRole("button",{name:"按对话"}));
    expect(await screen.findByText("账单测试对话")).toBeVisible();
    expect(screen.getByText("跨对话任务")).toBeVisible();
    expect(screen.queryByText("统计说明")).toBeNull();
    expect(screen.queryByText("按对话查看")).toBeNull();
  });

  it("shows run-level developer metrics and saves a manual result evaluation", async () => {
    localStorage.setItem("atlas-locale", "zh-CN");
    const runId = crypto.randomUUID();
    await saveOrganizationRun({ id: runId, title: "测试整理任务", targetType: "conversation", targetIds: ["conversation-test"], startedAt: Date.now(), updatedAt: Date.now(), status: "waiting_review", stage: "proposal_ready", progress: 100, events: [] });
    await recordAIUsage({ id: crypto.randomUUID(), runId, durationMs: 1200, createdAt: Date.now(), taskType: "chapter_planning", providerId: "openai", modelId: "test", conversationIds: ["conversation-test"], inputTokens: 100, outputTokens: 20, tokenSource: "provider", status: "completed", attempt: 1 });
    await saveAnalysisDiagnostics({ id: crypto.randomUUID(), runId, createdAt: Date.now(), questionsAnalyzed: 4, cachedQuestionsReused: 1, rawMessagesLoaded: 4, aiRequests: 1, estimatedInputTokens: 0, estimatedOutputTokens: 0, relationsVerified: 0, bridgesGenerated: 0, questionCount: 5, topicCount: 2, relationCount: 1, bridgeCount: 0 });
    render(<PreferencesProvider><SettingsPanel onClose={vi.fn()} /></PreferencesProvider>);
    fireEvent.click(screen.getByText("使用记录"));
    fireEvent.click(await screen.findByRole("button", { name: "任务诊断" }));
    const title = await screen.findByText("测试整理任务");
    fireEvent.click(title);
    // Details render once the run is opened; the toggle event arrives asynchronously.
    const metrics=await waitFor(()=>{const node=title.closest("details")!.querySelector(".developer-analysis-metrics");if(!node)throw new Error("details not rendered");return node as HTMLElement;});
    expect(within(metrics).getByText("请求累计耗时")).toBeVisible();
    expect(within(metrics).getByText("1.2 s")).toBeVisible();
    fireEvent.click(screen.getByText("评价与备注"));
    fireEvent.change(screen.getByLabelText("结果评分（人工，1–5）"), { target: { value: "4" } });
    fireEvent.change(screen.getByLabelText("测试备注"), { target: { value: "章节分组基本正确" } });
    fireEvent.click(screen.getByRole("button", { name: "保存评价" }));
    await waitFor(async () => expect((await getOrganizationRun(runId))?.evaluation).toEqual({ score: 4, note: "章节分组基本正确" }));
  });
});

it("translates an existing validation notice when the language changes",async()=>{
 localStorage.setItem("atlas-locale","zh-CN");
 function Preview(){const {setLocale}=usePreferences();return <><button onClick={()=>setLocale("en")}>English</button><SettingsPanel initialTab="ai" onClose={vi.fn()}/></>;}
 render(<PreferencesProvider><Preview/></PreferencesProvider>);
 fireEvent.click(screen.getByRole("button",{name:"保存"}));
 expect(screen.getByRole("alert")).toHaveTextContent("Base URL");
 fireEvent.click(screen.getByText("English"));
 expect(screen.getByRole("alert")).toHaveTextContent("Enter a Base URL and API Key");
 expect(screen.getByRole("navigation",{name:"Settings"})).toBeVisible();
});
it("keeps unsaved fields across tabs and supports closing with Escape",async()=>{
 localStorage.setItem("atlas-locale","en");const close=vi.fn();
 render(<PreferencesProvider><SettingsPanel initialTab="ai" onClose={close}/></PreferencesProvider>);
 fireEvent.change(screen.getByLabelText("API Key"),{target:{value:"unsaved-fixture"}});
 fireEvent.click(screen.getByRole("button",{name:"Capture & data"}));
 expect(screen.queryByRole("button",{name:"Save"})).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole("button",{name:"AI connection"}));
 expect(screen.getByLabelText("API Key")).toHaveValue("unsaved-fixture");
 fireEvent.keyDown(screen.getByLabelText("API Key"),{key:"Escape"});expect(close).toHaveBeenCalledOnce();
});

it("saves an economy model, sets analysis depth with one tap and switches or forgets saved connections", async () => {
 localStorage.setItem("atlas-locale","zh-CN");
 const fetchMock=vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [{ id: "deepseek-reasoner" }, { id: "deepseek-chat" }] })));vi.stubGlobal("fetch",fetchMock);
 vi.stubGlobal("chrome",{permissions:{contains:vi.fn().mockResolvedValue(true),request:vi.fn().mockResolvedValue(true)}});
 const db=await getDatabase();
 await db.put("aiSettings",{id:"ai-settings",mode:"byok",provider:"deepseek",baseUrl:"https://api.deepseek.com",apiKey:"fixture",model:"deepseek-reasoner",analysisMode:"balanced",updatedAt:1,connections:[
  {provider:"qwen",baseUrl:"https://dashscope.aliyuncs.com/compatible-mode/v1",apiKey:"other",model:"qwen3.8-plus",economyModel:"qwen3.7-flash"},
  {provider:"openai",baseUrl:"https://api.openai.com/v1",apiKey:"old",model:"gpt-old"},
  {provider:"deepseek",baseUrl:"https://api.deepseek.com",apiKey:"fixture",model:"deepseek-reasoner"},
 ]});
 render(<PreferencesProvider><SettingsPanel initialTab="ai" onClose={vi.fn()} /></PreferencesProvider>);
 const saved=await screen.findByRole("region",{name:"已保存的连接"});
 expect(within(saved).getByText("qwen3.8-plus + qwen3.7-flash")).toBeVisible();
 expect(within(saved).getByText("当前")).toBeVisible();
 fireEvent.click(within(saved).getByRole("button",{name:"删除 gpt-old"}));
 await waitFor(()=>expect(within(saved).queryByText("gpt-old")).toBeNull());
 expect((await getAISettings())?.connections?.map(item=>item.model)).not.toContain("gpt-old");

 fireEvent.click(screen.getByRole("button",{name:"刷新模型"}));
 await waitFor(()=>expect((screen.getByLabelText("经济模型") as HTMLSelectElement).querySelector('option[value="deepseek-chat"]')).toBeInTheDocument());
 fireEvent.change(screen.getByLabelText("经济模型"),{target:{value:"deepseek-chat"}});
 fireEvent.click(screen.getByRole("radio",{name:"快速"}));
 expect(screen.getByRole("radio",{name:"快速"})).toHaveAttribute("aria-checked","true");
 fireEvent.click(screen.getByRole("button",{name:"保存"}));
 await waitFor(async()=>expect(await getAISettings()).toMatchObject({model:"deepseek-reasoner",economyModel:"deepseek-chat",analysisMode:"fast"}));

 fireEvent.click(within(saved).getByRole("button",{name:"使用"}));
 await waitFor(async()=>expect(await getAISettings()).toMatchObject({provider:"qwen",model:"qwen3.8-plus",economyModel:"qwen3.7-flash"}));
 expect(await screen.findByText("已切换到 qwen3.8-plus")).toBeVisible();
});
