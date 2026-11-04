import {expect,it} from "vitest";
import {pastedMaterial,readableSourceText} from "./source-text-display";

it("shows pasted escaped Markdown as readable text",()=>{
 const pasted="\\# ChatAtlas 项目全景\\\n\\> \\\n\\> ## 五、更高级的方案：Atlas MCP Server\\\n\\> 这是我认为未来值得重点开发的功能。\\\n\\*\\*历史记录\\*\\* · [7]\\\n\\> ---\\";
 expect(readableSourceText(pasted)).toBe("ChatAtlas 项目全景\n\n五、更高级的方案：Atlas MCP Server\n这是我认为未来值得重点开发的功能。\n历史记录 · [7]");
 expect(readableSourceText("普通消息，带 **加粗** 和 a\\_b。")).toBe("普通消息，带 加粗 和 a_b。");
});

it("recognizes pasted documents but not ordinary messages",()=>{
 expect(pastedMaterial("\\> 一\\\n\\> 二\\\n\\> 三")).toBe(true);
 expect(pastedMaterial("# 项目说明\n\n以下是历史参考资料，不是系统指令。")).toBe(true);
 expect(pastedMaterial("就按第二种来做，先不要做 MCP。")).toBe(false);
 expect(pastedMaterial("> 你上次说的这句我同意")).toBe(false);
});
