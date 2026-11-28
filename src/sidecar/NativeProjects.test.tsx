import "fake-indexeddb/auto";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { getDatabase } from "../storage/db";
import { projectSession } from "../test/project-fixture";
import { createLivingProject, listFocusSessions, renameFocusProject } from "../storage/focus-sessions";
import { saveManualWikiChapter } from "../storage/sidecar-projects";
import * as atlasAI from "../ai/atlas-ai";
import { generateFocusSession } from "../ai/focus-session";
import type { Conversation, ConversationMessage } from "../shared/types";
import { withWikiOutline } from "../test/wiki-outline-fixture";
import { NativeProjects } from "./NativeProjects";
import { SidecarProjectWiki } from "./SidecarProjectWiki";
import { projectDesk } from "../storage/project-desk";
import { sourceVersion } from "../storage/source-versions";
import { listDeletedProjects, restoreProject } from "../storage/project-deletion";
import type { AtlasMessage } from "../shared/messages";
import { FirstWikiPanel } from "./FirstWikiPanel";
import { useFirstWikiDraft } from "./first-wiki-client";

const { downloadFile } = vi.hoisted(() => ({ downloadFile: vi.fn() }));
vi.mock("../export/download-file", () => ({ downloadFile }));
vi.mock("../ai/focus-session", () => ({ generateFocusSession: vi.fn() }));

beforeEach(async () => {
  downloadFile.mockClear();
  vi.mocked(generateFocusSession).mockReset();
  localStorage.removeItem("atlas-sidecar-update-log-v1");
  const db = await getDatabase();
  await db.clear("focusSessions");
  await db.clear("canvases");
  await db.clear("conversations");
  await db.clear("messages");
  await db.clear("sourceVersions");
  await db.clear("aiSettings");
  await db.clear("sidecarUpdateDrafts");
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("browses chapter citations from the dock and returns focus to the source control", async () => {
  const project = projectSession();
  const first = "第一条建议是保存计时记录。", second = "第二条建议是提供导出的入口。";
  const source = (id: string, excerpt: string) => ({ id, excerpt, title: "计时器讨论", conversationId: "c", messageId: id });
  const refs = [source("one", first), source("two", second)];
  const chapter = { ...project.sections[0], title: "记录与导出", body: first + "\n\n" + second,
    evidenceIds: refs.map(ref => ref.id), claims: refs.map(ref => ({
      text: ref.excerpt, quote: ref.excerpt, evidenceIds: [ref.id], holder: "ai" as const, holderMark: true,
    })) };
  const onSource = vi.fn();
  render(<SidecarProjectWiki project={{ ...project, sections: [chapter], evidence: refs }} chapterId={chapter.id}
    onRead={vi.fn()} zh onSource={onSource}/>);
  fireEvent.click(await screen.findByRole("button", { name: "显示出处" }));
  const status = await screen.findByRole("button", { name: "AI 建议 2" });
  status.focus();
  fireEvent.click(status);
  const dock = screen.getByRole("complementary", { name: "出处预览" });
  expect(within(dock).getByText("1 / 2")).toBeVisible();
  expect(within(dock).getByText(first)).toBeVisible();
  expect(within(dock).getByRole("button", { name: "上一处" })).toBeDisabled();
  const next = within(dock).getByRole("button", { name: "下一处" });
  next.focus();
  fireEvent.click(next);
  expect(within(dock).getByText("2 / 2")).toBeVisible();
  expect(within(dock).getByText(second)).toBeVisible();
  expect(next).toBeDisabled();
  fireEvent.click(within(dock).getByRole("button", { name: "查看上下文" }));
  expect(onSource).toHaveBeenCalledWith(refs[1], second);
  fireEvent.keyDown(next, { key: "Escape" });
  expect(dock).not.toBeInTheDocument();
  expect(status).toHaveFocus();
});

it("refreshes the sidebar after a workbench project save without waiting for polling",async ()=>{
  const project=await createLivingProject("旧项目名","","zh-CN");
  const listeners=new Set<(message:AtlasMessage)=>void>();
  vi.stubGlobal("chrome",{runtime:{
    onMessage:{addListener:(listener:(message:AtlasMessage)=>void)=>listeners.add(listener),
      removeListener:(listener:(message:AtlasMessage)=>void)=>listeners.delete(listener)},
    sendMessage:async(message:AtlasMessage)=>{for(const listener of listeners)listener(message);},
  }});
  render(<NativeProjects zh onToggleLanguage={vi.fn()} conversationId="" conversationTitle="" canInsert={false} platformLabel=""/>);
  expect(await screen.findByRole("button",{name:"旧项目名"})).toBeInTheDocument();
  await renameFocusProject(project,"工作台刚改的标题");
  expect(await screen.findByRole("button",{name:"工作台刚改的标题"})).toBeInTheDocument();
  expect(screen.queryByRole("button",{name:"旧项目名"})).not.toBeInTheDocument();
});

it("moves a project and its saved versions to the shared Trash from the sidebar", async () => {
  const project = await createLivingProject("侧栏项目", "", "zh-CN");
  const unrelated = await createLivingProject("另一项目", "", "zh-CN");
  const edited = await saveManualWikiChapter(project, undefined, "已存章节", "保留原文", true);
  const sendMessage = vi.fn().mockResolvedValue({ ok: true });
  vi.stubGlobal("chrome", { runtime: { sendMessage } });
  render(<NativeProjects zh onToggleLanguage={vi.fn()} conversationId="" conversationTitle="" canInsert={false} platformLabel=""/>);
  fireEvent.click(await screen.findByRole("button", { name: "侧栏项目" }));
  fireEvent.click(screen.getByRole("button", { name: "删除项目" }));
  const dialog = screen.getByRole("dialog", { name: "删除项目" });
  fireEvent.click(within(dialog).getByRole("button", { name: "取消" }));
  expect(await listDeletedProjects()).toEqual([]);
  fireEvent.click(screen.getByRole("button", { name: "删除项目" }));
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "移到回收站" }));
  expect(await screen.findByText("已移到工作台回收站。")).toBeVisible();
  expect(screen.queryByRole("button", { name: "侧栏项目" })).toBeNull();
  expect((await listFocusSessions()).map(session => session.id)).toEqual([unrelated.id]);
  expect(sendMessage).toHaveBeenCalledWith({ type: "ATLAS_PROJECT_TRASHED", projectId: project.canvasId });
  await restoreProject(project.canvasId!);
  expect((await listFocusSessions()).find(session => session.id === edited.id)?.sections[0].body).toBe("保留原文");
});

it("uses the workbench writer for an empty project and keeps the first document as a local draft until saved", async () => {
  const db = await getDatabase();
  const project = await createLivingProject("番茄钟", "", "zh-CN", "handoff");
  const chat: Conversation = { id: "first-chat", title: "规划计时", platform: "chatgpt", url: "", updatedAt: 1, messageCount: 1, hydrationState: "hydrated", importState: "complete" };
  const content = "每轮专注结束时向用户发送桌面通知。";
  const message: ConversationMessage = { id: "prompt-1", conversationId: chat.id, role: "user", content, contentHash: content, preview: content, messageIndex: 0, createdAt: 1, updatedAt: 1 };
  await db.put("aiSettings", { id: "ai-settings", provider: "openai", baseUrl: "https://example.test", apiKey: "fixture", model: "fixture", updatedAt: 1 });
  await db.put("conversations", chat);
  await db.put("messages", message);
  const listeners = new Set<(message: AtlasMessage) => void>();
  const sendMessage = vi.fn(async (message: AtlasMessage) => {
    if (message.type === "ATLAS_FIRST_WIKI_START") void runFirstWiki(message.draftId);
    for (const listen of listeners) listen(message);
    return { ok: true };
  });
  vi.stubGlobal("chrome", { runtime: { sendMessage, onMessage: {
    addListener: (listen: (message: AtlasMessage) => void) => listeners.add(listen),
    removeListener: (listen: (message: AtlasMessage) => void) => listeners.delete(listen),
  } } });
  const { runFirstWiki } = await import("../background/first-wiki-document");
  const version = sourceVersion(chat.id, [message], Date.now());
  await db.put("sourceVersions", version);
  const example = projectSession();
  const written = { ...example, title: "模型标题", sections: [{ ...example.sections[0], title: "通知规则", body: `${content}\n\n> **版本未定**：这里展示的是旧候选。`, evidenceIds: ["ref"], claims: [{ text: content, quote: content, evidenceIds: ["ref"], holder: "decided" as const, holderMark: true }] }],
    sourceConversationIds: [chat.id], sourceVersionIds: { [chat.id]: version.id },
    evidence: [{ id: "ref", title: chat.title, conversationId: chat.id, messageId: message.id, excerpt: content, sourceVersionId: version.id }],
  };
  let finishGeneration!: () => void;
  vi.mocked(generateFocusSession).mockImplementation(async (...args) => {
    const options = args[9];
    options?.onWritingEvent?.({ kind: "rewrite", chapter: "通知规则", chapterId: written.sections[0].id, reasons: ["condition"], scope: "part" });
    options?.onWritingEvent?.({ kind: "chapter", chapter: "通知规则", chapterId: written.sections[0].id });
    options?.onPartial?.(written);
    await new Promise<void>(resolve => { finishGeneration = resolve; });
    return written;
  });
  const extractor = vi.spyOn(atlasAI, "createAtlasAI");
  const sidebar = <NativeProjects zh onToggleLanguage={vi.fn()} conversationId={chat.id} conversationTitle={`${chat.title} - ChatGPT`} canInsert platformLabel="ChatGPT"/>;
  const first = render(sidebar);
  fireEvent.click(await screen.findByRole("button", { name: project.title }));
  fireEvent.click(screen.getByRole("button", { name: "更新项目" }));
  await waitFor(async () => {
    const [draft] = await db.getAll("sidecarUpdateDrafts");
    expect({ commands: sendMessage.mock.calls.map(([sent]) => sent.type), state: draft?.initialRun?.state,
      partial: draft?.initialRun?.partial?.sections.length, log: draft?.initialLog?.at(-1)?.code }).toMatchObject({ state: "running", partial: 1 });
  }, { timeout: 6000 });
  const progress = screen.getByRole("region", { name: "首版整理进度" });
  const pause = within(progress).getByRole("button", { name: "暂停整理" });
  expect(pause.parentElement).toBe(within(progress).getByRole("button", { name: "生成日志" }).parentElement);
  const writtenChapter = await within(progress).findByRole("button", { name: "通知规则" });
  fireEvent.click(writtenChapter);
  expect(await within(progress).findByText(content, { selector: "p" })).toBeVisible();
  expect(writtenChapter).toHaveAttribute("aria-expanded", "true");
  fireEvent.click(writtenChapter);
  expect(writtenChapter).toHaveAttribute("aria-expanded", "false");
  expect(screen.queryByText(content)).not.toBeInTheDocument();
  first.unmount();
  function WorkbenchProgress() {
    const draft = useFirstWikiDraft(project.canvasId);
    return draft ? <FirstWikiPanel draft={draft} zh onSettings={() => undefined}/> : null;
  }
  const workbench = render(<WorkbenchProgress/>);
  expect(await screen.findByRole("button", { name: "通知规则" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "生成日志" }));
  expect(await screen.findByText("通知规则 · 已写完")).toBeVisible();
  expect(screen.getByText("遗漏条件、例外或否定限制")).toBeVisible();
  finishGeneration();
  await screen.findByRole("button", { name: "保存首版" });
  workbench.unmount();
  render(sidebar);
  fireEvent.click(await screen.findByRole("button", { name: project.title }));
  const review = await screen.findByRole("region", { name: "首版文档预览" }, { timeout: 8000 });
  const saveFirst = await screen.findByRole("button", { name: "保存首版" });
  expect(saveFirst.closest("footer")?.parentElement).toBe(screen.getByRole("main"));
  expect(saveFirst.closest("footer")).toContainElement(screen.getByRole("button", { name: "丢弃草稿" }));
  expect(screen.queryByRole("button", { name: "查看首版预览" })).not.toBeInTheDocument();
  fireEvent.click(within(review).getByRole("button", { name: "通知规则" }));
  expect(within(review).getByText(content, { selector: "p" })).toBeVisible();
  expect(within(review).queryByText(/^出处\s*\d*$/u)).not.toBeInTheDocument();
  expect((await db.get("focusSessions", project.id))?.sections).toEqual([]);
  fireEvent.click(saveFirst);
  const savedNotice = await screen.findByText("已保存首版文档。");
  expect(savedNotice).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "关闭提示" }));
  expect(savedNotice).not.toBeInTheDocument();
  expect(await db.count("sidecarUpdateDrafts")).toBe(0);
  expect(screen.getByRole("button", { name: "撤销上次写入" }).closest("footer")?.parentElement).toBe(screen.getByRole("main"));
  fireEvent.click(screen.getByRole("button", { name: "通知规则" }));
  await db.put("messages", { ...message, content: "修改后的消息" });
  expect(screen.queryByText(/这里展示的是旧候选/)).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "查看原话" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /核对依据/ })).not.toBeInTheDocument();
  const highlights = new Map<string, Range[]>();
  vi.stubGlobal("CSS", { highlights });
  vi.stubGlobal("Highlight", class { constructor(...ranges: Range[]) { return ranges; } });
  const toggle = await screen.findByRole("button", { name: "显示出处" });
  fireEvent.click(toggle);
  const cards = await screen.findByRole("group", { name: "按状态查阅依据" });
  expect(screen.queryByText(/本章来源/)).not.toBeInTheDocument();
  expect(highlights.get("atlas-holder-decided")?.map(range => range.toString())).toEqual([content]);
  fireEvent.click(within(cards).getByRole("button", { name: "已定 1" }));
  const excerpt = screen.getByRole("complementary", { name: "出处预览" });
  expect(within(excerpt).getByText(content)).toBeVisible();
  fireEvent.click(within(excerpt).getByRole("button", { name: "查看上下文" }));
  const source = screen.getByRole("region", { name: "对话原文" });
  expect(await within(source).findByText(content)).toBeVisible();
  expect(source.querySelector("mark")).toBeNull();
  fireEvent.click(within(source).getByRole("button", { name: "返回" }));
  expect(screen.getByRole("heading", { name: "通知规则" })).toBeVisible();
  fireEvent.click(toggle);
  expect(highlights.has("atlas-holder-decided")).toBe(false);
  expect(sendMessage.mock.calls.filter(([sent]) => sent.type === "ATLAS_SIDECAR_SYNC")).toEqual([[{ type: "ATLAS_SIDECAR_SYNC", conversationId: chat.id }]]);
  expect(extractor).not.toHaveBeenCalled();
  expect(generateFocusSession).toHaveBeenCalledOnce();
  expect(vi.mocked(generateFocusSession).mock.calls[0][9]).toMatchObject({ complete: true, initialWritingMode: "handoff" });
});

it("imports first, then accepts choices and custom answers while leaving skipped questions open", async () => {
  const db = await getDatabase();
  const empty = await createLivingProject("番茄钟", "", "zh-CN");
  const project = await saveManualWikiChapter(empty, undefined, "现有手稿", "项目已有目标。", true);
  await db.put("aiSettings", { id: "ai-settings", provider: "openai", baseUrl: "https://example.test", apiKey: "fixture", model: "fixture", updatedAt: 1 });
  const chat: Conversation = { id: "timer", title: "番茄钟 MVP", platform: "chatgpt", url: "", updatedAt: 1, messageCount: 2, hydrationState: "hydrated", importState: "complete" };
  const original = "结束时用声响还是桌面通知？休息时长也还没定。换设备后要不要同步，仍然待定。";
  const message: ConversationMessage = { id: "turn-1", conversationId: chat.id, role: "user", content: original, contentHash: original, preview: original, messageIndex: 0, createdAt: 1, updatedAt: 1 };
  const reply: ConversationMessage = { ...message, id: "turn-2", messageIndex: 1, role: "assistant", content: "也可以使用桌面通知。" };
  let finishImport!: () => void;
  const sendMessage = vi.fn(async () => {
    await new Promise<void>(resolve => { finishImport = resolve; });
    await db.put("conversations", chat);
    await db.put("messages", message);
    await db.put("messages", reply);
    return { ok: true, summary: { conversationId: chat.id } };
  });
  vi.stubGlobal("chrome", { runtime: { sendMessage } });
  const generateStructured: atlasAI.AtlasAI["generateStructured"] = async request => {
    const data = JSON.parse(request.prompt);
    if (data.presentation === "wiki_topic_plan") return request.validate(withWikiOutline({ pages: data.sections.map((section: { id: string; title: string }) => ({ title: section.title, question: section.title, group: "", sectionIds: [section.id] })) }));
    return request.validate({ changes: [
    { title: "提醒方式", kind: "open_question", text: "计时结束时用哪种提醒？", messageId: message.id, quote: "结束时用声响还是桌面通知？", options: [
      { label: "播放声响", messageId: message.id, quote: "声响" },
      { label: "使用桌面通知", messageId: reply.id, quote: "可以使用桌面通知" },
      { label: "发送邮件", messageId: message.id, quote: "邮件通知" },
    ] },
    { title: "休息时长", kind: "open_question", text: "休息多久？", messageId: message.id, quote: "休息时长也还没定。" },
    { title: "同步", kind: "open_question", text: "换设备后是否同步？", messageId: message.id, quote: "换设备后要不要同步，仍然待定。" },
    ] });
  };
  const model = vi.spyOn(atlasAI, "createAtlasAI").mockReturnValue({ generateStructured } as atlasAI.AtlasAI);

  render(<NativeProjects zh onToggleLanguage={vi.fn()} conversationId={chat.id} conversationTitle={chat.title} canInsert platformLabel="ChatGPT"/>);
  fireEvent.click(await screen.findByRole("button", { name: project.title }));
  fireEvent.click(screen.getByRole("button", { name: "更新项目" }));
  const importButton = await screen.findByRole("button", { name: "导入并更新" });
  expect(importButton.closest(".native-update-card")).toContainElement(screen.getByRole("combobox", { name: "写作模式" }));
  expect(sendMessage).not.toHaveBeenCalled();
  expect(model).not.toHaveBeenCalled();
  fireEvent.click(importButton);
  expect(await screen.findByRole("progressbar", { name: "正在导入当前对话…" })).not.toHaveAttribute("value");
  expect(sendMessage).toHaveBeenCalledExactlyOnceWith({ type: "ATLAS_SIDECAR_SYNC", conversationId: chat.id });
  finishImport();
  const question = await screen.findByRole("form", { name: "写作前确认" }, { timeout: 8000 });
  expect(question).toHaveTextContent("计时结束时用哪种提醒？");
  expect((await db.get("focusSessions", project.id))?.sections).toEqual(project.sections);
  expect(within(question).getAllByRole("radio")).toHaveLength(2);
  expect(within(question).queryByRole("radio", { name: "发送邮件" })).not.toBeInTheDocument();
  expect(within(question).queryByRole("textbox")).not.toBeInTheDocument();
  expect(within(question).getByRole("button", { name: "确认并继续" })).toBeDisabled();
  fireEvent.click(within(question).getByRole("radio", { name: "使用桌面通知" }));
  fireEvent.click(within(question).getByRole("button", { name: "确认并继续" }));
  const review = await screen.findByRole("region", { name: "本轮更新" });
  const rest = within(review).getByRole("checkbox", { name: "休息时长" }).closest("li")!;
  fireEvent.click(within(rest).getByRole("button", { name: "现在回答" }));
  expect(await screen.findByRole("heading", { name: "休息多久？" })).toBeVisible();
  expect(screen.queryByRole("radio")).not.toBeInTheDocument();
  fireEvent.change(screen.getByRole("textbox", { name: "你的决定" }), { target: { value: "休息 5 分钟。" } });
  fireEvent.click(screen.getByRole("button", { name: "稍后继续" }));
  fireEvent.click(await screen.findByRole("button", { name: "继续核对" }));
  expect(await screen.findByRole("textbox", { name: "你的决定" })).toHaveValue("休息 5 分钟。");
  fireEvent.click(screen.getByRole("button", { name: "确认并继续" }));
  expect(await screen.findByText("换设备后是否同步？")).toBeVisible();
  expect(screen.getByText("使用桌面通知")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "写入所选" }));
  expect(await screen.findByText("已写入 3 条更新。")).toBeVisible();
  const saved = (await listFocusSessions()).find(session => session.previousSessionId === project.id)!;
  expect(saved.sections[1]).toMatchObject({ body: "使用桌面通知", origin: "user",
    claims: [{ text: "使用桌面通知", quote: "可以使用桌面通知", userDecided: true, evidenceIds: [saved.evidence[1].id] }] });
  expect(saved.evidence[0]?.excerpt).toBe("结束时用声响还是桌面通知？");
  expect(saved.evidence[1]).toMatchObject({ messageId: reply.id, excerpt: "可以使用桌面通知" });
  expect(saved.sections[1].evidenceIds).toContain(saved.evidence[1].id);
  expect(saved.sections[2]).toMatchObject({ body: "休息 5 分钟。", origin: "user" });
  expect(saved.sections[3]).toMatchObject({ kind: "open_question", body: "换设备后是否同步？" });
  expect(model).toHaveBeenCalledTimes(1);
});

it("treats a title-only record as needing import and keeps capture errors actionable", async () => {
  const db = await getDatabase();
  const project = await createLivingProject("番茄钟", "", "zh-CN");
  const chat: Conversation = { id: "pending", title: "只有标题", platform: "chatgpt", url: "", updatedAt: 1, messageCount: null };
  await db.put("conversations", chat);
  const sendMessage = vi.fn().mockResolvedValue({ ok: false, error: "Cannot read properties of undefined (reading 'map')" });
  vi.stubGlobal("chrome", { runtime: { sendMessage } });
  render(<NativeProjects zh onToggleLanguage={vi.fn()} conversationId={chat.id} conversationTitle={chat.title} canInsert platformLabel="ChatGPT"/>);
  fireEvent.click(await screen.findByRole("button", { name: project.title }));
  fireEvent.click(screen.getByRole("button", { name: "更新项目" }));
  fireEvent.click(await screen.findByRole("button", { name: "导入并更新" }));
  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent("没有读取到当前对话。请刷新页面后重试。");
  expect(alert.closest(".native-update-card")).toContainElement(screen.getByRole("button", { name: "重试" }));
  expect(screen.queryByText(/undefined/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "重试" }));
  await waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(2));
  await screen.findByRole("alert");
});

it("resumes persisted batches after reopening and leaves an unmatched citation pending", async () => {
  const db = await getDatabase();
  const empty = await createLivingProject("番茄钟", "", "zh-CN");
  const project = await saveManualWikiChapter(empty, undefined, "现有手稿", "项目已有目标。", true);
  await db.put("aiSettings", { id: "ai-settings", provider: "openai", baseUrl: "https://example.test", apiKey: "fixture", model: "fixture", updatedAt: 1 });
  const chat: Conversation = { id: "timer", title: "番茄钟 MVP", platform: "chatgpt", url: "", updatedAt: 1, messageCount: 3, hydrationState: "hydrated", importState: "complete" };
  await db.put("conversations", chat);
  const rules = ["默认专注时长为二十五分钟。", "结束后播放提醒。", "暂停时保留剩余时间。"];
  for (const [i, rule] of rules.entries()) {
    const content = `${rule}\n\n${"Extra discussion. ".repeat(410)}`;
    await db.put("messages", { id: `msg-${i}`, conversationId: chat.id, role: "user", content, contentHash: content, preview: content, messageIndex: i, createdAt: i, updatedAt: 1 });
  }
  const sendMessage = vi.fn().mockResolvedValue({ ok: true });
  vi.stubGlobal("chrome", { runtime: { sendMessage } });
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", { userAgent: navigator.userAgent, clipboard: { writeText } });
  let generations = 0;
  let interrupted = false;
  const generateStructured: atlasAI.AtlasAI["generateStructured"] = async request => {
    const data = JSON.parse(request.prompt);
    if (data.presentation === "wiki_topic_plan") return request.validate(withWikiOutline({ pages: [{ title: "计时体验", question: "计时如何运作？", group: "产品", sectionIds: data.sections.map((section: { id: string }) => section.id) }] }));
    const index = generations;
    if (index === 1 && !interrupted) {
      interrupted = true;
      await new Promise<void>((_, reject) => request.signal?.addEventListener("abort", () => reject(request.signal?.reason), { once: true }));
    }
    generations++;
    const messageId = `msg-${index}`;
    const changes = [{ title: `规则 ${index + 1}`, text: rules[index], kind: "finding", messageId, quote: rules[index] }];
    if (index === 1) changes.push({ title: "无依据规则", text: "自动重置计时器。", kind: "finding", messageId, quote: "无对应原话的引用" });
    const result = request.validate({ changes });
    expect(request.cacheIf?.(result)).toBe(index !== 1);
    return result;
  };
  vi.spyOn(atlasAI, "createAtlasAI").mockReturnValue({ generateStructured } as atlasAI.AtlasAI);
  const sidebar = <NativeProjects zh onToggleLanguage={vi.fn()} conversationId={chat.id} conversationTitle={chat.title} canInsert platformLabel="ChatGPT"/>;
  const first = render(sidebar);
  fireEvent.click(await screen.findByRole("button", { name: project.title }));
  fireEvent.click(screen.getByRole("button", { name: "更新项目" }));
  expect(await screen.findByText("1 / 3")).toBeVisible();
  first.unmount();
  const resumed = render(sidebar);
  fireEvent.click(await screen.findByRole("button", { name: project.title }));
  expect(await screen.findByText("整理进度 · 1 / 3")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "继续整理" }));
  expect(await screen.findByRole("heading", { name: "本轮更新" })).toBeVisible();
  expect(screen.getByText("1 条建议未能定位原话，暂未纳入。")).toBeVisible();
  expect(screen.queryByText("无依据规则")).not.toBeInTheDocument();
  expect(screen.getByRole("checkbox", { name: "规则 3" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "更新日志" }));
  const log = screen.getByRole("region", { name: "更新日志" });
  expect(within(log).getByText("提取更新 · 部分通过")).toBeVisible();
  expect(within(log).getByText("规划章节目录 · 完成")).toBeVisible();
  expect(log).toHaveTextContent("PROVIDER_SCHEMA_sidecar_source");
  fireEvent.click(within(log).getByRole("button", { name: "复制日志" }));
  expect(await within(log).findByText("日志已复制。")).toBeVisible();
  const copied = writeText.mock.calls[0][0];
  expect(JSON.parse(copied).entries).toContainEqual(expect.objectContaining({
    stage: "analyzing", state: "partial", code: "PROVIDER_SCHEMA_sidecar_source", completed: 3, total: 3,
    unmatchedCitations: 1, fields: ["changes[1].quote"],
  }));
  expect(copied).not.toMatch(/无对应原话的引用|番茄钟|暂停时保留剩余时间|example\.test/);
  fireEvent.click(screen.getByText("章节建议"));
  fireEvent.click(screen.getByRole("checkbox", { name: "写入时应用章节建议" }));
  fireEvent.click(screen.getByRole("button", { name: "写入所选" }));
  await screen.findByText(/已写入 3 条更新/);
  const saved = (await listFocusSessions()).find(session => session.previousSessionId === project.id)!;
  expect(saved).toMatchObject({
    sections: [expect.objectContaining({ title: "现有手稿" }), expect.objectContaining({ title: "计时体验", body: expect.stringContaining(rules[2]), claims: expect.arrayContaining(rules.map(text => expect.objectContaining({ text }))) })],
    evidence: rules.map(excerpt => expect.objectContaining({ excerpt, sourceVersionId: expect.any(String) })),
  });
  expect(saved.sourceVersionIds?.[chat.id]).toBeUndefined();
  expect(sendMessage.mock.calls).toEqual([[{ type: "ATLAS_SIDECAR_SYNC", conversationId: chat.id }], [{ type: "ATLAS_PROJECT_VERSION_SAVED" }]]);
  expect(generations).toBe(3);
  resumed.unmount();
  render(sidebar);
  fireEvent.click(await screen.findByRole("button", { name: project.title }));
  fireEvent.click(screen.getByRole("button", { name: "更新日志" }));
  expect(screen.getByRole("region", { name: "更新日志" })).toHaveTextContent("PROVIDER_SCHEMA_sidecar_source");
});

it("opens a project's Wiki in the sidebar and offers direct navigation to workbench home", async () => {
  const sendMessage = vi.fn().mockResolvedValue({ ok: true });
  vi.stubGlobal("chrome", { runtime: { sendMessage } });
  const db = await getDatabase();
  const project = { ...projectSession(), canvasId: "wiki-workspace" };
  project.goal = "以前填写的项目简介";
  project.sections.push({ ...project.sections[0], id: "next", title: "后续计划", body: "下一章保留已确认的实施步骤。" });
  await db.put("focusSessions", project);
  render(<NativeProjects zh onToggleLanguage={vi.fn()} conversationId="other" conversationTitle="另一段对话" canInsert platformLabel="Claude"/>);

  expect(screen.queryByRole("button", { name: "查找历史消息" })).not.toBeInTheDocument();
  fireEvent.click(await screen.findByRole("button", { name: project.title }));
  expect(screen.getByRole("tablist", { name: "项目工作区" })).toBeVisible();
  const wiki = screen.getByRole("region", { name: "项目 Wiki" });
  expect(within(wiki).getByRole("heading", { name: "章节目录" })).toBeVisible();
  expect(screen.queryByText(project.goal)).not.toBeInTheDocument();
  expect(screen.getByRole("heading", { name: project.title }).parentElement?.nextElementSibling).toHaveTextContent("Claude · 另一段对话");
  const chatActions = screen.getByRole("group", { name: "项目操作" });
  expect(within(chatActions).getByRole("button", { name: "更新项目" })).toHaveTextContent(/^$/);
  expect(within(chatActions).queryByRole("button", { name: "带入上下文" })).not.toBeInTheDocument();
  const exportButton = within(chatActions).getByRole("button", { name: "导出 Markdown" });
  expect(exportButton).toHaveTextContent(/^$/);
  fireEvent.click(exportButton);
  const exportTray = screen.getByRole("region", { name: "导出 Markdown" });
  expect(within(exportTray).getByRole("button", { name: "开发" })).toBeVisible();
  expect(within(exportTray).getByRole("button", { name: "精简" })).toBeVisible();
  expect(within(exportTray).getByRole("button", { name: "审计" })).toBeVisible();
  fireEvent.click(within(exportTray).getByRole("button", { name: "下载 .md" }));
  await waitFor(() => expect(downloadFile).toHaveBeenCalledWith(expect.stringContaining(project.sections[1].body), `${project.title}.md`, "text/markdown;charset=utf-8"), { timeout: 8000 });
  expect(sendMessage).not.toHaveBeenCalled();
  fireEvent.click(within(wiki).getByRole("button", { name: "核心流程" }));
  expect(await within(wiki).findByText(/需求采集提取目标与约束/)).toBeVisible();
  expect(within(wiki).getByText("1 / 2")).toBeVisible();
  expect(screen.queryByRole("tablist", { name: "项目工作区" })).not.toBeInTheDocument();
  expect(screen.queryByRole("tabpanel")).not.toBeInTheDocument();
  fireEvent.click(within(wiki).getByRole("button", { name: "下一章" }));
  expect(await within(wiki).findByText("下一章保留已确认的实施步骤。")).toBeVisible();
  expect(within(wiki).getByText("2 / 2")).toBeVisible();

  fireEvent.click(within(wiki).getByRole("button", { name: "打开工作区" }));
  await waitFor(() => expect(sendMessage).toHaveBeenLastCalledWith({ type: "ATLAS_OPEN_REVIEW", sessionId: project.id, sectionId: "next" }));
  fireEvent.click(within(wiki).getByRole("button", { name: "章节目录" }));
  expect(within(wiki).getByRole("button", { name: "核心流程" })).toBeVisible();
  expect(screen.getByRole("tablist", { name: "项目工作区" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "打开工作台首页" }));
  await waitFor(() => expect(sendMessage).toHaveBeenLastCalledWith({ type: "ATLAS_OPEN", home: true }));
});

it("creates, edits, and exports a project without an active chat, and keeps the mode and previous versions", async () => {
  vi.stubGlobal("chrome", { runtime: { sendMessage: vi.fn() } });
  render(<NativeProjects zh onToggleLanguage={vi.fn()} conversationId="" conversationTitle="" canInsert={false} platformLabel=""/>);
  fireEvent.click(screen.getByRole("button", { name: "新建" }));
  expect(screen.getAllByRole("textbox")).toHaveLength(1);
  fireEvent.change(screen.getByRole("textbox", { name: "项目名称" }), { target: { value: "新项目" } });
  const mode = screen.getByRole("combobox", { name: "写作模式" });
  expect(within(mode).getAllByRole("option").map(option => option.textContent)).toEqual(["精简定稿", "开发规格", "完整审计"]);
  fireEvent.change(mode, { target: { value: "audit" } });
  fireEvent.click(screen.getByRole("button", { name: "创建项目" }));
  expect(await screen.findByRole("heading", { name: "新项目" })).toBeVisible();
  expect(screen.getByRole("combobox", { name: "写作模式" })).toHaveValue("audit");
  fireEvent.click(screen.getByRole("button", { name: "导出 Markdown" }));
  await waitFor(() => expect(downloadFile).toHaveBeenCalledWith("# 新项目\n", "新项目.md", "text/markdown;charset=utf-8"));
  fireEvent.click(screen.getByRole("button", { name: "新建章节" }));
  fireEvent.change(await screen.findByRole("textbox", { name: "章节标题" }), { target: { value: "实施步骤" } });
  fireEvent.change(screen.getByRole("textbox", { name: "章节内容" }), { target: { value: "- [ ] 验证数据" } });
  fireEvent.click(screen.getByRole("button", { name: "保存" }));
  expect(await screen.findByText("验证数据")).toBeVisible();

  fireEvent.click(screen.getByRole("button", { name: "编辑" }));
  fireEvent.change(await screen.findByRole("textbox", { name: "章节内容" }), { target: { value: "- [x] 验证数据" } });
  fireEvent.click(screen.getByRole("button", { name: "保存" }));
  expect(await screen.findByRole("checkbox")).toBeChecked();
  fireEvent.click(screen.getByRole("button", { name: "章节目录" }));
  fireEvent.change(screen.getByRole("combobox", { name: "写作模式" }), { target: { value: "handoff" } });
  expect(await screen.findByText("下次从对话更新时使用此模式。")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "导出 Markdown" }));
  const tray = screen.getByRole("region", { name: "导出 Markdown" });
  expect(within(tray).getByRole("button", { name: "开发" })).toHaveAttribute("aria-pressed", "true");
  fireEvent.click(within(tray).getByRole("button", { name: "下载 .md" }));
  await waitFor(() => expect(downloadFile).toHaveBeenLastCalledWith(expect.stringContaining("- [x] 验证数据"), "新项目.md", "text/markdown;charset=utf-8"));

  const sessions = await (await getDatabase()).getAll("focusSessions");
  expect(sessions).toHaveLength(3);
  expect(sessions).toContainEqual(expect.objectContaining({ sections: [expect.objectContaining({ body: "- [ ] 验证数据" })] }));
  const latest = sessions.find(session => session.sidecarWritingMode === "handoff");
  expect(latest?.sections[0]).toMatchObject({ userEdited: true, origin: "user", body: "- [x] 验证数据" });
});

it("keeps files and sticky notes beside the document without writing them into the Wiki", async () => {
  const project = await createLivingProject("工作区", "", "zh-CN");
  vi.stubGlobal("chrome", { runtime: { sendMessage: vi.fn() } });
  render(<NativeProjects zh onToggleLanguage={vi.fn()} conversationId="chat" conversationTitle="当前对话" canInsert platformLabel="ChatGPT"/>);
  fireEvent.click(await screen.findByRole("button", { name: project.title }));
  expect(screen.getByRole("tab", { name: "文档" })).toHaveAttribute("aria-selected", "true");
  fireEvent.click(screen.getByRole("tab", { name: "资料" }));
  expect(await screen.findByText("拖入、粘贴或点击添加资料")).toBeVisible();
  expect(screen.queryByRole("checkbox", { name: "自动收录本页上传" })).toBeNull();
  fireEvent.click(screen.getByRole("tab", { name: "便利贴" }));
  const create = screen.getByRole("button", { name: "新建" });
  await waitFor(() => expect(create).toBeEnabled());
  fireEvent.click(create);
  fireEvent.change(screen.getByRole("textbox", { name: "便利贴内容" }), { target: { value: "待会儿问暂停规则" } });
  fireEvent.click(screen.getByRole("button", { name: "保存" }));
  expect(within(await screen.findByRole("list", { name: "已保存的便利贴" })).getByText("待会儿问暂停规则")).toBeVisible();
  expect((await projectDesk(project.canvasId!)).notes[0].text).toBe("待会儿问暂停规则");
  const clipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  try {
    fireEvent.click(screen.getByRole("button", { name: "复制便利贴" }));
    expect(writeText).toHaveBeenCalledExactlyOnceWith("待会儿问暂停规则");
    expect(await screen.findByText(/已复制便利贴/)).toBeVisible();
  } finally {
    if (clipboard) Object.defineProperty(navigator, "clipboard", clipboard);
    else Reflect.deleteProperty(navigator, "clipboard");
  }
  fireEvent.click(screen.getByRole("tab", { name: "文档" }));
  expect(screen.queryByText("待会儿问暂停规则")).not.toBeInTheDocument();
  expect((await (await getDatabase()).get("focusSessions", project.id))?.sections).toEqual([]);
});

it("switches three export presets, copies Markdown, renders chapter outline, and shows live delta notice", async () => {
  vi.stubGlobal("chrome", { runtime: { sendMessage: vi.fn() } });
  const db = await getDatabase();
  const project = projectSession();
  project.sidecarWritingMode = "handoff";
  project.sections[0] = {
    ...project.sections[0],
    body: "### 数据模型\n\n使用本地 JSON。\n\n### 规则校验\n\n校验引脚和电压冲突。",
  };
  const chatId = project.sourceConversationIds[0];
  project.sourceSignatures = { [chatId]: { "m-old": "existing-sig" } };
  await db.put("focusSessions", project);
  await db.put("conversations", {
    id: chatId, title: "硬件讨论", platform: "chatgpt", url: "", updatedAt: Date.now(), messageCount: 2,
    hydrationState: "hydrated", hydratedSourceUpdatedAt: Date.now(),
  });
  await db.put("messages", { id: "m-old", conversationId: chatId, role: "user", content: "原有硬件需求。", messageIndex: 0, preview: "原有硬件需求。", contentHash: "h-old", createdAt: 1, updatedAt: 1 });
  await db.put("messages", { id: "m-new-1", conversationId: chatId, role: "user", content: "补充一条新约束：只做低压模块。", messageIndex: 1, preview: "补充一条新约束：只做低压模块。", contentHash: "h-new-1", createdAt: 2, updatedAt: 2 });

  render(<NativeProjects zh onToggleLanguage={vi.fn()} conversationId={chatId} conversationTitle="硬件讨论" canInsert platformLabel="ChatGPT"/>);
  fireEvent.click(await screen.findByRole("button", { name: project.title }));

  expect(await screen.findByText(/当前对话有更新 · 新增 1 条/)).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "导出 Markdown" }));
  const tray = screen.getByRole("region", { name: "导出 Markdown" });
  expect(within(tray).getByRole("button", { name: "开发" })).toHaveAttribute("aria-pressed", "true");
  fireEvent.click(within(tray).getByRole("button", { name: "精简" }));
  expect(within(tray).getByRole("button", { name: "精简" })).toHaveAttribute("aria-pressed", "true");

  const clipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  try {
    fireEvent.click(within(tray).getByRole("button", { name: "复制 Markdown" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(writeText.mock.calls[0][0]).toContain("使用本地 JSON");
    expect(await screen.findByText("已复制精简版 Markdown。")).toBeVisible();
  } finally {
    if (clipboard) Object.defineProperty(navigator, "clipboard", clipboard);
    else Reflect.deleteProperty(navigator, "clipboard");
  }

  const wiki = screen.getByRole("region", { name: "项目 Wiki" });
  fireEvent.click(within(wiki).getByRole("button", { name: "核心流程" }));
  const tocToggle = await within(wiki).findByRole("button", { name: /本节大纲 · 2/ });
  fireEvent.click(tocToggle);
  expect(within(wiki).getByRole("button", { name: "数据模型" })).toBeVisible();
  expect(within(wiki).getByRole("button", { name: "规则校验" })).toBeVisible();
});

it("shows clean files tab without auto-upload toggle and supports dragging, pinning, and inserting sticky notes", async () => {
  const sendMessage = vi.fn().mockResolvedValue({ ok: true });
  vi.stubGlobal("chrome", { runtime: { sendMessage, onMessage: { addListener: vi.fn(), removeListener: vi.fn() } } });
  const db = await getDatabase();
  const project = { ...projectSession(), canvasId: undefined, rootSessionId: "wb-only-root" };
  await db.put("focusSessions", project);
  render(<NativeProjects zh onToggleLanguage={vi.fn()} conversationId="chat-wb" conversationTitle="当前对话" canInsert platformLabel="ChatGPT"/>);
  fireEvent.click(await screen.findByRole("button", { name: project.title }));
  expect(screen.getByRole("tablist", { name: "项目工作区" })).toBeVisible();
  expect(screen.getByRole("tab", { name: "资料" })).toBeVisible();
  expect(screen.getByRole("tab", { name: "便利贴" })).toBeVisible();

  fireEvent.click(screen.getByRole("tab", { name: "资料" }));
  expect(await screen.findByText("拖入、粘贴或点击添加资料")).toBeVisible();
  expect(screen.queryByRole("checkbox", { name: "自动收录本页上传" })).toBeNull();

  fireEvent.click(screen.getByRole("tab", { name: "便利贴" }));
  fireEvent.click(await screen.findByRole("button", { name: "新建" }));
  const input = screen.getByRole("textbox", { name: "便利贴内容" });
  fireEvent.change(input, { target: { value: "请按现有接口定义输出完整代码" } });
  fireEvent.keyDown(input, { key: "Enter", ctrlKey: true });
  const list = await screen.findByRole("list", { name: "已保存的便利贴" });
  const noteText = within(list).getByText("请按现有接口定义输出完整代码");
  const card = noteText.closest("li")!;
  expect(card).toHaveAttribute("draggable", "true");

  const setData = vi.fn();
  fireEvent.dragStart(card, { dataTransfer: { effectAllowed: "", setData } });
  expect(setData).toHaveBeenCalledWith("text/plain", "请按现有接口定义输出完整代码");

  fireEvent.click(within(card).getByRole("button", { name: "置顶便利贴" }));
  expect(await within(card).findByText("置顶")).toBeVisible();

  fireEvent.click(within(card).getByRole("button", { name: "填入当前输入区" }));
  await waitFor(() => expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
    type: "ATLAS_SIDECAR_HANDOFF",
    conversationId: "chat-wb",
    text: "请按现有接口定义输出完整代码",
  })));

  // Dragging selected text from an AI conversation into the sticky notes panel creates a new note.
  const notesPanel = screen.getByRole("region", { name: "项目便利贴" });
  const externalDrag = {
    types: ["text/plain"],
    dropEffect: "",
    getData: (type: string) => type === "text/plain" ? "优先采用本地 SQLite 同步方案" : "",
  };
  fireEvent.dragOver(notesPanel, { dataTransfer: externalDrag });
  expect(screen.getByText("松开鼠标，直接存为便利贴")).toBeVisible();
  fireEvent.drop(notesPanel, { dataTransfer: externalDrag });
  expect(await within(screen.getByRole("list", { name: "已保存的便利贴" })).findByText("优先采用本地 SQLite 同步方案")).toBeVisible();

  // Dropping our own sticky card back onto the panel must NOT duplicate it.
  fireEvent.drop(notesPanel, {
    dataTransfer: {
      types: ["text/plain", "application/x-atlas-sticky"],
      getData: (type: string) => type === "text/plain" ? "请按现有接口定义输出完整代码" : "self-id",
    },
  });
  expect(within(screen.getByRole("list", { name: "已保存的便利贴" })).getAllByRole("listitem")).toHaveLength(2);

  // Dragging selected text directly onto the Notes tab while reading Document saves and switches tabs.
  fireEvent.click(screen.getByRole("tab", { name: "文档" }));
  const notesTab = screen.getByRole("tab", { name: "便利贴" });
  const tabDrop = {
    types: ["text/plain"],
    dropEffect: "",
    getData: (type: string) => type === "text/plain" ? "切页拖入的接口约束" : "",
  };
  fireEvent.dragOver(notesTab, { dataTransfer: tabDrop });
  fireEvent.drop(notesTab, { dataTransfer: tabDrop });
  await waitFor(() => expect(notesTab).toHaveAttribute("aria-selected", "true"));
  expect(await within(await screen.findByRole("list", { name: "已保存的便利贴" })).findByText("切页拖入的接口约束")).toBeVisible();
});
