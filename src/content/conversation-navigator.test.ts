// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DOMChatGPTAdapter } from "./chatgpt-adapter";
import { ConversationNavigator } from "./conversation-navigator";

let navigator: ConversationNavigator;
const sendMessage = vi.fn(async () => ({ ok:false,unsupported:true }));
const root = () => document.querySelector("#atlas-conversation-navigator")!.shadowRoot!;
it("repairs a lost page entry on its periodic recovery check without duplicating it",()=>{
 vi.useFakeTimers();navigator.stop();navigator.start();document.querySelector(".atlas-navigator-trigger")!.remove();
 vi.advanceTimersByTime(2100);expect(document.querySelectorAll(".atlas-navigator-trigger")).toHaveLength(1);
 vi.advanceTimersByTime(2100);expect(document.querySelectorAll(".atlas-navigator-trigger")).toHaveLength(1);navigator.stop();vi.useRealTimers();
});
beforeEach(() => {
  vi.clearAllMocks(); document.documentElement.lang = "zh-CN";
  document.body.innerHTML = '<header><button id="share">分享</button></header><main><article data-testid="conversation-turn-0"><div data-message-author-role="user">问题</div></article></main>';
  window.history.replaceState({}, "", "/c/first");
  vi.stubGlobal("chrome", { runtime: { sendMessage, getURL:(path:string) => `https://extension.example/${path}` }, storage:{local:{get:vi.fn(async()=>({})),set:vi.fn(async()=>undefined)}} });
  navigator = new ConversationNavigator(new DOMChatGPTAdapter()); navigator.start();
});
afterEach(() => { navigator.stop(); vi.useRealTimers(); document.getElementById("atlas-navigator-trigger-style")?.remove(); document.getElementById("atlas-workbench-trigger-style")?.remove(); document.documentElement.removeAttribute("data-theme"); document.documentElement.classList.remove("dark"); vi.unstubAllGlobals(); });
it("keeps one labelled ChatAtlas button directly left of Share even when a model control is present",()=>{
 navigator.stop();document.body.innerHTML='<div id="stage-slideover-sidebar"><header><button>ChatGPT</button></header></div><header><div id="models"><button data-testid="model-switcher-dropdown-button">ChatGPT</button></div><div id="actions"><button id="share">分享</button><button>更多</button></div></header><main></main>';
 navigator.start();const share=document.querySelector("#share")!,entry=document.querySelector(".atlas-navigator-trigger")!;
 expect(share.previousElementSibling).toBe(entry);expect(entry).toHaveClass("atlas-navigator-trigger--toolbar");expect(entry).toHaveTextContent("ChatAtlas");
 navigator.ensureTrigger();expect(document.querySelectorAll(".atlas-navigator-trigger")).toHaveLength(1);
 share.replaceWith(share.cloneNode(true));navigator.ensureTrigger();expect(document.querySelector("#share")!.previousElementSibling).toBe(entry);
});
it("finds the top Share action outside semantic headers and ignores message sharing",()=>{
 navigator.stop();document.body.innerHTML='<main><div id="top"><button aria-label="Share" id="top-share">分享</button></div><article><button aria-label="Share">分享</button></article></main>';navigator.start();
 const entry=document.querySelector(".atlas-navigator-trigger")!;
 expect(document.querySelector("#top-share")!.previousElementSibling).toBe(entry);expect(entry.closest("article")).toBeNull();
});
it("adds a labelled shortcut below New chat in layouts without a recognized header",()=>{
 navigator.stop();document.body.innerHTML='<div id="stage-sidebar"><div id="new"><a href="/">新聊天</a></div><a href="/tasks">定时任务</a></div><main><article><button>分享</button></article></main>';navigator.start();
 const entry=document.querySelector<HTMLButtonElement>(".atlas-navigator-trigger")!;expect(document.querySelector("#new")!.nextElementSibling).toBe(entry);expect(entry).toHaveClass("atlas-navigator-trigger--navigation");expect(entry.textContent).toBe("ChatAtlas");expect(entry.querySelector(".atlas-trigger-mark img")).toHaveAttribute("alt", "");
 navigator.ensureTrigger();expect(document.querySelectorAll(".atlas-navigator-trigger")).toHaveLength(1);
});
it("keeps one working edge shortcut when navigation is hidden, and restores it after a layout change",async()=>{
 navigator.stop();document.body.innerHTML='<div id="stage-sidebar" style="display:none"><a href="/">New chat</a></div><div style="display:none"><header><button data-testid="model-switcher-dropdown-button">ChatGPT</button></header></div><main></main>';navigator.start();
 const entry=document.querySelector<HTMLButtonElement>(".atlas-navigator-trigger")!;expect(entry).toHaveClass("atlas-navigator-trigger--edge");
 entry.click();await vi.waitFor(()=>expect(sendMessage).toHaveBeenCalledWith({type:"ATLAS_OPEN_SIDEPANEL"}));
 (document.querySelector("#stage-sidebar") as HTMLElement).style.display="block";window.dispatchEvent(new Event("resize"));
 await vi.waitFor(()=>expect(entry).toHaveClass("atlas-navigator-trigger--navigation"));expect(document.querySelectorAll(".atlas-navigator-trigger")).toHaveLength(1);
});
it("uses the browser native panel without mounting an overlay when it is supported",async()=>{
 sendMessage.mockResolvedValueOnce({ok:true,unsupported:false});await navigator.open();
 expect(sendMessage).toHaveBeenCalledWith({type:"ATLAS_OPEN_SIDEPANEL"});expect(document.querySelector("#atlas-conversation-navigator")?.shadowRoot?.querySelector("iframe")??null).toBeNull();
});
it("keeps an entry on project and custom-GPT pages, including before the main element appears", async () => {
  navigator.stop(); window.history.replaceState({}, "", "/g/g-project/c/project-thread"); document.body.innerHTML="";
  navigator.start();
  const entry=document.querySelector<HTMLButtonElement>(".atlas-navigator-trigger")!;
  expect(entry).toHaveClass("atlas-navigator-trigger--edge");expect(entry.textContent).toContain("ChatAtlas");
  sendMessage.mockResolvedValueOnce({ok:true,unsupported:false});entry.click();
  await vi.waitFor(()=>expect(sendMessage).toHaveBeenCalledWith({type:"ATLAS_OPEN_SIDEPANEL"}));
  navigator.stop();window.history.replaceState({},"","/g/g-project/project");navigator.start();
  expect(document.querySelector(".atlas-navigator-trigger")).toBeVisible();
});
it("restores the entry automatically when the host removes it or hides its toolbar", async () => {
  document.querySelector(".atlas-navigator-trigger")!.remove();
  await vi.waitFor(()=>expect(document.querySelectorAll(".atlas-navigator-trigger")).toHaveLength(1));
  document.querySelector("header")!.style.display="none";
  await vi.waitFor(()=>expect(document.querySelector(".atlas-navigator-trigger")).toHaveClass("atlas-navigator-trigger--edge"));
});
it("restores entry styling when page hydration replaces the head without removing the button",async()=>{
 const entry=document.querySelector(".atlas-navigator-trigger");
 document.getElementById("atlas-navigator-trigger-style")!.remove();
 await vi.waitFor(()=>expect(document.getElementById("atlas-navigator-trigger-style")).not.toBeNull());
 expect(document.querySelector(".atlas-navigator-trigger")).toBe(entry);
 expect(document.querySelectorAll(".atlas-navigator-trigger")).toHaveLength(1);
});
it("restarts after a cached page restore and keeps later entry repairs active",async()=>{
 window.dispatchEvent(new PageTransitionEvent("pagehide",{persisted:true}));
 expect(document.querySelector(".atlas-navigator-trigger")).toBeNull();
 window.dispatchEvent(new PageTransitionEvent("pageshow",{persisted:true}));
 expect(document.querySelectorAll(".atlas-navigator-trigger")).toHaveLength(1);
 document.querySelector(".atlas-navigator-trigger")!.remove();
 await vi.waitFor(()=>expect(document.querySelectorAll(".atlas-navigator-trigger")).toHaveLength(1));
});
it("repairs a cached-module reinjection without registering duplicate entry observers",async()=>{
 const observe=vi.spyOn(MutationObserver.prototype,"observe");
 navigator.start();navigator.start();
 expect(observe).not.toHaveBeenCalled();
 document.querySelector(".atlas-navigator-trigger")!.remove();navigator.start();
 expect(document.querySelectorAll(".atlas-navigator-trigger")).toHaveLength(1);
 expect(observe).not.toHaveBeenCalled();observe.mockRestore();
});
it("keeps a clipped toolbar entry at the edge without moving it repeatedly", () => {
  const header=document.querySelector("header")!;header.style.overflow="hidden";
  vi.spyOn(header,"getBoundingClientRect").mockReturnValue({left:0,right:60,top:0,bottom:50,width:60,height:50} as DOMRect);
  const entry=document.querySelector<HTMLButtonElement>(".atlas-navigator-trigger")!;
  vi.spyOn(entry,"getBoundingClientRect").mockImplementation(()=>entry.classList.contains("atlas-navigator-trigger--edge")?{left:900,right:980,top:76,bottom:112,width:80,height:36} as DOMRect:{left:80,right:114,top:0,bottom:34,width:34,height:34} as DOMRect);
  navigator.ensureTrigger();expect(entry).toHaveClass("atlas-navigator-trigger--edge");
  const parent=entry.parentElement;navigator.ensureTrigger();expect(entry.parentElement).toBe(parent);expect(document.querySelectorAll(".atlas-navigator-trigger")).toHaveLength(1);
});
it("opens a single isolated project frame without reading project text into the host or requesting AI", async () => {
  await navigator.open();
  const frame = root().querySelector<HTMLIFrameElement>(".project-frame")!;
  expect(frame.src).toContain("sidecar.html?conversation=first");
  expect(frame.title).toBe("ChatAtlas 知识助手");
  expect(root().querySelector(".tabs,.route,.query-toggle,.summary")).toBeNull();
  navigator.ensureTrigger(); await navigator.open();
  expect(root().querySelectorAll("iframe")).toHaveLength(1); expect(sendMessage).toHaveBeenCalledWith({type:"ATLAS_OPEN_SIDEPANEL"});
  window.dispatchEvent(new Event("focus")); navigator.syncPage(); expect(root().querySelector("iframe")).toBe(frame);
  window.history.replaceState({}, "", "/c/other"); navigator.syncPage(); expect(frame.isConnected).toBe(false); expect(root().querySelector<HTMLIFrameElement>("iframe")!.src).toContain("conversation=other");
});
it("provides the same project entry on the welcome page and keeps it beside the toolbar after remounting", async () => {
  navigator.stop(); window.history.replaceState({}, "", "/");
  document.body.innerHTML = '<aside><button>搜索</button></aside><main><div id="page-header"><button aria-label="临时聊天">◌</button></div><form><button id="send">发送</button></form></main>';
  const anchor = document.querySelector<HTMLButtonElement>("#page-header button")!;
  vi.spyOn(anchor,"getBoundingClientRect").mockReturnValue({x:980,y:20,left:980,right:1016,top:20,bottom:56,width:36,height:36,toJSON:()=>({})});
  navigator.start(); const entry = anchor.previousElementSibling as HTMLButtonElement;
  expect(entry).toHaveAttribute("aria-label","ChatAtlas 知识助手");
  anchor.parentElement!.replaceChildren(anchor); navigator.ensureTrigger(); expect(anchor.previousElementSibling).toHaveClass("atlas-navigator-trigger");
  await navigator.open(); expect(root().querySelector<HTMLIFrameElement>("iframe")!.src).toContain("conversation=&"); expect(sendMessage).toHaveBeenCalledWith({type:"ATLAS_OPEN_SIDEPANEL"});
  root().querySelector<HTMLButtonElement>(".brand")!.click(); expect(sendMessage).toHaveBeenLastCalledWith({type:"ATLAS_OPEN"});
});
it("uses an independent shortcut without inserting into unrelated sidebar controls or the composer", () => {
  navigator.stop(); window.history.replaceState({}, "", "/");
  document.body.innerHTML='<aside><header><button>搜索</button></header></aside><main><form><button>发送</button></form></main>';
  navigator.start(); expect(document.querySelector(".atlas-navigator-trigger")).toHaveClass("atlas-navigator-trigger--edge");expect(document.querySelector("aside .atlas-navigator-trigger,form .atlas-navigator-trigger")).toBeNull();
  window.history.replaceState({},"","/settings"); navigator.syncPage(); navigator.ensureTrigger(); expect(document.querySelector(".atlas-navigator-trigger")).toBeNull();
});
it("preserves theme, keyboard and persisted resizing, and accepts close only from its own frame", async () => {
  await navigator.open(); const host=document.querySelector<HTMLElement>("#atlas-conversation-navigator")!;
  document.documentElement.classList.add("dark"); navigator.syncPage(); expect(host).toHaveClass("dark");
  document.documentElement.setAttribute("data-theme","light"); navigator.syncPage(); expect(host).not.toHaveClass("dark");
  const resize=root().querySelector<HTMLElement>(".resize")!; resize.dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowLeft",bubbles:true}));
  expect(host.style.width).toBe("380px"); expect(chrome.storage.local.set).toHaveBeenCalledWith({"atlas-navigator-width":380});
  window.dispatchEvent(new MessageEvent("message",{source:window,data:{type:"ATLAS_SIDECAR_CLOSE"}})); expect(host.isConnected).toBe(true);
  resize.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true})); expect(host.isConnected).toBe(true); expect(host.style.width).toBe("44px"); expect(root().querySelector("iframe")).toHaveAttribute("hidden"); expect(root().querySelector(".collapse")).toHaveAttribute("aria-label", "展开侧边栏");
});

 it("collapses and restores the same frame so a context preview survives", async () => {
  await navigator.open();
  const host = document.querySelector<HTMLElement>("#atlas-conversation-navigator")!;
  const frame = root().querySelector<HTMLIFrameElement>("iframe")!;
  const toggle = root().querySelector<HTMLButtonElement>(".collapse")!;
  toggle.click(); expect(host.style.width).toBe("44px"); expect(frame.hidden).toBe(true); expect(frame.inert).toBe(true);
  expect(toggle).toHaveAttribute("aria-label", "展开侧边栏");
  expect(root().querySelector("iframe")).toBe(frame);
  toggle.click(); expect(host.style.width).toBe("360px"); expect(frame.hidden).toBe(false); expect(frame.inert).toBe(false);
  expect(toggle).toHaveAttribute("aria-label", "收起侧边栏");
  expect(root().querySelector("iframe")).toBe(frame); expect(sendMessage).toHaveBeenCalledWith({type:"ATLAS_OPEN_SIDEPANEL"});
 });

it("restores the page entry immediately on return and replaces a stale entry from an old content context",()=>{
 vi.useFakeTimers();navigator.stop();
 document.body.insertAdjacentHTML("beforeend",'<button class="atlas-navigator-trigger">Old ChatAtlas</button><style id="atlas-navigator-trigger-style">.atlas-trigger-label{display:none}</style>');
 navigator.start();expect(document.querySelectorAll(".atlas-navigator-trigger")).toHaveLength(1);
 expect(document.getElementById("atlas-navigator-trigger-style")).toHaveTextContent(".atlas-trigger-label{display:inline;");
 document.querySelector(".atlas-navigator-trigger")!.remove();
 window.dispatchEvent(new Event("focus"));vi.advanceTimersByTime(20);
 expect(document.querySelectorAll(".atlas-navigator-trigger")).toHaveLength(1);
 expect(document.querySelector(".atlas-trigger-label")).toHaveTextContent("ChatAtlas");
 navigator.stop();vi.useRealTimers();
});

it("opens the workbench directly from a distinct top-right start-page entry",async()=>{
 navigator.stop();sendMessage.mockClear();window.history.replaceState({},"","/?temporary-chat=true");document.body.innerHTML='<aside><a href="/">新聊天</a></aside><main><div><button aria-label="临时聊天">◌</button></div><textarea id="prompt-textarea">保留我的输入</textarea></main>';
 navigator.start();const button=document.querySelector<HTMLButtonElement>(".atlas-workbench-trigger")!;
 expect(button).toHaveAccessibleName("ChatAtlas 工作台");expect(button.parentElement).toBe(document.body);expect(getComputedStyle(button).position).toBe("fixed");expect(getComputedStyle(button).right).toBe("64px");
 expect(sendMessage).not.toHaveBeenCalled();button.click();await Promise.resolve();expect(sendMessage).toHaveBeenCalledExactlyOnceWith({type:"ATLAS_OPEN"});expect((document.querySelector("#prompt-textarea") as HTMLTextAreaElement).value).toBe("保留我的输入");expect(document.querySelector("#atlas-conversation-navigator")).toBeNull();
});
it("repairs a removed home workbench entry and removes it after leaving the start page",async()=>{
 navigator.stop();window.history.replaceState({},"","/");document.body.innerHTML='<main></main>';navigator.start();navigator.start();
 expect(document.querySelectorAll(".atlas-workbench-trigger")).toHaveLength(1);document.querySelector(".atlas-workbench-trigger")!.remove();
 await vi.waitFor(()=>expect(document.querySelectorAll(".atlas-workbench-trigger")).toHaveLength(1));
 window.history.replaceState({},"","/c/first");navigator.syncPage();navigator.ensureTrigger();expect(document.querySelector(".atlas-workbench-trigger")).toBeNull();expect(document.querySelectorAll(".atlas-navigator-trigger")).toHaveLength(1);
 window.history.replaceState({},"","/");navigator.syncPage();navigator.ensureTrigger();expect(document.querySelectorAll(".atlas-workbench-trigger")).toHaveLength(1);
 document.getElementById("atlas-workbench-trigger-style")!.remove();navigator.ensureTrigger();expect(document.getElementById("atlas-workbench-trigger-style")).not.toBeNull();
 navigator.stop();expect(document.querySelector(".atlas-workbench-trigger")).toBeNull();
});
it("adapts the home workbench label and appearance without opening anything",()=>{
 navigator.stop();sendMessage.mockClear();window.history.replaceState({},"","/");document.body.innerHTML='<main></main>';document.documentElement.lang='en';document.documentElement.dataset.theme='dark';navigator.start();
 expect(document.querySelector(".atlas-workbench-trigger")).toHaveAccessibleName('ChatAtlas Workbench');expect((document.querySelector(".atlas-workbench-trigger") as HTMLElement).style.colorScheme).toBe('dark');expect(sendMessage).not.toHaveBeenCalled();
 document.documentElement.dataset.theme='light';navigator.syncPage();expect((document.querySelector(".atlas-workbench-trigger") as HTMLElement).style.colorScheme).toBe('light');
});
