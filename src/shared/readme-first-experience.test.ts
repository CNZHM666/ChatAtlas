import {expect,it} from "vitest";
import en from "../../README.md?raw";
import zh from "../../README.zh-CN.md?raw";
import principles from "../../PRODUCT_PRINCIPLES.md?raw";
import {version} from "../../package.json";

it("leads with source-checkable Markdown and states the key-free search option",()=>{
 const zhIntro = zh.split("## 安装到")[0], enIntro = en.split("## Install on")[0];
 expect(enIntro).toContain('href="README.zh-CN.md">简体中文</a>');
 expect(zhIntro).toContain('href="README.md">English</a>');
 expect(zhIntro).toMatch(/(?:基础|关键词)搜索[^。\n]*(?:无需|不需要) AI Key/u);
 expect(enIntro).toMatch(/(?:basic|keyword) search[^.\n]*(?:needs?|requires?) no AI key/iu);
 expect(zhIntro).toMatch(/可核对原话/u);
 expect(zhIntro).toMatch(/导出 Markdown/u);
 expect(enIntro).toMatch(/verifiable citations/iu);
 expect(enIntro).toMatch(/export[^.\n]*Markdown/iu);
 for(const text of [zh,en]){
  expect(text).toContain("docs/images/project-overview.png");
  expect(text).toContain("docs/images/evidence-review.png");
  expect(text).toContain("https://linux.do");
 }
});
it("links directly to the current preview ZIP and explains loading it in both browsers",()=>{
 const download=`https://github.com/CNZHM666/ChatAtlas/releases/download/v${version}/ChatAtlas-extension-v${version}.zip`;
 for(const [text,heading,load] of [[zh,"## 安装到","加载已解压的扩展程序"],[en,"## Install on","Load unpacked"]]){
  const install=text.slice(text.indexOf(heading)).split("\n## ")[0];
  expect(text.split("</p>").slice(0,5).join("</p>")).toContain(download);
  expect(install).toContain(download);
  expect(install).toContain("chrome://extensions");
  expect(install).toContain("edge://extensions");
  expect(install).toContain(load);
  expect(install).toContain("manifest.json");
  expect(install.match(/^\d\. /gmu)).toHaveLength(3);
 }
});
it("retains the product principles' import and native-integration boundaries in both editions",()=>{
 const scope=principles.split("\n")[6];
 for(const platform of ["ChatGPT","Claude","Gemini","Google Takeout JSON","DeepSeek"]){
  expect(scope).toContain(platform);
  expect(zh).toContain(platform);
  expect(en).toContain(platform);
 }
 expect(zh).toMatch(/浏览器授予(?:对应)?网站权限后[^。\n]*默认(?:自动运行|启用)/u);
 expect(en).toMatch(/by default once the browser grants access/iu);
 expect(zh).toMatch(/仅保存当前已加载的消息[^。\n]*(?:不保证完整历史|更早的历史可能尚未加载)/u);
 expect(en).toMatch(/only saves messages currently loaded[^.\n]*older history may be incomplete/iu);
 for(const text of [zh,en])for(const platform of ["Kimi","Qwen"])expect(text).toContain(platform);
});
