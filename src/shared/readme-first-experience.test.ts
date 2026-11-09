import {expect,it} from "vitest";
import zh from "../../README.md?raw";
import en from "../../README.en.md?raw";
import principles from "../../PRODUCT_PRINCIPLES.md?raw";

it("makes no-key basic search visible before the product introduction, and shows the product before what it does, in both languages",()=>{
 expect(zh.indexOf("基础搜索不需要 AI Key")).toBeLessThan(zh.indexOf("ChatAtlas 是"));
 expect(en.indexOf("Basic search needs no AI key")).toBeLessThan(en.indexOf("ChatAtlas is"));
 expect(zh.indexOf("docs/images/sidecar-chatgpt-light.png")).toBeLessThan(zh.indexOf("## 能做什么"));
 expect(en.indexOf("docs/images/sidecar-chatgpt-light.png")).toBeLessThan(en.indexOf("## What it does"));
});
it("publishes no empty timing table and walks through installing the release ZIP in both languages",()=>{
 expect(zh).not.toContain("## 生成耗时");expect(en).not.toContain("## Generation time");
 for(const text of [zh,en]){expect(text).toContain("releases/latest");expect(text).toContain("ChatAtlas-extension-v");expect(text).toContain("chrome://extensions");expect(text).toContain("manifest.json");}
 expect(zh).toContain("加载已解压的扩展程序");expect(en).toContain("Load unpacked");
});
it("retains the product principles' import and native-integration boundaries in both editions",()=>{
 const scope=principles.split("\n")[6];
 for(const platform of ["ChatGPT","Claude","Gemini","Google Takeout JSON","DeepSeek"]){expect(scope).toContain(platform);expect(zh).toContain(platform);expect(en).toContain(platform);}
 expect(zh).toContain("浏览器授予网站权限后默认自动运行");expect(en).toContain("run automatically after browser website permission");
 for(const text of [zh,en])for(const platform of ["Kimi","Qwen"])expect(text).toContain(platform);
 expect(zh).toContain("仅保存当前已加载的消息，不保证完整历史");expect(en).toContain("saves currently loaded messages, not guaranteed full history");
});
