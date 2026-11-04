import {expect,it} from "vitest";
import {evidenceTextRange} from "./evidence-highlight";

it("locates GFM table rows and entities without including Markdown table punctuation",()=>{
 const root=document.createElement("div");root.innerHTML='<table><tbody><tr><td>GPIO</td><td>21 &amp; 22</td></tr></tbody></table>';
 expect(evidenceTextRange(root,"| GPIO | 21 &amp; 22 |\n|---|---|")?.toString()).toBe("GPIO21 & 22");
});

it("preserves literal double underscores in inline code and ignores hidden repeated text",()=>{
 const root=document.createElement("div");root.innerHTML='<div hidden>使用 user__id 保存。</div><p>使用 <code>user__id</code> 保存。</p>';
 const range=evidenceTextRange(root,"使用 `user__id` 保存。");
 expect(range?.toString()).toBe("使用 user__id 保存。");expect(range?.startContainer.parentElement?.closest("[hidden]")).toBeNull();
});

it("locates a sentence boundary inside an emphasis span without marking the surrounding sentences",()=>{
 const root=document.createElement("div");root.innerHTML='<p><strong>第一句介绍。Hardware IR 定义模块连接。第三句补充。</strong></p>';
 expect(evidenceTextRange(root,"**第一句介绍。")?.toString()).toBe("第一句介绍。");
 expect(evidenceTextRange(root,"第三句补充。**")?.toString()).toBe("第三句补充。");
});
it("locates literal quotes across Markdown emphasis, links and separate paragraphs",()=>{
 const root=document.createElement("div");root.innerHTML='<p>前文无关。</p><p>使用 <strong>Hardware IR</strong> 统一数据。</p><p>再交给<a href="#">执行器</a>校验。</p>';
 expect(evidenceTextRange(root,'使用 **Hardware IR** 统一数据。\n\n再交给[执行器](#)校验。')?.toString()).toBe("使用 Hardware IR 统一数据。再交给执行器校验。");
 expect(evidenceTextRange(root,"不存在的发布结论")).toBeUndefined();
});
it("keeps original DOM offsets across normalized fullwidth characters and emoji",()=>{
 const root=document.createElement("div");root.innerHTML='<p>前文🙂 ＡＩ <b>修改</b>方案。</p><button>忽略按钮</button>';
 expect(evidenceTextRange(root,"AI 修改方案。")?.toString()).toBe("ＡＩ 修改方案。");
 expect(evidenceTextRange(root,"忽略按钮")).toBeUndefined();
});
