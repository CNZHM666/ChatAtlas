import {expect,it} from "vitest";
import {wikiReadingLayout} from "./wiki-reading-layout";
import {wikiDocument} from "../canvas/wiki-document";

it("quietly labels short generated leaves without moving their conditions or changing saved Markdown",()=>{
 const body="本章介绍两种授权模式。\n\n## 授权\n\n### 平台模式\n\n仅平台管理员配置服务密钥。\n\n### 用户模式\n\n只有用户配置 BYOK 后才调用自己的服务商。";
 const shown=wikiReadingLayout(body);
 expect(shown).toBe(body.replace("### 平台模式","**平台模式**").replace("### 用户模式","**用户模式**"));
 expect(wikiReadingLayout(shown)).toBe(shown);
 expect(wikiDocument(body,true).headings.map(item=>item.title)).toEqual(["授权"]);
 expect(wikiDocument(body,false).body).toBe(body);
 expect(wikiReadingLayout(body,["### 用户模式"])).toContain("### 用户模式");
});

it("retains substantive branches, top-level scopes, source quotes, code, tables and ordered lists",()=>{
 const examples=[
  "### 无父级的小节\n\n短说明。",
  "## 规则\n\n### 长说明\n\n"+"失败时必须保留已有原文，不覆盖用户草稿。".repeat(30),
  "## 规则\n\n### 模式\n\n#### 平台服务\n\n独立授权。",
  "## 规则\n\n### 依赖\n\n**平台模式**\n\n独立授权。",
  "## 规则\n\n### 验收\n\n1. 先核对来源\n2. 后确认保存",
  "## 规则\n\n### 参数\n\n| 版本 | 数量 |\n|---|---|\n| V1 | 6 |",
  "## 规则\n\n### 代码\n\n```js\nconst list = [];\n```",
  "## 规则\n\n### 引用\n\n> 原文不得改写。",
 ];
 for(const body of examples)expect(wikiReadingLayout(body)).toBe(body);
});
