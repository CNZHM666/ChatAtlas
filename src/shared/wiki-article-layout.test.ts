import {expect,it} from "vitest";
import {wikiArticleLayout,wikiInlineChecklist} from "./wiki-article-layout";
import {readingEmphasisMarkdown} from "./reading-emphasis";

it("splits only explicit sequential acceptance cases, preserving conditions, punctuation and identifiers",()=>{
 const raw='验证完整流程。定义 3 个验收场景：1.无 Key 时仍可使用；2.失败时不得保存（重试 2.1 次）；3.仅确认后提交 `Schema->Validator`。';
 const next=wikiArticleLayout(raw);
 expect(next).toBe('验证完整流程。定义 3 个验收场景：\n\n1. 无 Key 时仍可使用；\n2. 失败时不得保存（重试 2.1 次）；\n3. 仅确认后提交 `Schema->Validator`。');
 expect(wikiArticleLayout(next)).toBe(next);
 expect(wikiInlineChecklist('检查清单：1. 甲；3. 丙；4. 丁')).toBeUndefined();
 expect(wikiInlineChecklist('版本 1.2；数量 3.4；预算 5.6。')).toBeUndefined();
 expect(wikiInlineChecklist('检查清单：1.保留“a；2.b”；2.完成；3.继续。')).toContain('1. 保留“a；2.b”；');
 for(const quoted of ['“检查清单：1.甲；2.乙；3.丙”','`检查清单：1.甲；2.乙；3.丙`','[检查清单：1.甲；2.乙；3.丙](https://example.com)'])expect(wikiInlineChecklist(quoted)).toBeUndefined();
});

it("compacts explicit singleton mappings, leaving nested lists and original examples untouched",()=>{
 const pairs='**输入**\n\n- Button\n\n**输出**\n\n- LED\n\n**驱动**\n\n- Relay';
 const table=wikiArticleLayout(pairs);
 expect(table).toBe('| 分类 | 内容 |\n| --- | --- |\n| 输入 | Button |\n| 输出 | LED |\n| 驱动 | Relay |');
 expect(wikiArticleLayout(table)).toBe(table);
 const continued=pairs+'\n\n- **运行环境**：安装工具。\n- **测试要求**：先验证。';
 const projected=wikiArticleLayout(continued);
 expect(projected).toContain('| 驱动 | Relay |');
 expect(projected).toContain('- 运行环境：安装工具。');
 expect(projected).not.toContain('**驱动**');
 expect(wikiArticleLayout(projected)).toBe(projected);
 const original='```md\n'+pairs+'\n```\n\n> **引用**\n>\n> - 不变';
 expect(wikiArticleLayout(original)).toBe(original);
 const folded='<details data-atlas="atlas-wiki-supplement">\n<summary>原文</summary>\n\n'+pairs+'\n\n</details>';
 expect(wikiArticleLayout(folded)).toBe(folded);
});

it("uses consistent ordinary labels for mixed and long lists but retains compact fields and personal edits",()=>{
 const mixed='- **来源**：用户报告，未经代码核验。\n- 仅在确认后执行。';
 expect(wikiArticleLayout(mixed)).toBe('- 来源：用户报告，未经代码核验。\n- 仅在确认后执行。');
 const short='- **输入**：消息\n- **输出**：文档';expect(wikiArticleLayout(short)).toBe(short);
 expect(readingEmphasisMarkdown(mixed,{sectioned:true,userEdited:true})).toBe(mixed);
 expect(readingEmphasisMarkdown(mixed,{sectioned:true,origin:'user'})).toBe(mixed);
 expect(readingEmphasisMarkdown(mixed,{sectioned:true})).toBe(wikiArticleLayout(mixed));
});
