import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SidecarKnowledgeResults } from "./SidecarKnowledgeResults";
import { searchKnowledge, knowledgeInsertText } from "./knowledge-search";
import { projectSession } from "../test/project-fixture";
import { COMPOSER_REFERENCE_DIVIDER } from "../shared/composer-reference";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const project = () => {
  const session = projectSession();
  session.sections = [
    { ...session.sections[0], id: "storage", title: "数据存储", body: "原始消息完整保存在 IndexedDB 中，索引层独立构建。" },
    { ...session.sections[0], id: "sidebar", title: "侧栏职责", body: "侧栏负责查找、带回上下文，不调用模型。" },
  ];
  return session;
};

it("finds saved Wiki chapters by title and body, best match first, without a model",()=>{
  const session = project();
  expect(searchKnowledge("侧栏", [session], true).map(hit => hit.sectionId)).toEqual(["sidebar"]);
  expect(searchKnowledge("IndexedDB 索引", [session], true)[0]).toMatchObject({ sectionId: "storage", project: session.title, chapter: "数据存储" });
  expect(searchKnowledge("完全无关的词", [session], true)).toEqual([]);
  expect(searchKnowledge("侧", [session], true)).toEqual([]);
});

it("quotes a chapter with the same source line and writing space as a related chat",()=>{
  const session = project();
  const text = knowledgeInsertText(session, "sidebar", true);
  expect(text).toBe(`以下是我在 ChatAtlas 中整理的项目知识，供参考：\n《${session.title}》 · 侧栏职责\n\n侧栏负责查找、带回上下文，不调用模型。\n\n${COMPOSER_REFERENCE_DIVIDER}\n`);
});

it("retains reading statuses and literal examples in the chapter while leaving out export furniture",()=>{
  const session = project(), ref = session.evidence[0];
  const code = "```text\n## **keep** [S-5-inside]\n\n\nline\n```";
  session.sections[1] = { ...session.sections[1], userEdited: true, body: `### **参考规则**\n\n侧栏负责查找。〔已定〕 [S-3-abc]\n\n**索引使用 \`IndexedDB\`。**\n\n原文来源 [S-3-abc]\n\n${code}\n\n| 名称 | 值 |\n| --- | --- |\n| 入口 | 侧栏 |`, evidenceIds: [ref.id] };
  const text = knowledgeInsertText(session, "sidebar", true);
  expect(text).toContain("参考规则\n\n侧栏负责查找。〔已定〕");
  expect(text).toContain("\n\n索引使用 `IndexedDB`。\n\n");
  expect(text).toContain(code);
  expect(text).toContain("| 名称 | 值 |\n| --- | --- |\n| 入口 | 侧栏 |");
  for (const noise of ["[S-3-abc]", "原文来源", "句末标记说明", "关键结论与来源", "本章来源", "演变记录", "\uE000"]) expect(text).not.toContain(noise);
});

it("opens the chapter in the workspace and fills the input box without replacing a draft",async()=>{
  const session = project(), hits = searchKnowledge("侧栏", [session], true);
  const send = vi.fn(async (message: { type: string }) => message.type === "ATLAS_SIDECAR_HANDOFF" ? { ok: false, reason: "draft" } : { ok: true });
  vi.stubGlobal("chrome", { runtime: { sendMessage: send } });
  render(<SidecarKnowledgeResults hits={hits} projects={[session]} conversationId="chat" canInsert zh/>);
  expect(screen.getByText("已整理的知识 · 1")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "在工作台打开：侧栏职责" }));
  expect(send).toHaveBeenCalledWith({ type: "ATLAS_OPEN_REVIEW", sessionId: session.id, sectionId: "sidebar" });
  fireEvent.click(screen.getByRole("button", { name: "插入输入框：侧栏职责" }));
  expect(await screen.findByText("输入框已有内容，未覆盖。请清空后再插入。")).toBeVisible();
  expect(send).toHaveBeenLastCalledWith(expect.objectContaining({ type: "ATLAS_SIDECAR_HANDOFF", conversationId: "chat" }));
  cleanup();
  render(<SidecarKnowledgeResults hits={hits} projects={[session]} conversationId="chat" canInsert={false} zh/>);
  expect(screen.queryByRole("button", { name: /^插入输入框/u })).toBeNull();
});

it("offers undo for exactly the quoted knowledge and keeps changes made after insertion",async()=>{
  const session = project(), hits = searchKnowledge("侧栏", [session], true);
  const send = vi.fn(async (message: { undo?: boolean }) => message.undo ? { ok: false, reason: "edited" } : { ok: true });
  vi.stubGlobal("chrome", { runtime: { sendMessage: send } });
  render(<SidecarKnowledgeResults hits={hits} projects={[session]} conversationId="chat" canInsert zh/>);
  fireEvent.click(screen.getByRole("button", { name: "插入输入框：侧栏职责" }));
  expect(await screen.findByRole("status")).toHaveTextContent("可在分割线下继续写");
  const text = knowledgeInsertText(session, "sidebar", true);
  expect(send).toHaveBeenLastCalledWith({ type: "ATLAS_SIDECAR_HANDOFF", conversationId: "chat", text });
  fireEvent.click(screen.getByRole("button", { name: "撤销" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("你已在输入框里继续写了");
  expect(send).toHaveBeenLastCalledWith({ type: "ATLAS_SIDECAR_HANDOFF", conversationId: "chat", text, undo: true });
});
