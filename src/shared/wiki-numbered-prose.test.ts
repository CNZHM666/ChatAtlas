import {expect,it} from "vitest";
import {wikiReadingFormat} from "./wiki-reading-format";
import {wikiNumberedProse} from "./wiki-numbered-prose";
it("restores broken numbered acceptance cases while preserving decimals and literal payloads",()=>{
 const broken="Definition of Done 定义 3 个验收场景：1.\n\n无 Key 时可用；2.耗时小于 1.5 秒；3.失败保持原状。";
 const fixed="Definition of Done 定义 3 个验收场景：\n\n1. 无 Key 时可用\n2. 耗时小于 1.5 秒\n3. 失败保持原状。";
 expect(wikiNumberedProse(broken)).toBe(fixed);expect(wikiNumberedProse(fixed)).toBe(fixed);
 expect(wikiNumberedProse("定义 3 个场景：1.正常；3.失败")).toBe("定义 3 个场景：1.正常；3.失败");
 const code="```text\n"+broken+"\n```";expect(wikiNumberedProse(code)).toBe(code);
 const original='<details data-atlas="atlas-wiki-supplement">\n<summary>原文与示例</summary>\n\n'+broken+'\n\n</details>';
 expect(wikiNumberedProse(original)).toBe(original);
 expect(wikiReadingFormat(broken,{userEdited:true})).toBe(broken);
 expect(wikiReadingFormat(broken,{})).toContain("2. 耗时小于 1.5 秒");
});

it("starts an explicitly labeled overall outcome after the checklist",()=>{
 const input="定义 2 个验收场景：1.无 Key 时可打开；2.无效修改不提交。最终完成标准为在画布里看见验证结果。";
 expect(wikiNumberedProse(input)).toBe("定义 2 个验收场景：\n\n1. 无 Key 时可打开\n2. 无效修改不提交。\n\n最终完成标准为在画布里看见验证结果。");
 const saved="定义 2 个验收场景：\n\n1. 无 Key 时可打开\n2. 无效修改不提交。完成标准为在画布里看见验证结果。";
 expect(wikiNumberedProse(saved)).toContain("2. 无效修改不提交。\n\n完成标准为在画布里看见验证结果。");
});
