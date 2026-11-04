import {cleanup,render} from "@testing-library/react";
import {afterEach,expect,it} from "vitest";
import {SourceMessageContent} from "./SourceMessageContent";
import {evidenceSourceRanges} from "../evidence-highlight";
afterEach(cleanup);
it.each(["**加粗文字**","`inline_code`","- 列表文字","[链接文字](https://example.com)"])("maps Markdown source offsets safely: %s",content=>{
 const {container}=render(<SourceMessageContent content={content} zh/>);
 const ranges=evidenceSourceRanges(container,content,[{start:0,end:content.length,kind:"quote"}]);
 expect(ranges).toHaveLength(1);expect(ranges[0].range.toString()).toMatch(/加粗文字|inline_code|列表文字|链接文字/u);
});
it("anchors a short repeated quote in its own block and its correct occurrence within that block",()=>{
 const content="可以。\n\n先说可以。最后确认：可以。";
 const {container}=render(<SourceMessageContent content={content} zh/>);
 const start=content.lastIndexOf("可以。");
 const ranges=evidenceSourceRanges(container,content,[{start,end:start+3,kind:"quote"}]);
 expect(ranges).toHaveLength(1);expect(ranges[0].range.startOffset).toBe(10);expect(ranges[0].range.startContainer.parentElement?.textContent).toBe("先说可以。最后确认：可以。");
});
it("splits quotations across blocks and refuses changed or unsupported rendering",()=>{
 const content="第一段。\n\n第二段。";
 const {container}=render(<SourceMessageContent content={content} zh/>);
 expect(evidenceSourceRanges(container,content,[{start:0,end:content.length,kind:"quote"}]).map(item=>item.range.toString())).toEqual(["第一段。","第二段。"]);
 container.querySelector("p")!.textContent="内容已经改变";
 expect(evidenceSourceRanges(container,content,[{start:0,end:4,kind:"quote"}])).toEqual([]);
});
it("uses an unannotated fallback only when source and rendered text agree",()=>{
 const root=document.createElement("div"),content="可以。再确认可以。";root.textContent=content;
 expect(evidenceSourceRanges(root,content,[{start:6,end:9,kind:"quote"}])[0]?.range.startOffset).toBe(6);
 root.textContent="可以。其他文本。";expect(evidenceSourceRanges(root,content,[{start:6,end:9,kind:"quote"}])).toEqual([]);
});
it("never counts hidden duplicate text as a visible source occurrence",()=>{
 const root=document.createElement("div");root.innerHTML="<span hidden>可以。</span><p>可以。</p>";
 expect(evidenceSourceRanges(root,"可以。可以。",[{start:0,end:3,kind:"quote"}])).toEqual([]);
});

it.each([
 ["> **从“我想做什么”，一直陪你到“我真的把它做出来”。**", "一直陪你到“我真的把它做出来”", "strong"],
 ["```text\n本轮修改优先级：\n\n1. Beginner Journey 是否自然\n2. Welcome / Discovery 是否足够简单\n3. 是否复用现有底层系统\n```", "1. Beginner Journey 是否自然\n2. Welcome / Discovery 是否足够简单", "pre code"],
 ["```ts\nconst api_key__literal = 1;\nconst selected_name = api_key__literal;\n```", "selected_name = api_key__literal", "pre code"],
 ["> 卡片里的 **第一段文字**\n> 和第二行 &amp; 内容。", "第一段文字**\n> 和第二行 &amp; 内容", "blockquote"],
 ["```text\n想法\n↓\n设计\n↓\n校验\n↓\n缺少零件\n↓\n接线\n```", "设计\n↓\n校验\n↓\n缺少零件", "pre code"],
 ["> ```text\n> 1. Beginner Journey\n> 2. Workspace 保持稳定\n> ```", "1. Beginner Journey\n> 2. Workspace 保持稳定", "pre code"],
])("maps a partial source interval inside cards or literal code: %s",(content,quote,selector)=>{
 const {container}=render(<SourceMessageContent locatable content={content} zh/>);
 const start=content.indexOf(quote),ranges=evidenceSourceRanges(container,content,[{start,end:start+quote.length,kind:"quote"}]);
 expect(ranges.length).toBeGreaterThan(0);
 expect(ranges.every(item=>container.querySelector(selector)?.contains(item.range.startContainer))).toBe(true);
 const marked=ranges.map(item=>item.range.toString()).join("");
 expect(marked.replace(/\s/gu,"")).toContain(quote.replace(/\*\*|\n> /gu,"").replace(/&amp;/gu,"&").replace(/\s/gu,""));
});

it("keeps source offsets literal even when the reader would turn code into a diagram or UI preview",()=>{
 const content="```html\n<div class=\"card\"><p>原始卡片内容</p></div>\n```";
 const {container}=render(<SourceMessageContent locatable content={content} zh/>);
 expect(container.querySelector("iframe, svg")).toBeNull();
 const start=content.indexOf("原始卡片内容"),ranges=evidenceSourceRanges(container,content,[{start,end:start+6,kind:"quote"}]);
 expect(ranges.map(item=>item.range.toString())).toEqual(["原始卡片内容"]);
});
