import { afterEach, expect, it, vi } from "vitest";
import { findQuestionBlock, sameQuestionText } from "./question-text";
import { extensionAlive } from "./extension-alive";
afterEach(() => { document.body.innerHTML = ""; vi.unstubAllGlobals(); });

it("finds a question in markup without articles, roles or message IDs, never an answer quoting it or ChatAtlas's own panel", () => {
  document.body.innerHTML = '<div id="atlas-conversation-navigator"><span>这个导出与复用怎么实现呢？通过什么架构实现</span></div>'
    + '<div class="thread"><div class="turn"><div class="bubble"><span>这个导出与复用怎么实现呢？</span><span>通过什么架构实现</span></div></div>'
    + '<div class="turn"><p>你问：这个导出与复用怎么实现呢？通过什么架构实现。答案分三层：存储、索引和导出，每层各自独立，便于复用和替换。</p></div></div>'
    + '<form><div contenteditable="true">这个导出与复用怎么实现呢？通过什么架构实现</div></form>';
  expect(findQuestionBlock("这个导出与复用怎么实现呢？\n通过什么架构实现")).toBe(document.querySelector(".bubble"));
  expect(findQuestionBlock("完全不在页面上的另一个问题内容")).toBeNull();
});

it("searches open shadow roots", () => {
  const host = document.createElement("div"); document.body.append(host);
  host.attachShadow({ mode: "open" }).innerHTML = '<section><p>如何在侧栏里定位原始对话的位置</p></section>';
  expect(findQuestionBlock("如何在侧栏里定位原始对话的位置")?.tagName).toBe("P");
});

it("compares question text without Markdown and whitespace, with a small margin for labels", () => {
  expect(sameQuestionText("这个导出与复用怎么实现呢？ 通过什么架构实现 已编辑", "这个导出与复用怎么实现呢？\n通过什么架构实现")).toBe(true);
  expect(sameQuestionText("完全不同", "这个导出与复用怎么实现呢？")).toBe(false);
});

it("reports a reloaded extension so the old page script can stop", () => {
  vi.stubGlobal("chrome", { runtime: { getURL: () => { throw Error("Extension context invalidated."); } } });
  expect(extensionAlive()).toBe(false);
  vi.stubGlobal("chrome", { runtime: { getURL: (path: string) => `chrome-extension://id/${path}` } });
  expect(extensionAlive()).toBe(true);
});

it("reads closed shadow roots through the extension API and same-origin frames", () => {
  const host = document.createElement("div"); document.body.append(host);
  const closed = host.attachShadow({ mode: "closed" }); closed.innerHTML = '<p>封闭区域里显示的这一句提问内容</p>';
  vi.stubGlobal("chrome", { dom: { openOrClosedShadowRoot: (element: HTMLElement) => element === host ? closed : null } });
  expect(findQuestionBlock("封闭区域里显示的这一句提问内容")?.textContent).toBe("封闭区域里显示的这一句提问内容");
  const frame = document.createElement("iframe"); document.body.append(frame);
  frame.contentDocument!.body.innerHTML = '<div><span>框架里面显示的另一句提问内容</span></div>';
  expect(findQuestionBlock("框架里面显示的另一句提问内容")?.tagName).toBe("SPAN");
});
