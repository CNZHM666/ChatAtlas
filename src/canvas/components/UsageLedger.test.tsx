import "fake-indexeddb/auto";
import {cleanup,fireEvent,render,screen,waitFor,within} from "@testing-library/react";
import {afterEach,beforeEach,expect,it,vi} from "vitest";
import {getDatabase} from "../../storage/db";
import {recordAIUsage} from "../../storage/ai-usage";
import {UsageLedger} from "./UsageLedger";

beforeEach(async()=>{
 const db=await getDatabase();await db.clear("aiUsageEvents");await db.clear("organizationRuns");await db.clear("conversations");await db.clear("focusSessions");
 await recordAIUsage({id:"usage-view",runId:"usage-view-run",createdAt:100,requestStartedAt:90,durationMs:10,taskType:"focus_session",feature:"wiki",operation:"reading",providerId:"qwen",modelId:"fixture",conversationIds:["conversation"],inputTokens:100,outputTokens:20,tokenSource:"provider",status:"completed",attempt:1});
});
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();});

it("separates usage, diagnostics and tests without duplicate totals or calling a provider",async()=>{
 const fetch=vi.spyOn(globalThis,"fetch");render(<UsageLedger locale="zh-CN"/>);
 const overview=screen.getByRole("region",{name:"用量概览"});await within(overview).findByText("100");
 expect(within(overview).getAllByText("120")).toHaveLength(2); // Total and the selected feature row, not three repeated statistic cards.
 expect(screen.queryByText("统计说明")).toBeNull();expect(screen.queryByText("按对话查看")).toBeNull();expect(screen.queryByText("展开开发者测试分析")).toBeNull();
 expect(screen.queryByLabelText("按 AI 功能筛选")).toBeNull();
 fireEvent.click(screen.getByRole("button",{name:"任务诊断"}));
 const diagnostics=screen.getByRole("region",{name:"任务诊断"});const filter=within(diagnostics).getByLabelText("按 AI 功能筛选");
 await waitFor(()=>expect(within(diagnostics).queryByText("读取中…")).toBeNull());
 fireEvent.change(filter,{target:{value:"wiki"}});
 fireEvent.click(screen.getByRole("button",{name:"开发者测试"}));expect(screen.queryByRole("region",{name:"任务诊断"})).toBeNull();
 expect(within(screen.getByRole("region",{name:"开发者测试"})).getByRole("button",{name:"运行本地回归"})).toBeVisible();
 fireEvent.click(screen.getByRole("button",{name:"任务诊断"}));expect(screen.getByLabelText("按 AI 功能筛选")).toHaveValue("wiki");
 expect(fetch).not.toHaveBeenCalled();
});

it("keeps the diagnostic export available after changing views",async()=>{
 const create=vi.fn().mockReturnValue("blob:diagnostics");vi.stubGlobal("URL",class extends URL{static createObjectURL=create;static revokeObjectURL=vi.fn();});vi.spyOn(HTMLAnchorElement.prototype,"click").mockImplementation(()=>{});
 render(<UsageLedger locale="en"/>);fireEvent.click(screen.getByRole("button",{name:"Diagnostics"}));
 const diagnostics=screen.getByRole("region",{name:"Diagnostics"});
 await waitFor(()=>expect(within(diagnostics).queryByText("Loading…")).toBeNull());
 fireEvent.click(within(diagnostics).getByText("Export",{selector:"summary"}));fireEvent.click(within(diagnostics).getByRole("button",{name:"Export request JSON"}));
 const reader=new FileReader();reader.readAsText(create.mock.calls[0][0]);await waitFor(()=>expect(reader.result).toBeTruthy());
 const data=JSON.parse(String(reader.result));expect(data.requests).toHaveLength(1);expect(data.requests[0]).toMatchObject({inputTokens:100,outputTokens:20,feature:"wiki"});
 expect(String(reader.result)).not.toContain("apiKey");
});

it("filters by time range, groups by model and shows provider cache reads",async()=>{
 const now=Date.now();
 await recordAIUsage({id:"recent-economy",createdAt:now-1000,taskType:"focus_session",feature:"wiki",stage:"reading",providerId:"qwen",modelId:"qwen-flash",conversationIds:["conversation"],inputTokens:1000,outputTokens:100,cachedInputTokens:400,tokenSource:"provider",status:"completed",attempt:1});
 await recordAIUsage({id:"recent-main",createdAt:now-2000,taskType:"focus_session",feature:"wiki",stage:"synthesis:final",providerId:"qwen",modelId:"qwen-plus",conversationIds:["conversation"],inputTokens:2000,outputTokens:300,cachedInputTokens:600,tokenSource:"provider",status:"completed",attempt:1});
 render(<UsageLedger locale="zh-CN"/>);
 const overview=screen.getByRole("region",{name:"用量概览"});
 expect(await within(overview).findAllByText("3,520")).toHaveLength(2); // Total and the single feature row.
 expect(within(overview).getByText("缓存读取")).toBeVisible();
 fireEvent.click(within(overview).getByRole("button",{name:"近 7 天"}));
 // The fixture at timestamp 100 falls outside the last seven days.
 expect(within(overview).getAllByText("3,400")).toHaveLength(2);
 expect(within(overview).getByText("1,000")).toBeVisible();
 fireEvent.click(within(overview).getByRole("button",{name:"按模型"}));
 expect(within(overview).getByText("qwen-plus")).toBeVisible();
 expect(within(overview).getByText("qwen-flash")).toBeVisible();
 expect(within(overview).queryByText("fixture")).toBeNull();
});
