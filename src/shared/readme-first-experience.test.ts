import {expect,it} from "vitest";
import zh from "../../README.md?raw";
import en from "../../README.en.md?raw";
import principles from "../../PRODUCT_PRINCIPLES.md?raw";
import {version} from "../../package.json";

it("introduces search without an API key before installation",()=>{
 expect(zh.split("## 安装到")[0]).toContain("基础搜索不需要 AI Key");
 expect(en.split("## Install on")[0]).toContain("Basic search needs no AI key");
 expect(zh.split("## 能做什么")[0]).toContain("docs/images/sidecar-chatgpt-light.png");
 expect(en.split("## What it does")[0]).toContain("docs/images/sidecar-chatgpt-light.png");
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
 expect(zh).toContain("浏览器授予网站权限后默认自动运行");
 expect(en).toContain("run automatically after browser website permission");
 expect(zh).toContain("仅保存当前已加载的消息，不保证完整历史");
 expect(en).toContain("saves currently loaded messages, not guaranteed full history");
 for(const text of [zh,en])for(const platform of ["Kimi","Qwen"])expect(text).toContain(platform);
});
