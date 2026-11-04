import { expect, it } from "vitest";
import { wikiDocument, wikiOutline } from "./wiki-document";

it("nests the contents by actual heading levels without changing targets or prose", () => {
  const body = "## AI生成与执行逻辑\n\n#### 执行里程碑\n\n### 当前状态\n\n## Provider适配与密钥管理\n\n### 安全边界";
  const {headings} = wikiDocument(body), before = structuredClone(headings);
  const outline = wikiOutline(headings);
  expect(outline.map(item => item.title)).toEqual(["AI生成与执行逻辑", "Provider适配与密钥管理"]);
  expect(outline[0].children.map(item => [item.title, item.headingIndex])).toEqual([["执行里程碑", 1], ["当前状态", 2]]);
  expect(outline[1].children[0]).toMatchObject({title:"安全边界", headingIndex:4});
  expect(headings).toEqual(before);
  expect(wikiDocument(body).body).toBe(body);
});

it("keeps the introduction once and maps real headings while preserving code and full prose", () => {
  const body = "当前采用 **BYOK**，保留原有限制。\n\n## 接入方案\n\n用户配置自己的 API。\n\n```ts\n// ## This is code\n```\n\n### 安全边界\n\n密钥留在本地。\n\n## 选择原因\n\n降低维护成本。";
  const result = wikiDocument(body);
  expect(result.body).toBe(body);
  expect(result.body).toContain("// ## This is code");
  expect(result.headings.map(item => [item.title, item.headingIndex])).toEqual([["接入方案", 0], ["安全边界", 1], ["选择原因", 2]]);
});
it("hides only the legacy generated transcript appendix and its TOC entry",()=>{
 const body="正文结论。\n\n### 原文中的具体说明\n\nAI 讨论原句：\n\n> 建议使用索引。\n\n用户原句：\n\n> 先不改。\n\n## 其他约束\n\n仍保留原方案。";
 const result=wikiDocument(body,true);expect(result.body).not.toContain("AI 讨论原句");expect(result.body).toContain("仍保留原方案");expect(result.headings.map(heading=>heading.title)).toEqual(["其他约束"]);
 expect(wikiDocument(body).body).toBe(body);
});
it("never promotes a paragraph from historical sections into an invented current conclusion", () => {
  const body = "## 背景\n\n早期提出统一 API，但尚未确定。";
  expect(wikiDocument(body)).toMatchObject({ body });
  const long = "原文".repeat(600);
  expect(wikiDocument(long).body).toBe(long);
});

it("presents an existing chapter opening once without changing stored Markdown or heading targets",()=>{
 const body="本章解释本地索引的用途；新增消息后才更新索引。\n\n## 更新规则\n\n失败保留原文。\n\n```ts\nconst unchanged = true;\n```";
 const page=wikiDocument(body);
 expect(page.body).toBe(body);expect(page.overview).toMatchObject({kind:"opening",blocks:[{text:"本章解释本地索引的用途；新增消息后才更新索引。"}]});
 expect(page.overview?.readingBody).toBe(body.slice(body.indexOf("## 更新规则")));expect(page.headings.map(item=>item.title)).toEqual(["更新规则"]);
});

it("leaves legacy chapters without an overview instead of sampling child paragraphs",()=>{
 const body="## 已否决的早期方案\n\n### 密钥存储\n\n早期建议把全部密钥写入数据库，后续已明确否决。\n\n## 当前限制\n\nBYOK 只在用户主动配置时使用。";
 const page=wikiDocument(body);
 expect(page.overview).toBeUndefined();expect(page.body).toBe(body);
});

it("does not detach list lead-ins or invent summaries from code, quotations and evidence details",()=>{
 for(const body of ["已完成阶段：\n\n- 第一项。","## 代码\n\n```ts\nconst summary = 'not prose';\n```","## 原始引用\n\n> 不要把原文引述当成已采纳结论。","## 依据\n\n<details>\n<summary>原始证据</summary>\n\n内部引文不是章节概览。\n\n</details>"]){
  const page=wikiDocument(body);expect(page.overview).toBeUndefined();expect(page.body).toBe(body);
 }
 const long="条件完整保留。".repeat(90),page=wikiDocument(long);expect(page.overview).toBeUndefined();expect(page.body).toBe(long);
});
