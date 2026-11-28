import {afterEach,expect,it,vi} from "vitest";
import {webChatEntry} from "./web-chat-entry";
afterEach(()=>{document.body.innerHTML="";vi.unstubAllGlobals();});
it("keeps one automatic entry across repeated updates and opens the native panel",async()=>{
 const sendMessage=vi.fn().mockResolvedValue({ok:true});vi.stubGlobal("chrome",{runtime:{sendMessage,getURL:(path:string)=>`chrome-extension://atlas/${path}`}});
 const first=webChatEntry();first.ensure();first.ensure();webChatEntry().ensure();expect(document.querySelectorAll('#atlas-web-chat-entry')).toHaveLength(1);
 document.getElementById('atlas-web-chat-entry')!.click();await Promise.resolve();expect(sendMessage).toHaveBeenCalledExactlyOnceWith({type:"ATLAS_OPEN_SIDEPANEL"});first.remove();expect(document.getElementById('atlas-web-chat-entry')).toBeNull();
});
it("opens the workspace when the browser cannot open its native panel",async()=>{
 const sendMessage=vi.fn().mockResolvedValueOnce({ok:false,unsupported:true}).mockResolvedValueOnce({ok:true});vi.stubGlobal("chrome",{runtime:{sendMessage,getURL:(path:string)=>`chrome-extension://atlas/${path}`}});webChatEntry().ensure();document.getElementById('atlas-web-chat-entry')!.click();await vi.waitFor(()=>expect(sendMessage).toHaveBeenLastCalledWith({type:"ATLAS_OPEN"}));
});

it("aligns with Share when the toolbar appears and restores an interactive entry after a route replaces the DOM",async()=>{
 const sendMessage=vi.fn().mockResolvedValue({ok:true});
 vi.stubGlobal("chrome",{runtime:{sendMessage,getURL:(path:string)=>`chrome-extension://atlas/${path}`}});
 const entry=webChatEntry();entry.ensure();
 const first=document.getElementById("atlas-web-chat-entry")!;
 expect(first).toHaveClass("atlas-navigator-trigger--edge");
 const header=document.createElement("header");header.style.display="flex";
 const share=document.createElement("button");share.setAttribute("aria-label","分享对话");
 vi.spyOn(share,"getBoundingClientRect").mockReturnValue(new DOMRect(window.innerWidth-58,12,32,32));
 header.append(share);document.body.append(header);
 entry.ensure();
 expect(share.previousElementSibling).toBe(first);
 expect(first).toHaveClass("atlas-navigator-trigger--toolbar");
 const cloned=first.cloneNode(true);
 first.replaceWith(cloned);
 entry.ensure();
 const replaced=share.previousElementSibling as HTMLElement;
 expect(replaced).not.toBe(cloned);
 replaced.click();
 expect(sendMessage).toHaveBeenCalledExactlyOnceWith({type:"ATLAS_OPEN_SIDEPANEL"});
 header.remove();
 entry.ensure();
 expect(document.getElementById("atlas-web-chat-entry")).toHaveClass("atlas-navigator-trigger--edge");
});
it("shows the brand logo and name, as the ChatGPT button does at the page edge",()=>{
 vi.stubGlobal("chrome",{runtime:{sendMessage:vi.fn(),getURL:(path:string)=>`chrome-extension://atlas/${path}`}});webChatEntry().ensure();
 const button=document.getElementById('atlas-web-chat-entry')!;
 expect(button.className).toBe("atlas-navigator-trigger atlas-navigator-trigger--edge");
 expect(button.querySelector(".atlas-trigger-mark img")?.getAttribute("src")).toMatch(/^(?:chrome-extension:\/\/atlas\/|data:image\/)/u);
 expect(button.querySelector(".atlas-trigger-label")?.textContent).toBe("ChatAtlas");
 expect(document.getElementById("atlas-navigator-trigger-style")).not.toBeNull();
});
it("aligns with a DeepSeek-style wrapped or standalone top-right icon button",()=>{
 vi.stubGlobal("chrome",{runtime:{sendMessage:vi.fn(),getURL:(path:string)=>`chrome-extension://atlas/${path}`}});
 // Standalone non-flex .ds-icon-button: falls back to fixed positioning aligned to its vertical center and left edge.
 const box=document.createElement("div");box.style.display="block";
 const ds=document.createElement("div");ds.className="ds-icon-button";ds.setAttribute("role","button");
 vi.spyOn(ds,"getBoundingClientRect").mockReturnValue(new DOMRect(window.innerWidth-48,16,32,32));
 box.append(ds);document.body.append(box);
 const entry=webChatEntry();entry.ensure();
 const button=document.getElementById("atlas-web-chat-entry")!;
 expect(button).toHaveClass("atlas-navigator-trigger--edge","is-anchor-aligned");
 expect(button.style.top).toBe("16px");
 expect(button.style.right).toBe("56px");
 // When wrapped in a single-child tooltip wrapper inside a horizontal flex toolbar, inserts beside the wrapper.
 document.body.innerHTML="";
 const toolbar=document.createElement("header");toolbar.style.display="flex";
 const tip=document.createElement("div");tip.style.display="block";
 const share=document.createElement("button");share.setAttribute("aria-label","分享");
 vi.spyOn(share,"getBoundingClientRect").mockReturnValue(new DOMRect(window.innerWidth-54,14,30,30));
 tip.append(share);toolbar.append(tip);document.body.append(toolbar);
 entry.ensure();
 expect(tip.previousElementSibling).toBe(document.getElementById("atlas-web-chat-entry"));
 expect(document.getElementById("atlas-web-chat-entry")).toHaveClass("atlas-navigator-trigger--toolbar");
});
it("adapts platform attributes and aligns beside platform-specific top-right controls (e.g. Gemini Google bar)", () => {
 vi.stubGlobal("chrome", { runtime: { sendMessage: vi.fn(), getURL: (path: string) => `chrome-extension://atlas/${path}` } });
 const bar = document.createElement("div"); bar.style.display = "flex";
 const account = document.createElement("a"); account.setAttribute("aria-label", "Google Account");
 vi.spyOn(account, "getBoundingClientRect").mockReturnValue(new DOMRect(window.innerWidth - 48, 12, 34, 34));
 bar.append(account); document.body.append(bar);
 const entry = webChatEntry("gemini");
 entry.ensure();
 const button = document.getElementById("atlas-web-chat-entry")!;
 expect(button.dataset.atlasPlatform).toBe("gemini");
 expect(account.previousElementSibling).toBe(button);
 expect(button).toHaveClass("atlas-navigator-trigger--toolbar");
 expect(button.style.getPropertyValue("--atlas-trigger-radius")).toBe("999px");
});

it("ignores centered welcome-page switcher tabs across other AI hosts and keeps the trigger in the top-right cluster", () => {
  vi.stubGlobal("chrome", { runtime: { sendMessage: vi.fn(), getURL: (path: string) => `chrome-extension://atlas/${path}` } });
  const main = document.createElement("main");
  vi.spyOn(main, "getBoundingClientRect").mockReturnValue(new DOMRect(260, 0, 764, 800));
  const header = document.createElement("header"); header.style.display = "flex";
  const centerGroup = document.createElement("div"); centerGroup.setAttribute("role", "tablist");
  const modeTab = document.createElement("button"); modeTab.setAttribute("role", "tab"); modeTab.textContent = "深度思考";
  vi.spyOn(modeTab, "getBoundingClientRect").mockReturnValue(new DOMRect(630, 14, 72, 32));
  centerGroup.append(modeTab);
  const rightGroup = document.createElement("div"); rightGroup.style.display = "flex";
  const topRightBtn = document.createElement("button"); topRightBtn.setAttribute("aria-label", "新对话");
  vi.spyOn(topRightBtn, "getBoundingClientRect").mockReturnValue(new DOMRect(960, 14, 32, 32));
  rightGroup.append(topRightBtn);
  header.append(centerGroup, rightGroup);
  main.append(header);
  document.body.append(main);

  const entry = webChatEntry("qwen");
  entry.ensure();
  const button = document.getElementById("atlas-web-chat-entry")!;
  expect(button.closest('[role="tablist"]')).toBeNull();
  expect(topRightBtn.previousElementSibling).toBe(button);
  expect(button).toHaveClass("atlas-navigator-trigger--toolbar");

  // If no top-right action exists on a welcome screen (only a centered button), fall back to the top-right edge.
  rightGroup.remove();
  modeTab.removeAttribute("role");
  centerGroup.removeAttribute("role");
  entry.ensure();
  const edgeButton = document.getElementById("atlas-web-chat-entry")!;
  expect(edgeButton).toHaveClass("atlas-navigator-trigger--edge");
  expect(edgeButton.parentElement).toBe(document.body);
});
