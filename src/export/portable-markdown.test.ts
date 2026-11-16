import {expect,it} from "vitest";
import {portableMarkdown} from "./portable-markdown";

it("replaces owned disclosures and anchors while preserving literal examples and content",()=>{
 const code='```html\n<details data-atlas="atlas-wiki-supplement">\n<summary>原文</summary>\n</details>\n<a id="chapter-1"></a>\n```';
 const body=`# 文档\n\n[章节](#atlas-wiki-1)\n\n<a id="atlas-wiki-1"></a>\n\n## 模型设置\n\n<details data-atlas="atlas-wiki-supplement">\n<summary>原文与示例</summary>\n\n${code}\n\n</details>`;
 const result=portableMarkdown(body);
 expect(result).toContain('[章节](#模型设置)');
 expect(result).toContain('### 原文与示例');
 expect(result).toContain(code);
 expect(result.replace(code,"")).not.toMatch(/<\/?(?:details|summary|a)\b/u);
 expect(portableMarkdown(result)).toBe(result);
});

it("resolves duplicate headings and retains locator labels without dangling HTML targets",()=>{
 const body='## 配置\n\n[第二处](#chapter-2) [S-12-abc](#S-12-abc)\n\n<a id="chapter-2"></a>\n\n## 配置\n\n<a id="S-12-abc"></a>\n\n- **S-12-abc** · 用户';
 expect(portableMarkdown(body)).toContain('[第二处](#配置-1) [S-12-abc]');
 expect(portableMarkdown(body)).toContain('- **S-12-abc** · 用户');
});

it("preserves personal HTML, inline examples and indented code",()=>{
 const body='## 原文\n\n`<a id="chapter-1"></a>`\n\n    <details data-atlas="atlas-wiki-supplement">\n    <summary>literal</summary>\n\n<details>\n<summary>个人折叠</summary>\n\n正文\n\n</details>';
 expect(portableMarkdown(body)).toBe(body);
});

it("removes standalone anchors parsed as lazy continuation of locator lists",()=>{
 const body='[S-2-def](#S-2-def)\n\n- **S-1-abc** · 用户\n<a id="S-2-def"></a>\n\n- **S-2-def** · AI';
 const result=portableMarkdown(body);
 expect(result).not.toContain('<a');expect(result).not.toContain('(#S-2-def)');
 expect(result).toContain('- **S-2-def** · AI');
});
it("nests example titles under their group and omits a duplicate wrapper over a real section",()=>{
 const body='## 总览\n\n<details data-atlas="atlas-wiki-supplement">\n<summary>讨论中的计划</summary>\n\n### 后续计划\n\n计划说明。\n\n</details>\n\n### 配置\n\n<details data-atlas="atlas-wiki-supplement">\n<summary>原文与示例 · 1 项</summary>\n\n#### 1. 命令示例\n\n```sh\nnpm ci\n```\n\n</details>';
 const result=portableMarkdown(body);
 expect(result).not.toContain('#### 讨论中的计划');expect(result).toContain('### 后续计划');
 expect(result).toContain('#### 原文与示例 · 1 项\n\n##### 1. 命令示例');expect(result).toContain('```sh\nnpm ci\n```');
});
