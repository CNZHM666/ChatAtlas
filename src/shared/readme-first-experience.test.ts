import {expect,it} from "vitest";
import zh from "../../README.md?raw";
import en from "../../README.en.md?raw";
import principles from "../../PRODUCT_PRINCIPLES.md?raw";

it("makes no-key basic search and pending demo visible before the product introduction in both languages",()=>{
 expect(zh.indexOf("基础搜索不需要 AI Key")).toBeLessThan(zh.indexOf("ChatAtlas 是"));
 expect(en.indexOf("Basic search needs no AI key")).toBeLessThan(en.indexOf("ChatAtlas is"));
 expect(zh).toContain("演示 GIF 占位：待录制");expect(en).toContain("Demo GIF placeholder: recording pending");
 for(const text of [zh,en])expect(text).toContain("<!-- demo-gif-placeholder:");
});
it("keeps the same four-column unmeasured timing table in Chinese and English",()=>{
 const tables=[zh,en].map(text=>text.split(/## 生成耗时|## Generation time/u)[1].split(/\n## /u)[0]);
 expect(tables[0]).toContain("待基准实测");expect(tables[1]).toContain("Pending benchmark measurements");
 expect(tables[0]).toContain("| 对话规模 | 首章可读 | 全部完成 | 模型 |");expect(tables[1]).toContain("| Conversation size | First readable chapter | Fully complete | Model |");
 for(const table of tables){const rows=table.split("\n").filter(line=>/^\| (?:单个|多个|Single|Multiple)/u.test(line));expect(rows).toHaveLength(2);for(const row of rows)expect(row.split("|").slice(2,5).map(cell=>cell.trim())).toEqual(["","",""]);}
});
it("retains the product principles' import and native-integration boundaries in both editions",()=>{
 const scope=principles.split("\n")[6];
 for(const platform of ["ChatGPT","Claude","Gemini","Google Takeout JSON","DeepSeek"]){expect(scope).toContain(platform);expect(zh).toContain(platform);expect(en).toContain(platform);}
 expect(zh).toContain("浏览器授予网站权限后默认自动运行");expect(en).toContain("run automatically after browser website permission");
 for(const text of [zh,en])for(const platform of ["Kimi","Qwen"])expect(text).toContain(platform);
 expect(zh).toContain("仅保存当前已加载的消息，不保证完整历史");expect(en).toContain("saves currently loaded messages, not guaranteed full history");
});
