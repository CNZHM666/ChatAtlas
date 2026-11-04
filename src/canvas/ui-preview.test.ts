import { expect, it } from "vitest";
import { uiPreviewDocument } from "./ui-preview";

it("preserves step layout, inline styles and SVG geometry while removing executable and remote content", () => {
  const source = '<html><head><style>.steps{display:grid;gap:24px}</style></head><body><section class="steps"><h2>选择项目</h2><svg viewBox="0 0 20 20"><path d="M1 1L10 10"/></svg><p>组织上下文</p><script>alert(1)</script><iframe src="https://evil.test"></iframe><img src="https://evil.test/pixel" onerror="run()"><a href="javascript:run()">原文</a><input value="draft" oninput="send()"><button onclick="run()">发送</button></section></body></html>';
  const preview = uiPreviewDocument(source, "html")!;
  const document = new DOMParser().parseFromString(preview, "text/html");
  expect(document.querySelector("section")?.className).toBe("steps");
  expect(document.querySelector("style:last-of-type")?.textContent ?? document.body.textContent).toBeTruthy();
  expect(preview).toContain("display:grid;gap:24px");
  expect(document.querySelector("svg path")?.getAttribute("d")).toBe("M1 1L10 10");
  expect(document.querySelector("script,iframe,img,[onclick],[oninput],[href]")).toBeNull();
  expect(document.querySelector("input")?.hasAttribute("disabled")).toBe(true);
  expect(document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute("content")).toContain("connect-src 'none'");
});
it("does not interpret typescript as HTML or accept an unbounded imported UI", () => {
  expect(uiPreviewDocument('interface Message { html: "<p>example</p>" }', "typescript")).toBeUndefined();
  expect(uiPreviewDocument("<script>run()</script>", "html")).toBeUndefined();
  expect(uiPreviewDocument("<div>" + "x".repeat(100001) + "</div>", "html")).toBeUndefined();
  expect(uiPreviewDocument("<div>" + "<span>x</span>".repeat(2501) + "</div>", "html")).toBeUndefined();
});
it("preserves local SVG references but removes external ones and refresh navigation", () => {
  const preview = uiPreviewDocument('<svg viewBox="0 0 20 20"><defs><path id="shape" d="M1 1L2 2"/></defs><use href="#shape"/><use href="https://evil.test/shape"/><foreignObject><script>run()</script></foreignObject></svg><meta http-equiv="refresh" content="0;url=https://evil.test">', "svg")!;
  const document = new DOMParser().parseFromString(preview, "text/html");
  expect(document.querySelector("use")?.getAttribute("href")).toBe("#shape");
  expect(document.querySelectorAll("use[href]")).toHaveLength(1);
  expect(document.querySelector("foreignObject,script,meta[http-equiv=refresh]")).toBeNull();
});
