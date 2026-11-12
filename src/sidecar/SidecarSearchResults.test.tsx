import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { SidecarSearchResults } from "./SidecarSearchResults";
import { nearMatch } from "./search-excerpt";
import { highlightSource, highlightMessages } from "../test/discussion-highlight-fixture";
import type { ConversationMessage } from "../shared/types";

const stored = vi.hoisted(() => vi.fn<() => Promise<ConversationMessage[]>>(async () => []));
vi.mock("../storage/messages", () => ({ getMessagesForConversation: stored }));

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it("exposes native source location for supported AI results",async()=>{
 const send=vi.fn(async()=>({ok:true}));vi.stubGlobal("chrome",{runtime:{sendMessage:send}});
 const conversation={...highlightSource,id:"claude:thread",platform:"claude",url:"https://claude.ai/chat/thread"},message={...highlightMessages()[0],conversationId:"claude:thread"};
 render(<SidecarSearchResults hits={[{id:"hit",conversation,message,excerpt:"Original"}]} conversationId="claude:thread" zh onOpen={vi.fn()}/>);
 fireEvent.click(screen.getByRole("button",{name:"在原生 AI 中定位"}));await screen.findByText("已定位原文");expect(send).toHaveBeenCalledExactlyOnceWith({type:"ATLAS_SIDECAR_LOCATE",conversationId:"claude:thread",messageId:message.id});
});
it("separates native location from Reader and limits initial matches without losing them", async () => {
  const send = vi.fn(async () => ({ ok: true })), open = vi.fn();
  vi.stubGlobal("chrome", { runtime: { sendMessage: send } });
  const hits = highlightMessages().map(message => ({ id: message.id, conversation: highlightSource, message, excerpt: message.content }));
  render(<SidecarSearchResults hits={hits} conversationId={highlightSource.id} zh onOpen={open}/>);
  expect(screen.getAllByRole("listitem")).toHaveLength(3);expect(screen.queryByRole("checkbox")).toBeNull();
  const row = screen.getAllByRole("listitem")[1];
  fireEvent.click(within(row).getByRole("button", { name: "在原生 AI 中定位" }));
  await screen.findByText("已定位原文");
  expect(send).toHaveBeenCalledExactlyOnceWith({ type: "ATLAS_SIDECAR_LOCATE", conversationId: highlightSource.id, messageId: hits[1].message.id });expect(open).not.toHaveBeenCalled();
  fireEvent.click(within(row).getByRole("button", { name: "在 Reader 阅读" }));
  expect(open).toHaveBeenCalledWith(highlightSource, hits[1].message, undefined, undefined);
  fireEvent.click(screen.getByRole("button", { name: /更多匹配/ }));expect(screen.getAllByRole("listitem")).toHaveLength(hits.length);
});

it("switches matching conversations without losing results and locates another native conversation",async()=>{
 const send=vi.fn(async()=>({ok:true,located:false}));vi.stubGlobal("chrome",{runtime:{sendMessage:send}});
 const messages=highlightMessages(),other={...highlightSource,id:"other",title:"其他对话"};
 render(<SidecarSearchResults hits={[{id:"a",conversation:highlightSource,message:messages[0],excerpt:"原对话结果"},{id:"b",conversation:other,message:{...messages[1],conversationId:"other"},excerpt:"其他对话结果"}]} conversationId={highlightSource.id} zh onOpen={vi.fn()}/>);
 fireEvent.change(screen.getByRole("combobox",{name:"切换结果对话"}),{target:{value:"other"}});expect(screen.queryByText("原对话结果")).toBeNull();fireEvent.click(screen.getByRole("button",{name:"在原生 AI 中定位"}));await screen.findByText(/已打开原始对话/);expect(send).toHaveBeenCalledWith({type:"ATLAS_SIDECAR_OPEN_ORIGINAL",conversationId:"other",messageId:messages[1].id});
 fireEvent.change(screen.getByRole("combobox",{name:"切换结果对话"}),{target:{value:""}});expect(screen.getByText("原对话结果")).toBeVisible();
});
it.each(["newest","oldest"] as const)("sorts original message times, leaving undated imports last: %s",order=>{
 const message=highlightMessages()[0];const hits=[undefined,1000,3000,2000].map((sourceCreatedAt,index)=>({id:String(index),conversation:highlightSource,message:{...message,id:String(index),sourceCreatedAt,updatedAt:999999-index},excerpt:`result ${index}`}));
 render(<SidecarSearchResults hits={hits} conversationId="" zh order={order} onOpen={vi.fn()}/>);fireEvent.click(screen.getByRole("button",{name:/更多匹配/}));expect(screen.getAllByRole("listitem").map(row=>row.querySelector("p")?.textContent)).toEqual(order==="newest"?["result 2","result 3","result 1","result 0"]:["result 1","result 3","result 2","result 0"]);
});

it("reads a card's best match in the sidebar without moving the AI page, opens the full Reader from the icon, and returns to the same list",async()=>{
 const send=vi.fn(async()=>({ok:true})),open=vi.fn();vi.stubGlobal("chrome",{runtime:{sendMessage:send}});
 const all=highlightMessages();stored.mockResolvedValue(all);
 const hits=all.filter(message=>message.role==="assistant").map(message=>({id:message.id,conversation:highlightSource,message,excerpt:`关于方案的讨论：${message.content}`}));
 const outer=vi.fn();
 const {container}=render(<div onKeyDown={outer}><SidecarSearchResults compact query="方案" hits={hits} conversationId="other" zh onOpen={open}/></div>);
 expect(container.querySelector(".memory-source-main mark")?.textContent).toBe("方案");
 fireEvent.click(screen.getByRole("button",{name:`在侧栏阅读：${highlightSource.title}`}));
 // The question turn holding the match: the question, then its answer, marked as the match.
 const reading=await screen.findByRole("region",{name:`阅读：${highlightSource.title}`});
 await within(reading).findByText("问题 0：如何处理这项方案？");
 expect(reading.querySelector("[data-match]")?.getAttribute("data-message")).toBe(hits[0].message.id);
 expect(within(reading).getByText(`第 1 / ${hits.length} 处`)).toBeVisible();expect(within(reading).getByText(/第 1 \/ 4 问/u)).toBeVisible();
 expect(send).not.toHaveBeenCalled();expect(within(reading).queryByRole("button",{name:"引用到输入框"})).toBeNull();
 // The next match reads its own turn; a step between questions leaves a way back to the match.
 fireEvent.click(within(reading).getByRole("button",{name:"下一处匹配"}));
 await within(reading).findByText("问题 2：如何处理这项方案？");expect(reading.querySelector("[data-match]")?.getAttribute("data-message")).toBe(hits[1].message.id);
 fireEvent.click(within(reading).getByRole("button",{name:"下一问"}));
 await within(reading).findByText("问题 4：如何处理这项方案？");expect(reading.querySelector("[data-match]")).toBeNull();
 fireEvent.click(within(reading).getByRole("button",{name:"回到匹配"}));await within(reading).findByText("问题 2：如何处理这项方案？");
 fireEvent.click(within(reading).getByRole("button",{name:"完整 Reader"}));
 expect(open).toHaveBeenCalledWith(highlightSource,hits[1].message,undefined,expect.objectContaining({query:"方案",hits:expect.arrayContaining([expect.objectContaining({messageId:hits[0].message.id})])}));
 // Escape goes back to the results without reaching the sidebar's own Escape, which would close it.
 fireEvent.keyDown(reading,{key:"Escape"});expect(screen.queryByRole("region",{name:`阅读：${highlightSource.title}`})).toBeNull();expect(outer).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole("button",{name:`在侧栏阅读：${highlightSource.title}`}));fireEvent.click(within(await screen.findByRole("region",{name:`阅读：${highlightSource.title}`})).getByRole("button",{name:"结果"}));
 fireEvent.click(screen.getByRole("button",{name:`在完整 Reader 中打开：${highlightSource.title}`}));expect(open).toHaveBeenLastCalledWith(highlightSource,hits[0].message,undefined,expect.anything());
 // Another match opens at itself.
 fireEvent.click(screen.getByRole("button",{name:`另有 ${hits.length-1} 处`}));
 fireEvent.click(within(container.querySelector(".memory-source-matches") as HTMLElement).getAllByRole("button")[1]);
 const again=await screen.findByRole("region",{name:`阅读：${highlightSource.title}`});
 expect(within(again).getByText(`第 3 / ${hits.length} 处`)).toBeVisible();await within(again).findByText("问题 4：如何处理这项方案？");
 expect(send).not.toHaveBeenCalled();
});

it("inserts the question turn into the native input without sending, and offers no jump on the native page",async()=>{
 const send=vi.fn(async(message:{type:string})=>message.type==="ATLAS_SIDECAR_HANDOFF"?{ok:false,reason:"draft"}:{ok:true}),open=vi.fn();vi.stubGlobal("chrome",{runtime:{sendMessage:send}});
 const all=highlightMessages();stored.mockResolvedValue(all);
 const hits=[{id:"h",conversation:highlightSource,message:all[3],excerpt:all[3].content}];
 render(<SidecarSearchResults compact canInsert query="方案" hits={hits} conversationId={highlightSource.id} zh onOpen={open}/>);
 fireEvent.click(screen.getByRole("button",{name:`在侧栏阅读：${highlightSource.title}`}));
 const reading=await screen.findByRole("region",{name:`阅读：${highlightSource.title}`});await within(reading).findByText("问题 2：如何处理这项方案？");
 expect(within(reading).queryByRole("group",{name:"本对话的匹配"})).toBeNull();
 fireEvent.click(within(reading).getByRole("button",{name:"引用到输入框"}));
 // A draft is never replaced: the notice says so and stays until it is closed.
 const refused=await within(reading).findByRole("alert");expect(refused).toHaveTextContent("输入框里已有内容，没有覆盖。清空后再引用。");
 expect(within(refused).queryByRole("button",{name:"撤销"})).toBeNull();
 const handoff=send.mock.calls[0][0] as unknown as {type:string;conversationId:string;text:string};
 expect(handoff).toMatchObject({type:"ATLAS_SIDECAR_HANDOFF",conversationId:highlightSource.id});
 // The source, the question and answer under labels, and a line to write under, with no Markdown headings.
 expect(handoff.text).toMatch(/^以下是我之前的一段讨论，供参考：\n《技术讨论》 · ChatGPT\n\n【我问】\n问题 2：如何处理这项方案？\n\n【AI 答】\n完整回答 3/u);
 expect(handoff.text.endsWith("\n\n————————————\n")).toBe(true);expect(handoff.text).not.toContain("问题 4");expect(handoff.text).not.toMatch(/^#/mu);
 fireEvent.click(within(refused).getByRole("button",{name:"关闭提示"}));expect(within(reading).queryByRole("alert")).toBeNull();
 expect(within(reading).queryByRole("button",{name:"原对话定位"})).toBeNull();expect(send).toHaveBeenCalledTimes(1);
});

it("tells a quote briefly with an undo that clears only what it put in",async()=>{
 const send=vi.fn<(message:unknown)=>Promise<{ok:boolean}>>(async()=>({ok:true}));vi.stubGlobal("chrome",{runtime:{sendMessage:send}});
 const all=highlightMessages();stored.mockResolvedValue(all);
 render(<SidecarSearchResults compact canInsert query="方案" hits={[{id:"h",conversation:highlightSource,message:all[3],excerpt:all[3].content}]} conversationId={highlightSource.id} zh onOpen={vi.fn()}/>);
 fireEvent.click(screen.getByRole("button",{name:`在侧栏阅读：${highlightSource.title}`}));
 const reading=await screen.findByRole("region",{name:`阅读：${highlightSource.title}`});await within(reading).findByText("问题 2：如何处理这项方案？");
 fireEvent.click(within(reading).getByRole("button",{name:"引用到输入框"}));
 const done=await within(reading).findByRole("status");expect(done).toHaveTextContent("已引用到输入框，可在分割线下继续写。");
 const inserted=(send.mock.calls[0][0] as unknown as {text:string}).text;
 fireEvent.click(within(done).getByRole("button",{name:"撤销"}));
 await within(reading).findByText("已撤销引用。");
 expect(send).toHaveBeenLastCalledWith({type:"ATLAS_SIDECAR_HANDOFF",conversationId:highlightSource.id,text:inserted,undo:true});
});

it("opens a card's other matches a few characters before the searched words, so two narrow lines show them",()=>{
 const lead="丰富度：8/10 首次理解成本：5/10 每日使用闭环：5/10 留存潜力：6/10 视觉完成度：7/10 ";
 expect(nearMatch(`…${lead}首页还需要再收一收，把日历移下去。${"后文".repeat(60)}`,"首页")).toMatch(/^….{0,12}首页还需要/u);
 expect(nearMatch("首页这么改比较好","首页")).toBe("首页这么改比较好");
 expect(nearMatch("没有命中的句子","首页")).toBe("没有命中的句子");
 const message=highlightMessages()[0],hits=["开头",`…${lead}首页还需要再收一收`].map((excerpt,index)=>({id:String(index),conversation:highlightSource,message:{...message,id:String(index)},excerpt}));
 const {container}=render(<SidecarSearchResults compact query="首页" hits={hits} conversationId="" zh onOpen={vi.fn()}/>);
 fireEvent.click(screen.getByRole("button",{name:"另有 1 处"}));
 const row=container.querySelector(".memory-source-matches button > span");
 expect(row?.querySelector("mark")?.textContent).toBe("首页");expect(row?.textContent?.indexOf("首页")).toBeLessThanOrEqual(13);
});

it("opens Reader at the match at once when the platform reports the question too far back to load quickly",async()=>{
 const send=vi.fn(async()=>({ok:false,error:"x",reader:"far"})),open=vi.fn();vi.stubGlobal("chrome",{runtime:{sendMessage:send}});
 const hits=highlightMessages().slice(0,1).map(message=>({id:message.id,conversation:highlightSource,message,excerpt:message.content}));
 render(<SidecarSearchResults hits={hits} query="方案" conversationId={highlightSource.id} zh onOpen={open}/>);
 fireEvent.click(screen.getByRole("button",{name:"在原生 AI 中定位"}));
 await screen.findByText("这条讨论在对话较早的位置，原平台需要逐段加载，已在 Reader 中直接打开。");
 expect(open).toHaveBeenCalledWith(highlightSource,hits[0].message,undefined,expect.objectContaining({query:"方案"}));
});