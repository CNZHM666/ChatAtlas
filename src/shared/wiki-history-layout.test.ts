import {expect,it} from "vitest";
import {wikiBlockPresentation} from "./wiki-block-presentation";
import {wikiHistoryLayout} from "./wiki-history-layout";
import {wikiReadingFormat} from "./wiki-reading-format";
const mark=String.fromCharCode(96).repeat(3),code=mark+"text\nOld layout\n"+mark;
it("renders historical records consistently and omits historical raw examples without changing saved text",()=>{
 const input="## 早先版本\n\n此前建议先输出清单。〔此前〕\n\n*流程*\n\n"+code+"\n\n- 此前建议提供两个动作。〔此前〕\n\n## 当前设计\n\n- 保留的功能\n\n"+code;
 const output=wikiReadingFormat(input,{});
 expect(output).toContain("此前建议先输出清单。〔此前〕");expect(output).toContain("此前建议提供两个动作。〔此前〕");
 expect(output.split("## 当前设计")[0]).not.toContain("<details");expect(output.split("## 当前设计")[0]).not.toContain("Old layout");
 expect(output).not.toContain("- 此前建议");expect(output).toContain("- 保留的功能");expect(output).toContain("Old layout");
 expect(input).toContain("- 此前建议");expect(wikiReadingFormat(input,{userEdited:true})).toContain(code);
});
it("also hides an existing generated disclosure in historical content and preserves structured lists",()=>{
 const source="## Earlier versions\n\nEarlier record.\n\n<details data-atlas=\"atlas-wiki-supplement\">\n<summary>原文与示例</summary>\n\n"+code+"\n\n</details>\n\n- Previous choice.\n\n## Next\n\n- Parent\n  - Child";
 const result=wikiHistoryLayout(source);
 expect(result).not.toContain("<details");expect(result).toContain("Previous choice.");expect(result).not.toContain("- Previous choice");expect(result).toContain("- Parent\n  - Child");
 expect(wikiBlockPresentation("*流程 · 早期方案，已被替换*\n\n"+code).decisions[0].mode).toBe("source_only");
});
