import {expect,it} from "vitest";
import {sourceQuoteProjection} from "./source-quote-text";
import {wikiQuoteRange} from "./wiki-claims";

it.each([
 ["> **卡片中ＡＩ** &amp; 文字🙂", "AI&文字🙂", "ＡＩ** &amp; 文字🙂"],
 ["> 第一行正文\n> **第二行正文**", "第一行正文第二行正文", "第一行正文\n> **第二行正文"],
 ["`api_key__literal`", "api_key__literal", "api_key__literal"],
 ["```json\n{\"user__id\": \"value\"}\n```", '{"user__id":"value"}', '{"user__id": "value"}'],
 ["> ```text\n> 1. 优先保证旅程自然\n> 2. 保持 Workspace 稳定\n> ```", "1.优先保证旅程自然2.保持Workspace稳定", "1. 优先保证旅程自然\n> 2. 保持 Workspace 稳定"],
 ["~~~text\n🙂__literal__\n```\n~~~", "🙂__literal__```", "🙂__literal__\n```"],
 ["转义 \\*literal\\* 内容", "*literal*", "\\*literal\\*"],
])("keeps original character positions in rendered Markdown: %s",(content,needle,raw)=>{
 const projection=sourceQuoteProjection(content)!;
 expect(projection).toBeDefined();
 const start=projection.text.indexOf(needle);expect(start).toBeGreaterThanOrEqual(0);
 expect(content.slice(projection.starts[start],projection.ends[start+needle.length-1])).toBe(raw);
});

it("grounds a quote extracted from a multiline card and decodes entities without losing offsets",()=>{
 const content="> **第一行内容**\n> 第二行 &amp; 原文。";
 const range=wikiQuoteRange(content,"第一行内容 第二行 & 原文。");
 expect(range&&content.slice(range.start,range.end)).toBe("第一行内容**\n> 第二行 &amp; 原文。");
 expect(wikiQuoteRange(content,"不存在的第三行内容")).toBeUndefined();
});
