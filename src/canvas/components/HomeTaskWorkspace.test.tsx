import "fake-indexeddb/auto";
import { act, cleanup, fireEvent, render as renderBase, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PreferencesProvider } from "../preferences";
const render = (ui: Parameters<typeof renderBase>[0]) => renderBase(ui, { wrapper: PreferencesProvider });
import { HomeTaskWorkspace } from "./HomeTaskWorkspace";
import { HomeTaskPlanError, planHomeTask, retrieveHomeTask } from "../../ai/home-task";
import { getDatabase } from "../../storage/db";
import { projectSession } from "../../test/project-fixture";
import { answerHomeRecall } from "../../ai/home-recall";
import { sourceMessageSignature } from "../../shared/source-signature";
import { readerMessages, invalidateReaderMessages } from "../reader-message-cache";
vi.mock("../../ai/home-recall", () => ({ answerHomeRecall: vi.fn() }));
vi.mock("../../ai/home-task", async importOriginal => ({ ...await importOriginal<typeof import("../../ai/home-task")>(), planHomeTask: vi.fn(), retrieveHomeTask: vi.fn() }));
const conversations = ["one", "unselected"].map(id => ({ id, platform: "chatgpt", title: "硬件", url: "", messageCount: 2, importState: "complete" as const, hydrationState: "hydrated" as const, updatedAt: 1 }));
const props = () => ({ goal: "帮我整理硬件项目", poolIds: ["one"], conversations, sessions: [], zh: true, onStart: vi.fn(), onBack: vi.fn(), onContinue: vi.fn(), onHydrate: vi.fn(), onConfigureAI: vi.fn() });
beforeEach(async () => {
  localStorage.setItem("atlas-locale", "zh-CN"); localStorage.removeItem("atlas-conversation-sidebar-collapsed");
  vi.clearAllMocks(); vi.mocked(answerHomeRecall).mockReset();
  for(const conversation of conversations)await(await getDatabase()).put("conversations",conversation);
  await (await getDatabase()).put("aiSettings", { id: "ai-settings", mode: "byok", provider: "openai", baseUrl: "https://fixture.example/v1", apiKey: "fixture", model: "fixture", updatedAt: 1 });
  vi.mocked(planHomeTask).mockResolvedValue({ action: "project", queries: ["硬件"] });
  vi.mocked(retrieveHomeTask).mockResolvedValue({ ids: ["one"], scope: { kind: "goal", blocks: [] }, pending: [], limited: false });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
it("keeps saved summaries readable without reanalysis or follow-up generation",async()=>{
 const answer={...projectSession(),mode:"answer" as const};
 render(<HomeTaskWorkspace {...props()} goal="总结历史讨论" requestedAction="answer" readOnly initialRecord={{id:"archived-summary",question:"总结历史讨论",topicGoal:"总结历史讨论",poolIds:["one"],answer,createdAt:1}}/>);
 expect(screen.getByText(/已保存的讨论总结，仅供查看/)).toBeVisible();
 expect(screen.queryByRole("button",{name:"重新查找"})).toBeNull();expect(screen.queryByRole("textbox",{name:"继续提问"})).toBeNull();
 expect(planHomeTask).not.toHaveBeenCalled();expect(answerHomeRecall).not.toHaveBeenCalled();
 expect(screen.getByRole("button",{name:"整理为项目"})).toBeVisible();
});
it("searches local originals without starting model planning, even when a model is configured", async () => {
  const find = vi.spyOn(await import("../../search/home-history"), "findHistory").mockResolvedValue({matches:[], pending:[]} as unknown as Awaited<ReturnType<typeof import("../../search/home-history")["findHistory"]>>);
  render(<HomeTaskWorkspace {...props()} goal="之前关于 Orama 的讨论" requestedAction="answer" localSearch />);
  await screen.findByText(/未找到匹配正文/);
  expect(screen.queryByRole("combobox",{name:"选择生成 AI"})).not.toBeInTheDocument();
  expect(find).toHaveBeenCalledOnce();
  expect(planHomeTask).not.toHaveBeenCalled(); expect(retrieveHomeTask).not.toHaveBeenCalled(); expect(answerHomeRecall).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button",{name:"使用 AI 分析"}));
  await waitFor(()=>expect(planHomeTask).toHaveBeenCalledOnce());
  find.mockRestore();
});
it("reports stale local-search source links and prevents opening changed text as the cited original",async()=>{
  const message={id:"stale-local",conversationId:"one",role:"user" as const,content:"Orama 原始方案",messageIndex:0,createdAt:1,updatedAt:1,contentHash:"",preview:""};
  const db=await getDatabase();await db.put("messages",{...message,content:"后来已修改方案"});
  const find=vi.spyOn(await import("../../search/home-history"),"findHistory").mockResolvedValue({matches:[{conversation:conversations[0],excerpt:message.content,messages:[message]}]} as unknown as Awaited<ReturnType<typeof import("../../search/home-history")["findHistory"]>>);
  const onRead=vi.fn();render(<HomeTaskWorkspace {...props()} goal="Orama" requestedAction="answer" localSearch onRead={onRead}/>);
  await screen.findByText(message.content);fireEvent.click(screen.getByRole("button",{name:"阅读对话：硬件"}));
  expect(await screen.findByRole("alert")).toHaveTextContent("原文已更新或删除");expect(onRead).not.toHaveBeenCalled();expect(planHomeTask).not.toHaveBeenCalled();find.mockRestore();
});
it("edits searches in place within the same pool and ignores results from an older query", async () => {
  let finish!: (value: Awaited<ReturnType<typeof import("../../search/home-history")["findHistory"]>>) => void;
  const find = vi.spyOn(await import("../../search/home-history"), "findHistory").mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValue({matches:[], capped:false});
  const callbacks = props(); render(<HomeTaskWorkspace {...callbacks} goal="Orama" requestedAction="answer" localSearch />);
  await waitFor(() => expect(find).toHaveBeenCalledOnce());
  fireEvent.change(screen.getByRole("textbox", {name:"搜索历史对话"}), {target:{value:"ESP32"}});
  fireEvent.submit(screen.getByRole("search"));
  await waitFor(() => expect(find).toHaveBeenLastCalledWith("ESP32", [conversations[0]]));
  const message={id:"late-match",conversationId:"one",role:"user" as const,content:"Orama 旧搜索",messageIndex:0,createdAt:1,updatedAt:1,contentHash:"",preview:""};
  await act(async () => finish({matches:[{conversation:conversations[0],messages:[message],excerpt:message.content,score:1}],capped:false}));
  expect(screen.queryByText(message.content)).not.toBeInTheDocument(); expect(screen.getByRole("textbox",{name:"搜索历史对话"})).toHaveValue("ESP32");
  expect(screen.queryByRole("textbox",{name:"继续提问"})).not.toBeInTheDocument(); expect(planHomeTask).not.toHaveBeenCalled(); expect(callbacks.onBack).not.toHaveBeenCalled();
});
it("opens the conversation in the workspace, selects real matched messages and returns to unchanged search results", async () => {
  const db=await getDatabase(), question={id:"local-question",conversationId:"one",role:"user" as const,content:"Orama 索引如何持久化？",messageIndex:0,createdAt:1,updatedAt:1,contentHash:"",preview:""}, reply={...question,id:"local-reply",role:"assistant" as const,content:"导出 Orama 索引并本地保存。",messageIndex:1};
  await db.clear("messages");
  invalidateReaderMessages("one");await db.put("messages",{...question,id:"old-cached-question",messageIndex:-1,content:"先前缓存的问题"});await readerMessages("one");
  await db.put("messages",question);await db.put("messages",reply);
  const range={start:0,end:5,excerpt:"Orama"};
  const find=vi.spyOn(await import("../../search/home-history"), "findHistory").mockResolvedValue({matches:[{conversation:conversations[0],messages:[question,reply],excerpt:question.content,score:1,sourceRange:range}],capped:false});
  const onRead=vi.fn(); const {container}=render(<HomeTaskWorkspace {...props()} goal="Orama" requestedAction="answer" localSearch onRead={onRead}/>);
  const result=await screen.findByRole("button",{name:"阅读对话：硬件"}); const body=container.querySelector<HTMLElement>(".home-task-body")!;body.scrollTop=175;fireEvent.click(result);
  const reader=await screen.findByRole("region",{name:"对话阅读"});
  expect(screen.queryByRole("dialog",{name:"原文依据"})).not.toBeInTheDocument();expect(screen.queryByRole("combobox",{name:"切换来源"})).not.toBeInTheDocument();
  const outline=within(reader).getByRole("complementary",{name:"命中目录"});expect(within(outline).getAllByRole("listitem")).toHaveLength(2);
  fireEvent.click(within(outline).getByRole("button",{name:/AI · 2/}));
  await waitFor(()=>expect(reader.querySelector('.reader-reply-part[data-reader-message-id="local-reply"] .knowledge-reader-message')).toHaveClass("is-focused"));
  await waitFor(()=>expect(reader.querySelector(".reader-evidence-target")).toHaveTextContent(reply.content));
  expect(onRead).not.toHaveBeenCalled();expect((await readerMessages("one")).map(message=>message.id)).toContain(question.id);
  fireEvent.click(screen.getByRole("button",{name:"返回搜索结果"}));
  await waitFor(()=>expect(screen.getByRole("button",{name:"阅读对话：硬件"})).toHaveFocus());
  expect(screen.getByRole("button",{name:"阅读对话：硬件"})).toBe(result);expect(body.scrollTop).toBe(175);expect(screen.getByRole("textbox",{name:"搜索历史对话"})).toHaveValue("Orama");expect(screen.getByText("2 条匹配消息")).toBeVisible();expect(find).toHaveBeenCalledOnce();expect(planHomeTask).not.toHaveBeenCalled();
});
it("keeps additional matches reachable and offers syncing only the pending selected sources",async()=>{
  const rows=Array.from({length:12},(_,index)=>({conversation:{...conversations[0],id:`result-${index}`,title:`匹配 ${index}`},messages:[{id:`message-${index}`,conversationId:`result-${index}`,role:"user" as const,content:"Orama",messageIndex:0,createdAt:1,updatedAt:1,contentHash:"",preview:""}],excerpt:"Orama",score:1}));
  const find=vi.spyOn(await import("../../search/home-history"),"findHistory").mockResolvedValue({matches:rows,capped:true});
  const callbacks=props(),pending={...conversations[0],importState:"discovered" as const,hydrationState:"metadata_only" as const,messageCount:null};
  render(<HomeTaskWorkspace {...callbacks} conversations={[pending,conversations[1]]} goal="Orama" requestedAction="answer" localSearch/>);
  await screen.findByRole("button",{name:"显示更多结果"});expect(screen.getAllByRole("button",{name:/阅读对话：/})).toHaveLength(10);fireEvent.click(screen.getByRole("button",{name:"显示更多结果"}));expect(screen.getAllByRole("button",{name:/阅读对话：/})).toHaveLength(12);expect(screen.getByText(/匹配较多/)).toBeVisible();
  find.mockResolvedValue({matches:[],capped:false});fireEvent.submit(screen.getByRole("search"));fireEvent.click(await screen.findByRole("button",{name:"同步 1 条待导入正文"}));expect(callbacks.onHydrate).toHaveBeenCalledWith(["one"]);
});
it("saves completed local searches, including zero matches, and preserves one record when reopening",async()=>{
  const db=await getDatabase();await db.clear("homeResults");vi.spyOn(await import("../../search/home-history"),"findHistory").mockResolvedValue({matches:[],capped:false});
  const callbacks=props(),view=render(<HomeTaskWorkspace {...callbacks} goal="没有结果的关键词" requestedAction="answer" localSearch/>);
  await waitFor(async()=>{const rows=await db.getAll("homeResults");expect(rows).toHaveLength(1);expect(rows[0]).toMatchObject({kind:"search",question:"没有结果的关键词",poolIds:["one"],status:"completed",matchCount:0});});
  const activity=(await db.getAll("homeResults"))[0];if("answer" in activity)throw Error("wrong record");view.unmount();render(<HomeTaskWorkspace {...callbacks} goal={activity.question} requestedAction="answer" localSearch initialActivity={activity}/>);
  await screen.findByRole("heading",{name:"未找到匹配正文"});await waitFor(async()=>expect((await db.getAll("homeResults"))).toHaveLength(1));expect(planHomeTask).not.toHaveBeenCalled();
});
it("reads retained real messages even if conversation metadata is missing",async()=>{
  const db=await getDatabase(),message={id:"orphan-proof",conversationId:"orphan",role:"user" as const,content:"Orama 真实消息",messageIndex:0,createdAt:1,updatedAt:1,contentHash:"",preview:""};await db.put("messages",message);await db.delete("conversations","orphan");
  vi.spyOn(await import("../../search/home-history"),"findHistory").mockResolvedValue({matches:[{conversation:{...conversations[0],id:"orphan"},messages:[message],excerpt:message.content,score:1}],capped:false});const onRead=vi.fn();render(<HomeTaskWorkspace {...props()} goal="Orama" requestedAction="answer" localSearch onRead={onRead}/>);
  fireEvent.click(await screen.findByRole("button",{name:"阅读对话：硬件"}));const reader=await screen.findByRole("region",{name:"对话阅读"});expect(reader).toHaveTextContent("本地保留的原始消息");expect(reader.querySelector(".reader-conversation")).toHaveTextContent(message.content);expect(onRead).not.toHaveBeenCalled();expect(screen.queryByRole("link",{name:/前往原平台/})).not.toBeInTheDocument();
});
it("answers in the task workspace with exact message evidence and streams prose without creating a project", async () => {
  const db = await getDatabase();
  const message = { id: "answer-message", conversationId: "one", role: "assistant" as const, messageIndex: 7, content: "先学习控制理论，再做实验。", contentHash: "", preview: "", createdAt: 1, updatedAt: 1 };
  await db.put("messages", message);
  vi.mocked(planHomeTask).mockResolvedValue({ action: "answer", queries: ["控制理论"] });
  const scope = { kind: "goal" as const, blocks: [{ conversationId: "one", title: "控制学习", messageIds: [message.id], messageSignatures: { [message.id]: sourceMessageSignature(message.content) } }] };
  vi.mocked(retrieveHomeTask).mockResolvedValue({ ids: ["one"], scope, pending: [], limited: false });
  let finish!: (value: ReturnType<typeof projectSession>) => void;
  vi.mocked(answerHomeRecall).mockImplementation(async (...args) => { args[6]?.('{"sections":[{"title":"学习路线","body":"先学习控制'); return new Promise(resolve => { finish = resolve; }); });
  const callbacks = props(), onRead = vi.fn(); render(<HomeTaskWorkspace {...callbacks} goal="之前的控制学习路线是什么？" requestedAction="answer" onRead={onRead} />);
  await screen.findByText("正在生成 · 待核对"); expect(screen.getByText("先学习控制")).toBeInTheDocument();
  expect(screen.queryByText(/sections|evidenceIds/u)).not.toBeInTheDocument();
  await act(async () => finish({ ...projectSession(), sourceConversationIds: ["one"], sections: [{ id: "s", title: "学习路线", body: message.content, transition: "", kind: "finding", evidenceIds: ["e"] }], evidence: [{ id: "e", conversationId: "one", messageId: message.id, title: "控制学习", excerpt: message.content, sourceSignature: sourceMessageSignature(message.content) }] }));
  await screen.findByRole("article", { name: "历史回答" });
  expect(callbacks.onStart).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "展开依据 1" }));
  const reader = await screen.findByRole("button", { name: "在阅读器中打开整段对话" });
  await waitFor(() => expect(reader).not.toBeDisabled()); fireEvent.click(reader);
  await waitFor(() => expect(onRead).toHaveBeenCalledWith("one", message));
  await db.put("messages", { ...message, content: "后来修正了学习路线" });
  fireEvent.click(reader);
  await screen.findByRole("alert"); expect(onRead).toHaveBeenCalledOnce();
});
it("discards an answer when its original message changes during generation", async () => {
  const db = await getDatabase(); const message = { id: "changing", conversationId: "one", role: "assistant" as const, messageIndex: 0, content: "original", contentHash: "", preview: "", createdAt: 1, updatedAt: 1 }; await db.put("messages", message);
  vi.mocked(planHomeTask).mockResolvedValue({ action: "answer", queries: ["original"] });
  vi.mocked(answerHomeRecall).mockImplementation(async () => { await db.put("messages", { ...message, content: "changed" }); return { ...projectSession(), evidence: [{ id: "e", conversationId: "one", messageId: message.id, title: "原文", excerpt: "original", sourceSignature: sourceMessageSignature("original") }] }; });
  const callbacks = props(); render(<HomeTaskWorkspace {...callbacks} />);
  expect(await screen.findByRole("alert")).toHaveTextContent("原始讨论已更新"); expect(screen.queryByRole("article", { name: "历史回答" })).not.toBeInTheDocument(); expect(callbacks.onStart).not.toHaveBeenCalled();
});
it("also rejects changed context that the answer did not cite", async () => {
  const db = await getDatabase();
  const original = [{ id: "uncited-question", role: "user" as const, content: "旧提问" }, { id: "cited-answer", role: "assistant" as const, content: "旧回答" }];
  for (const [index, message] of original.entries()) await db.put("messages", { ...message, conversationId: "one", messageIndex: index, contentHash: "", preview: "", createdAt: 1, updatedAt: 1 });
  vi.mocked(planHomeTask).mockResolvedValue({ action: "answer", queries: ["主题"] });
  vi.mocked(retrieveHomeTask).mockResolvedValue({ ids: ["one"], scope: { kind: "goal", blocks: [{ conversationId: "one", title: "问答", messageIds: original.map(message => message.id), messageSignatures: Object.fromEntries(original.map(message => [message.id, sourceMessageSignature(message.content)])) }] }, pending: [], limited: false });
  vi.mocked(answerHomeRecall).mockImplementation(async () => { const question = (await db.get("messages", "uncited-question"))!; await db.put("messages", { ...question, content: "新提问" }); return { ...projectSession(), evidence: [{ id: "e", conversationId: "one", messageId: "cited-answer", title: "回答", excerpt: "旧回答", sourceSignature: sourceMessageSignature("旧回答") }] }; });
  render(<HomeTaskWorkspace {...props()} />);
  expect(await screen.findByRole("alert")).toHaveTextContent("原始讨论已更新"); expect(screen.queryByRole("article", { name: "历史回答" })).not.toBeInTheDocument();
});
it("waits for project metadata before interpreting a quickly submitted home task", async () => {
  const callbacks = props(); const view = render(<HomeTaskWorkspace {...callbacks} projectsReady={false} />);
  await screen.findByRole("combobox", {name:"选择生成 AI"});
  expect(planHomeTask).not.toHaveBeenCalled(); expect(callbacks.onStart).not.toHaveBeenCalled();
  view.rerender(<HomeTaskWorkspace {...callbacks} projectsReady />);
  await waitFor(() => expect(callbacks.onStart).toHaveBeenCalledOnce());
});
it("interprets and starts the task within the selected pool without a second source picker", async () => {
  const callbacks = props(); render(<HomeTaskWorkspace {...callbacks} />);
  await waitFor(() => expect(callbacks.onStart).toHaveBeenCalledOnce());
  expect(vi.mocked(planHomeTask).mock.calls[0][2].map(source => source.id)).toEqual(["one"]);
  expect(vi.mocked(retrieveHomeTask).mock.calls[0][1].map(source => source.id)).toEqual(["one"]);
  expect(screen.queryByRole("checkbox")).not.toBeInTheDocument(); expect(callbacks.onHydrate).not.toHaveBeenCalled();
});
it("asks one clarification and continues from the answer without changing source selection", async () => {
  vi.mocked(planHomeTask).mockResolvedValueOnce({ action: "clarify", queries: [], question: "哪个硬件项目？" });
  const callbacks = props(); render(<HomeTaskWorkspace {...callbacks} />);
  const field = await screen.findByRole("textbox", { name: "哪个硬件项目？" });
  expect(callbacks.onStart).not.toHaveBeenCalled();
  fireEvent.change(field, { target: { value: "AI 创作平台" } }); fireEvent.click(screen.getByRole("button", { name: "继续" }));
  await waitFor(() => expect(callbacks.onStart).toHaveBeenCalledOnce());
  expect(callbacks.onStart.mock.calls[0][0]).toContain("AI 创作平台");
  expect(vi.mocked(planHomeTask).mock.calls[1][2].map(source => source.id)).toEqual(["one"]);
});
it("continues an existing project without generating a duplicate", async () => {
  const project = { ...projectSession(), sourceConversationIds: ["one"] };
  vi.mocked(planHomeTask).mockResolvedValue({ action: "continue", queries: [], projectId: project.id });
  const callbacks = props(); render(<HomeTaskWorkspace {...callbacks} sessions={[project]} />);
  await waitFor(() => expect(callbacks.onContinue).toHaveBeenCalledWith(project, callbacks.goal, ["one"]));
  expect(callbacks.onStart).not.toHaveBeenCalled(); expect(retrieveHomeTask).not.toHaveBeenCalled();
});
it("retains the goal and ignores a late provider response after returning home", async () => {
  let finish!: (value: Awaited<ReturnType<typeof planHomeTask>>) => void;
  vi.mocked(planHomeTask).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const callbacks = props(); const view = render(<HomeTaskWorkspace {...callbacks} />);
  await waitFor(() => expect(planHomeTask).toHaveBeenCalledOnce());
  fireEvent.click(screen.getByRole("button", { name: "返回" })); expect(callbacks.onBack).toHaveBeenCalledOnce(); view.unmount();
  await act(async () => finish({ action: "project", queries: ["硬件"] }));
  expect(callbacks.onStart).not.toHaveBeenCalled(); expect(retrieveHomeTask).not.toHaveBeenCalled();
});
it("waits for requested source sync and resumes retrieval without interpreting the goal again", async () => {
  vi.mocked(retrieveHomeTask).mockResolvedValueOnce({ ids: ["one"], scope: {kind:"all"}, pending: ["one"], limited: false });
  const callbacks = props(); const view = render(<HomeTaskWorkspace {...callbacks} />);
  fireEvent.click(await screen.findByRole("button", { name: "同步相关 1 条对话" }));
  expect(callbacks.onHydrate).toHaveBeenCalledWith(["one"]);
  view.rerender(<HomeTaskWorkspace {...callbacks} conversations={[{ ...conversations[0], updatedAt: 2 }, conversations[1]]} />);
  await waitFor(() => expect(callbacks.onStart).toHaveBeenCalledOnce()); expect(planHomeTask).toHaveBeenCalledOnce();
});

it("shows a readable schema error and retries with the same goal and source pool", async () => {
  vi.mocked(planHomeTask).mockRejectedValueOnce(new HomeTaskPlanError("queries", true));
  const callbacks = props(); const { container } = render(<HomeTaskWorkspace {...callbacks} />);
  expect(await screen.findByRole("alert")).toHaveTextContent("AI 返回的任务安排不符合要求");
  expect(screen.queryByText("Invalid task plan")).not.toBeInTheDocument();
  expect(container.querySelector(".home-task-header")).toContainElement(screen.getByRole("combobox", { name: "选择生成 AI" }));
  expect(container.querySelector("details")).not.toHaveAttribute("open");
  expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "重试" }));
  await waitFor(() => expect(callbacks.onStart).toHaveBeenCalledOnce());
  expect(planHomeTask).toHaveBeenCalledTimes(2);
  expect(vi.mocked(planHomeTask).mock.calls[1][1]).toBe(callbacks.goal);
  expect(vi.mocked(planHomeTask).mock.calls[1][2].map(source => source.id)).toEqual(["one"]);
});

it("preserves the entered goal when adjusting materials after failure", async () => {
  vi.mocked(planHomeTask).mockRejectedValueOnce(new HomeTaskPlanError("action", true));
  const callbacks = props(); render(<HomeTaskWorkspace {...callbacks} />);
  await screen.findByRole("alert");
  fireEvent.click(screen.getByRole("button", { name: "调整材料" }));
  expect(callbacks.onBack).toHaveBeenCalledWith(callbacks.goal);
  expect(callbacks.onStart).not.toHaveBeenCalled();
});

it("retries material assessment while retaining the already validated task plan and selected pool", async () => {
  vi.mocked(retrieveHomeTask).mockRejectedValueOnce(new HomeTaskPlanError("materialReview.ids[0]", true));
  const callbacks = props(); render(<HomeTaskWorkspace {...callbacks} />);
  expect(await screen.findByRole("alert")).toHaveTextContent("材料分析未通过格式或来源校验");
  fireEvent.click(screen.getByRole("button", { name: "重试" }));
  await waitFor(() => expect(callbacks.onStart).toHaveBeenCalledOnce());
  expect(planHomeTask).toHaveBeenCalledOnce();
  expect(retrieveHomeTask).toHaveBeenCalledTimes(2);
  expect(vi.mocked(retrieveHomeTask).mock.calls[1][1].map(source => source.id)).toEqual(["one"]);
});
it("groups hits by the question they answer, reads conditions as chips, and opens the reader at the chosen discussion",async()=>{
  const db=await getDatabase();await db.clear("messages");invalidateReaderMessages("one");
  const base={conversationId:"one",createdAt:1,updatedAt:1,contentHash:"",preview:""};
  const messages=[
    {...base,id:"q1",role:"user" as const,messageIndex:0,content:"Orama 索引怎么持久化？"},{...base,id:"r1",role:"assistant" as const,messageIndex:1,content:"导出 Orama 索引并本地保存。"},
    {...base,id:"q2",role:"user" as const,messageIndex:2,content:"导出格式选什么？"},{...base,id:"r2",role:"assistant" as const,messageIndex:3,content:"Markdown 导出要附带 Orama 引用。"},
  ];
  for(const message of messages)await db.put("messages",message);
  const find=vi.spyOn(await import("../../search/home-history"),"findHistory").mockResolvedValue({matches:[{conversation:conversations[0],messages:[messages[1],messages[0],messages[3]],excerpt:"导出 Orama 索引",score:1}],capped:false});
  render(<HomeTaskWorkspace {...props()} goal="在 ChatGPT 里 Orama" requestedAction="answer" localSearch/>);
  // The platform words became a condition; only the topic was searched.
  await waitFor(()=>expect(find).toHaveBeenCalledWith("Orama",[conversations[0]]));
  expect(await screen.findByText("Orama 索引怎么持久化？")).toBeVisible();
  expect(screen.getByRole("button",{name:"移除条件：ChatGPT"})).toBeVisible();
  expect(screen.getByText("1 个对话 · 2 处讨论 · 本地搜索")).toBeVisible();
  // The second discussion has its own row and opens at its own reply.
  fireEvent.click(screen.getByRole("button",{name:/导出格式选什么？/}));
  const reader=await screen.findByRole("region",{name:"对话阅读"});
  await waitFor(()=>expect(reader.querySelector(".reader-evidence-target")).toHaveTextContent("Markdown 导出要附带 Orama 引用。"));
  find.mockRestore();
});
it("lists organized knowledge first and lets the reader pick found conversations to organize or add to a project", async () => {
  const message={id:"pick-local",conversationId:"one",role:"user" as const,content:"Orama 原始方案",messageIndex:0,createdAt:1,updatedAt:1,contentHash:"",preview:""};
  await(await getDatabase()).put("messages",message);
  const find=vi.spyOn(await import("../../search/home-history"),"findHistory").mockResolvedValue({matches:[{conversation:conversations[0],excerpt:message.content,messages:[message]}]} as unknown as Awaited<ReturnType<typeof import("../../search/home-history")["findHistory"]>>);
  const project=projectSession();project.sections=[{...project.sections[0],id:"search",title:"搜索架构",body:"全文检索使用 Orama，在本地建立消息索引。"}];
  const callbacks=props(),openChapter=vi.fn();
  render(<HomeTaskWorkspace {...callbacks} sessions={[project]} goal="Orama" requestedAction="answer" localSearch onOpenChapter={openChapter}/>);
  const knowledge=await screen.findByRole("region",{name:"已整理的知识"});
  fireEvent.click(within(knowledge).getByRole("button",{name:/搜索架构/u}));
  expect(openChapter).toHaveBeenCalledWith(project.id,"search");
  await screen.findByText(message.content);
  expect(screen.queryByRole("region",{name:"已选对话"})).toBeNull();
  fireEvent.click(screen.getByRole("checkbox",{name:"选择对话：硬件"}));
  const bar=screen.getByRole("region",{name:"已选对话"});expect(bar).toHaveTextContent("已选 1 个对话");
  fireEvent.click(within(bar).getByRole("button",{name:"整理成项目"}));
  expect(callbacks.onStart).toHaveBeenCalledWith("整理这些讨论：Orama","work",["one"],{kind:"all",sourceConversationIds:["one"]});
  fireEvent.change(within(bar).getByRole("combobox",{name:"加入已有项目"}),{target:{value:project.id}});
  expect(callbacks.onContinue).toHaveBeenCalledWith(project,"Orama",["one"]);
  find.mockRestore();
});
