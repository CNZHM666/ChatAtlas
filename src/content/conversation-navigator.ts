import { extensionAlive } from "./extension-alive";
import type { AtlasMessage } from "../shared/messages";
import type { ChatGPTAdapter } from "./chatgpt-adapter";
import { chatGPTEntryAnchor, chatGPTEntryVisible } from "./chatgpt-adapter";
import { sidecarStyle } from "./sidecar-style";
import { brandLogos } from "../shared/brand-assets";
import { ATLAS_TRIGGER_STYLE } from "./atlas-trigger-style";

const WIDTH_KEY = "atlas-navigator-width";
function darkBackground(element: Element): boolean {
  const match = getComputedStyle(element).backgroundColor.match(/rgba?\((\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,/\s]+([\d.]+))?\)/u);
  if (!match || Number(match[4] ?? 1) === 0) return false;
  const [r, g, b] = match.slice(1, 4).map(Number); return r * .2126 + g * .7152 + b * .0722 < 128;
}

/** Host shell only. Project text and notes stay in the extension-origin frame. */
export class ConversationNavigator {
  private trigger: HTMLButtonElement | null = null;
  private workbenchTrigger: HTMLButtonElement | null = null;
  private host: HTMLDivElement | null = null;
  private frame: HTMLIFrameElement | null = null;
  private conversationId: string | null = null;
  private width = 360;
  private collapsed = false;
  private entryFrame: number | undefined;
  private entryObserver: MutationObserver | undefined;
  private active = false;
  private dark = false;
  private entryTimer: number | undefined;
  private clippedAnchors = new WeakSet<HTMLElement>();
  constructor(private readonly adapter: ChatGPTAdapter) {}
  private get zh() { return document.documentElement.lang.toLowerCase().startsWith("zh"); }
  start(): void {
    if(!this.active){document.querySelectorAll(".atlas-navigator-trigger,.atlas-workbench-trigger").forEach(button=>button.remove());document.querySelectorAll("#atlas-navigator-trigger-style,#atlas-workbench-trigger-style").forEach(style=>style.remove());}
    this.syncPage(); this.ensureTrigger();
    if(this.active)return;
    this.active=true;
    // Repair an entry removed during delayed hydration or a replaced host root.
    this.entryTimer=window.setInterval(()=>{if(!document.hidden){this.syncPage();this.ensureTrigger();}},2000);
    window.addEventListener("pagehide", this.onPageHide); window.addEventListener("message", this.onMessage);
    this.entryObserver = new MutationObserver(records => { if(records.some(record => record.type === "childList" || !(record.target instanceof Element) || !record.target.closest(".atlas-navigator-trigger,.atlas-workbench-trigger,#atlas-conversation-navigator"))) this.scheduleEntry(); });
    this.entryObserver.observe(document.documentElement, {childList:true,subtree:true,attributes:true,attributeFilter:["class","style","hidden","aria-hidden","data-theme"]});
    window.addEventListener("focus",this.scheduleEntry);document.addEventListener("visibilitychange",this.scheduleEntry);window.addEventListener("resize",this.scheduleEntry);document.addEventListener("scroll",this.scheduleEntry,{capture:true,passive:true});document.addEventListener("click",this.scheduleEntry);document.addEventListener("transitionend",this.scheduleEntry);
    window.addEventListener("popstate",this.scheduleEntry);window.addEventListener("hashchange",this.scheduleEntry);document.addEventListener("load",this.scheduleEntry,true);
    void chrome.storage.local.get(WIDTH_KEY).then(stored => { if (typeof stored[WIDTH_KEY] === "number") this.setWidth(stored[WIDTH_KEY]); }).catch(() => undefined);
  }
  stop = (): void => { this.active=false;window.clearInterval(this.entryTimer);this.entryTimer=undefined;this.entryObserver?.disconnect(); this.entryObserver=undefined; this.close(); this.trigger?.remove(); this.trigger = null; this.workbenchTrigger?.remove(); this.workbenchTrigger = null; window.removeEventListener("pagehide", this.onPageHide);window.removeEventListener("pageshow",this.onPageShow); window.removeEventListener("message", this.onMessage);window.removeEventListener("focus",this.scheduleEntry);document.removeEventListener("visibilitychange",this.scheduleEntry);window.removeEventListener("resize",this.scheduleEntry);window.removeEventListener("popstate",this.scheduleEntry);window.removeEventListener("hashchange",this.scheduleEntry);document.removeEventListener("load",this.scheduleEntry,true);document.removeEventListener("scroll",this.scheduleEntry,true);document.removeEventListener("click",this.scheduleEntry);document.removeEventListener("transitionend",this.scheduleEntry);if(this.entryFrame!==undefined)cancelAnimationFrame(this.entryFrame);this.entryFrame=undefined; };
  private onPageHide=(event:PageTransitionEvent):void=>{this.stop();if(event.persisted)window.addEventListener("pageshow",this.onPageShow,{once:true});};
  private onPageShow=():void=>{this.start();};
  private scheduleEntry=(event?:Event):void=>{if(event&&event.type!=="scroll")this.clippedAnchors=new WeakSet();if(this.entryFrame!==undefined)return;this.entryFrame=requestAnimationFrame(()=>{this.entryFrame=undefined;this.syncPage();this.ensureTrigger();});};
  private onMessage = (event: MessageEvent): void => { if (!this.frame || event.source !== this.frame.contentWindow) return; if (event.data?.type === "ATLAS_SIDECAR_COLLAPSE") this.setCollapsed(true); else if (event.data?.type === "ATLAS_SIDECAR_CLOSE") { this.close(); this.trigger?.focus(); } };
  syncPage(): void {
    if (!extensionAlive()) { this.stop(); return; }
    const next = this.adapter.detectConversation()?.id ?? null;
    if (next !== this.conversationId) { this.conversationId = next; if (this.host) { if (next || location.pathname === "/") this.mountFrame(); else this.close(); } }
    this.syncTheme();
  }
  ensureTrigger(): void {
    this.ensureWorkbenchTrigger();
    let target = chatGPTEntryAnchor(Boolean(this.conversationId));
    if(target&&this.clippedAnchors.has(target.anchor))target={anchor:document.body,placement:"prepend",variant:"edge"};
    const anchor=target?.anchor;
    if (!target || !anchor?.parentElement) { this.trigger?.remove(); this.trigger = null; return; }
    const button = this.trigger?.isConnected ? this.trigger : this.button("", "atlas-navigator-trigger", () => { if (this.host) this.setCollapsed(!this.collapsed); else void this.open(); });
    const className=`atlas-navigator-trigger${target.variant ? ` atlas-navigator-trigger--${target.variant}` : ""}`;
    if(button.className!==className)button.className=className;
    button.setAttribute("aria-label", this.zh ? "ChatAtlas 知识助手" : "ChatAtlas knowledge companion"); button.title = `${button.getAttribute("aria-label")} · Ctrl+Shift+Y`; button.setAttribute("aria-expanded", String(Boolean(this.host) && !this.collapsed));
    if (!document.getElementById("atlas-navigator-trigger-style")) {
      const style = document.createElement("style"); style.id = "atlas-navigator-trigger-style";
      style.textContent = ATLAS_TRIGGER_STYLE;
      (document.head??document.documentElement).append(style);
    }
    const placed=this.trigger === button && (target.placement === "after" ? anchor.nextElementSibling === button : target.placement === "before" ? anchor.previousElementSibling === button : anchor.firstElementChild === button);
    if(placed&&(target.variant==="edge"||chatGPTEntryVisible(button)))return;
    if (!button.firstChild) { const mark = document.createElement("span"); mark.className = "atlas-trigger-mark"; mark.append(this.logoImage()); mark.setAttribute("aria-hidden", "true"); const label=document.createElement("span");label.className="atlas-trigger-label";label.textContent="ChatAtlas";button.append(mark,label); }
    if(!placed){if(target.placement === "after")anchor.after(button);else if(target.placement === "before")anchor.before(button);else anchor.prepend(button);}this.trigger = button;
    if(target.variant!=="edge"&&!chatGPTEntryVisible(button)){
      this.clippedAnchors.add(anchor);button.className="atlas-navigator-trigger atlas-navigator-trigger--edge";document.body.prepend(button);
    }
  }
  /** A separate direct workspace action on the start page, independent of host headers. */
  private ensureWorkbenchTrigger(): void {
    if (location.pathname !== "/" || !document.body) { this.workbenchTrigger?.remove(); this.workbenchTrigger = null; return; }
    if (!document.getElementById("atlas-workbench-trigger-style")) {
      const style = document.createElement("style"); style.id = "atlas-workbench-trigger-style";
      style.textContent = `.atlas-workbench-trigger{position:fixed;top:12px;right:64px;z-index:60;display:inline-flex;align-items:center;justify-content:center;gap:7px;height:34px;box-sizing:border-box;margin:0;padding:0 12px;border:1px solid color-mix(in srgb,CanvasText 15%,transparent);border-radius:9px;background:Canvas;color:CanvasText;font:500 13px system-ui,sans-serif;line-height:1;white-space:nowrap;cursor:pointer;box-shadow:0 1px 3px #00000008}.atlas-workbench-trigger:hover{border-color:#16a34a80;background:color-mix(in srgb,Canvas 94%,#16a34a)}.atlas-workbench-trigger:focus-visible{outline:2px solid #22c55e;outline-offset:3px}.atlas-workbench-trigger svg{flex:none;color:light-dark(#15803d,#4ade80)}@media(max-width:640px){.atlas-workbench-trigger{top:64px;right:12px}body:has(>.atlas-workbench-trigger)>.atlas-navigator-trigger--edge{top:110px}}`;
      (document.head ?? document.documentElement).append(style);
    }
    const button = this.workbenchTrigger?.isConnected ? this.workbenchTrigger : this.button("", "atlas-workbench-trigger", () => {
      void chrome.runtime.sendMessage({ type: "ATLAS_OPEN" } satisfies AtlasMessage).catch(() => undefined);
    });
    const label = this.zh ? "ChatAtlas 工作台" : "ChatAtlas Workbench";
    button.setAttribute("aria-label", label); button.title = this.zh ? "打开 ChatAtlas 工作台" : "Open ChatAtlas workbench";
    if (!button.firstChild) {
      button.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M9 3v18M12 8h6M12 12h6M12 16h4"/></svg><span></span>';
    }
    const text = button.querySelector("span")!; if (text.textContent !== label) text.textContent = label;
    this.workbenchTrigger = button;
    if (!button.isConnected) { document.body.append(button); this.syncTheme(); }
  }
  async open(): Promise<void> {
    const native=await chrome.runtime.sendMessage({type:"ATLAS_OPEN_SIDEPANEL"} satisfies AtlasMessage).catch(()=>undefined);
    if(native?.ok){this.close();return;}
    if(native&&!native.unsupported){void chrome.runtime.sendMessage({type:"ATLAS_OPEN"} satisfies AtlasMessage).catch(()=>undefined);return;}
    this.syncPage(); if (this.host || !this.conversationId && location.pathname !== "/") return;
    const host = document.createElement("div"); host.id = "atlas-conversation-navigator"; host.style.width = `${this.width}px`; host.style.fontFamily = getComputedStyle(document.body).fontFamily;
    const root = host.attachShadow({ mode: "open" }), style = document.createElement("style"); style.textContent = sidecarStyle; root.append(style);
    const panel = document.createElement("aside"); panel.className = "panel"; panel.setAttribute("aria-label", this.zh ? "ChatAtlas 知识助手" : "ChatAtlas knowledge companion"); panel.append(this.resizeHandle());
    const header = document.createElement("header"); header.className = "head-top";
    const brand = this.button("ChatAtlas", "brand", () => void chrome.runtime.sendMessage({ type: "ATLAS_OPEN" } satisfies AtlasMessage).catch(() => undefined)); brand.title = this.zh ? "打开工作台" : "Open workbench";
    brand.prepend(this.logoImage());
    const close = this.button("", "collapse", () => this.setCollapsed(!this.collapsed)); close.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16M7 10l2 2-2 2"/></svg>'; close.setAttribute("aria-label", this.zh ? "收起侧边栏" : "Collapse sidebar"); close.setAttribute("aria-expanded", "true"); header.append(brand, close); panel.append(header); root.append(panel);
    root.addEventListener("keydown", event => { if ((event as KeyboardEvent).key === "Escape") { event.preventDefault(); this.setCollapsed(true); } });
    document.documentElement.append(host); this.host = host; this.collapsed = false; this.syncTheme(); this.mountFrame(); this.trigger?.setAttribute("aria-expanded", "true"); close.focus();
  }
  close(): void { this.frame?.remove(); this.frame = null; this.host?.remove(); this.host = null; this.trigger?.setAttribute("aria-expanded", "false"); }
  private setCollapsed(value: boolean): void {
    if (!this.host) return;
    this.collapsed = value; this.host.classList.toggle("is-collapsed", value); this.host.style.width = value ? "44px" : `${this.width}px`;
    if (this.frame) { this.frame.hidden = value; this.frame.inert = value; }
    const button = this.host.shadowRoot?.querySelector<HTMLButtonElement>(".collapse");
    button?.setAttribute("aria-label", this.zh ? value ? "展开侧边栏" : "收起侧边栏" : value ? "Expand sidebar" : "Collapse sidebar"); button?.setAttribute("aria-expanded", String(!value)); button?.focus();
    this.trigger?.setAttribute("aria-expanded", String(!value));
  }
  private mountFrame(): void {
    this.frame?.remove(); this.frame = null;
    const panel = this.host?.shadowRoot?.querySelector(".panel"); if (!panel) return;
    const frame = document.createElement("iframe"); frame.className = "project-frame"; frame.title = this.zh ? "ChatAtlas 知识助手" : "ChatAtlas knowledge companion"; frame.hidden = this.collapsed; frame.inert = this.collapsed;
    const params = new URLSearchParams({ conversation: this.conversationId ?? "", title: this.adapter.detectConversation()?.title ?? "", lang: this.zh ? "zh" : "en", theme: this.host?.classList.contains("dark") ? "dark" : "light" });
    frame.src = `${chrome.runtime.getURL("sidecar.html")}?${params}`; frame.addEventListener("load", () => this.syncTheme()); this.frame = frame; panel.append(frame);
  }
  private syncTheme(): void {
    const declared = document.documentElement.getAttribute("data-theme") ?? document.body?.getAttribute("data-theme");
    const dark = declared === "dark" || declared !== "light" && (document.documentElement.classList.contains("dark") || document.body?.classList.contains("dark") || darkBackground(document.body) || darkBackground(document.documentElement));
    this.dark = dark;
    const logo = chrome.runtime.getURL(brandLogos[dark ? "dark" : "light"].replace(/^\//u, ""));
    for (const image of [this.trigger?.querySelector<HTMLImageElement>("img"), this.host?.shadowRoot?.querySelector<HTMLImageElement>(".brand img")]) if (image && image.getAttribute("src") !== logo) image.src = logo;
    if (this.workbenchTrigger) this.workbenchTrigger.style.colorScheme = dark ? "dark" : "light";
    this.host?.classList.toggle("dark", dark); this.frame?.contentWindow?.postMessage({ type: "ATLAS_SIDECAR_APPEARANCE", theme: dark ? "dark" : "light" }, "*");
  }
  private setWidth(value: number): void { this.width = Math.min(480, Math.max(280, Math.round(value))); if (this.host && !this.collapsed) this.host.style.width = `${this.width}px`; }
  private logoImage(): HTMLImageElement { const image = document.createElement("img"); image.src = chrome.runtime.getURL(brandLogos[this.dark ? "dark" : "light"].replace(/^\//u, "")); image.alt = ""; image.width = 32; image.height = 32; image.draggable = false; return image; }
  private button(label: string, className: string, action: () => void): HTMLButtonElement { const button = document.createElement("button"); button.type = "button"; button.className = className; button.textContent = label; button.addEventListener("click", action); return button; }
  private resizeHandle(): HTMLElement {
    const resize = document.createElement("div"); resize.className = "resize"; resize.setAttribute("role", "separator"); resize.setAttribute("aria-label", this.zh ? "调整侧边栏宽度" : "Resize sidebar"); resize.setAttribute("aria-orientation", "vertical"); resize.tabIndex = 0;
    const save = () => void chrome.storage.local.set({ [WIDTH_KEY]: this.width }).catch(() => undefined);
    resize.addEventListener("keydown", event => { if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); this.setWidth(this.width + (event.key === "ArrowLeft" ? 20 : -20)); save(); } });
    resize.addEventListener("pointerdown", event => {
      event.preventDefault(); resize.setPointerCapture(event.pointerId); const startX = event.clientX, startWidth = this.width;
      const move = (next: PointerEvent) => this.setWidth(startWidth + startX - next.clientX);
      const end = () => { resize.removeEventListener("pointermove", move); resize.removeEventListener("pointerup", end); resize.removeEventListener("pointercancel", end); save(); };
      resize.addEventListener("pointermove", move); resize.addEventListener("pointerup", end); resize.addEventListener("pointercancel", end);
    }); return resize;
  }
}
