import "fake-indexeddb/auto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SidecarMemory } from "./SidecarMemory";
import { getDatabase } from "../storage/db";
import { clearDiscussionHighlightCache } from "./discussion-highlights";
import { highlightSource, highlightMessages } from "../test/discussion-highlight-fixture";
import * as memory from "./context-engine";
import { discussionHighlightId } from "../storage/discussion-highlights";

const open = vi.fn(), send = vi.fn();
beforeEach(async () => {
  vi.clearAllMocks(); clearDiscussionHighlightCache(); vi.stubGlobal("fetch", vi.fn()); vi.stubGlobal("chrome", { runtime: { sendMessage: send } }); send.mockResolvedValue({ ok: false, error: "旧消息未加载" });
  const db = await getDatabase(); for (const name of ["messages", "conversations", "discussionHighlights", "conversationGraphs", "contextFavorites", "sidecarSearches"] as const) await db.clear(name);
  await db.put("conversations", highlightSource); for (const message of highlightMessages()) await db.put("messages", message);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it("keeps search clear of discussion highlights even with saved data and after clearing the query",async()=>{
  const db=await getDatabase();await db.put("discussionHighlights",{id:"kept",conversationId:highlightSource.id,messageId:highlightMessages()[0].id,title:"已有重点",updatedAt:1});
  render(<SidecarMemory conversations={[highlightSource]} conversationId={highlightSource.id} zh view="home" onView={vi.fn()} onOpen={open}/>);
  const query=screen.getByRole("searchbox");
  expect(screen.queryByText("重点讨论")).toBeNull();expect(screen.queryByText("已有重点")).toBeNull();
  fireEvent.change(query,{target:{value:"方案"}});fireEvent.change(query,{target:{value:""}});
  expect(screen.queryByText("重点讨论")).toBeNull();expect(screen.queryByRole("button",{name:/标记一段讨论|管理.*重点/})).toBeNull();
  expect(await db.count("discussionHighlights")).toBe(1);expect(send).not.toHaveBeenCalled();expect(fetch).not.toHaveBeenCalled();
});

it("opens a search result in Reader without marking or bookmarking it", async () => {
  const db=await getDatabase(),messages=highlightMessages(),id=discussionHighlightId(highlightSource.id,messages[0].id);
  await db.put("discussionHighlights",{id,conversationId:highlightSource.id,messageId:messages[0].id,title:"我的原有标题",category:"个人分类",hidden:true,updatedAt:1});
  vi.spyOn(memory,"searchMemory").mockResolvedValue({hits:[{id:messages[1].id,conversation:highlightSource,message:messages[1],excerpt:messages[1].content}],ai:false});
  render(<SidecarMemory conversations={[highlightSource]} conversationId={highlightSource.id} zh view="home" onView={vi.fn()} onOpen={open}/>);
  fireEvent.change(screen.getByRole("searchbox"),{target:{value:"方案"}});fireEvent.click(screen.getByRole("button",{name:"查找历史"}));
  fireEvent.click(await screen.findByRole("button",{name:/^在 Reader 阅读：/u}));
  expect(open).toHaveBeenCalledWith(highlightSource,messages[1],undefined,expect.objectContaining({hits:expect.arrayContaining([expect.objectContaining({messageId:messages[1].id})])}));
  expect(await db.get("discussionHighlights",id)).toMatchObject({title:"我的原有标题",category:"个人分类",hidden:true});
  expect(screen.queryByRole("button",{name:"快速预览"})).toBeNull();expect(await db.count("contextFavorites")).toBe(0);
});
it("keeps the search and its results when the open tab changes to the workbench or another chat", async () => {
  const messages = highlightMessages();
  vi.spyOn(memory, "searchMemory").mockResolvedValue({ hits: [{ id: messages[1].id, conversation: highlightSource, message: messages[1], excerpt: messages[1].content }], ai: false });
  const props = { conversations: [highlightSource], zh: true, view: "home" as const, onView: vi.fn(), onOpen: open };
  const view = render(<SidecarMemory {...props} conversationId={highlightSource.id} />);
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "方案" } }); fireEvent.click(screen.getByRole("button", { name: "查找历史" }));
  await screen.findByRole("button", { name: /^在原平台定位：/u });
  // The workbench tab has no chat; another chat is a different one: neither clears what was found.
  view.rerender(<SidecarMemory {...props} conversationId="" />);
  expect(screen.getByRole("searchbox")).toHaveValue("方案"); expect(screen.getByRole("button", { name: /^在原平台定位：/u })).toBeVisible();
  view.rerender(<SidecarMemory {...props} conversationId="another-chat" />);
  expect(screen.getByRole("searchbox")).toHaveValue("方案"); expect(screen.getByRole("button", { name: /^在原平台定位：/u })).toBeVisible();
});
