import {expect,it} from "vitest";
import {groupWikiSupplements,wikiSupplementTitle,WIKI_SUPPLEMENT,normalizeWikiSupplementHeadings} from "./wiki-source-supplements";
import {generatedProse} from "./generated-structure-prose";
import {readingEmphasisMarkdown} from "./reading-emphasis";
const fence=(text:string)=>String.fromCharCode(96).repeat(3)+"text\n"+text+"\n"+String.fromCharCode(96).repeat(3);
const detail=(title:string,text:string)=>`<details data-atlas="${WIKI_SUPPLEMENT}">\n<summary>补充资料 · ${title}</summary>\n\n${fence(text)}\n\n</details>`;
it("keeps long and short example headings at the same level across repeated reading passes",()=>{
 const body=`<details data-atlas="${WIKI_SUPPLEMENT}">\n<summary>原文与示例 · 3 项</summary>\n\n1. JSON 示例 · a long literal caption that must not become body prose\n\n${fence('"x": 1')}\n\n**2. 数据结构 · interface Example {**\n\n${fence('interface Example {}')}\n\n#### 3. 流程示例 · User\n\n${fence('User\n↓\nResult')}\n\n</details>`;
 const normalized=normalizeWikiSupplementHeadings(body);
 expect(normalized.match(/^#### /gmu)).toHaveLength(3);
 expect(normalizeWikiSupplementHeadings(normalized)).toBe(normalized);
 const project=(body:string)=>readingEmphasisMarkdown(generatedProse(body).body,{sectioned:true});
 expect(project(body)).toBe(normalized);expect(project(project(body))).toBe(normalized);
 expect(normalized).toContain(fence('interface Example {}'));
 expect(normalizeWikiSupplementHeadings('1. JSON 示例 · 普通列表\n\n'+fence('x'))).toBe('1. JSON 示例 · 普通列表\n\n'+fence('x'));
});
it("collects examples after their subsection text without crossing headings, losing blanks or changing code",()=>{
 const one=fence("┌ A ┐\n\n\n└───┘"),two=fence("B → C"),three=fence("D");
 const body="## 布局\n\n正文甲。\n\n"+detail("布局甲","┌ A ┐\n\n\n└───┘")+"\n\n正文乙。\n\n"+detail("流程乙","B → C")+"\n\n## 部署\n\n"+detail("部署丙","D");
 const result=groupWikiSupplements(body);
 expect(result.match(/<details /gu)).toHaveLength(2);expect(result).toContain("参考示例 · 2 项");
 expect(result.indexOf("正文乙。")).toBeLessThan(result.indexOf("<details"));
 expect(result).toContain(one);expect(result).toContain(two);expect(result).toContain(three);
 expect(result.indexOf("## 部署")).toBeGreaterThan(result.indexOf("流程乙"));
 expect(groupWikiSupplements(result)).toBe(result);
});
it("derives recognizable names and keeps historical status outside the literal source",()=>{
 expect(wikiSupplementTitle({language:"text",text:"src/\n├ components/\n└ lib/"},"*界面草图*",true)).toContain("目录结构");
 expect(wikiSupplementTitle({language:"ts",text:"interface Candidate {\n  id: string;\n}"},"*代码 · 早期方案，已被替换*",true)).toBe("Candidate 接口 · 早期方案，已被替换");
 expect(wikiSupplementTitle({language:"sql",text:"CREATE TABLE projects (id TEXT PRIMARY KEY);"},"",true)).toBe("projects 数据表结构");
 expect(wikiSupplementTitle({language:"text",text:"A\n↓\nB"},"",false)).toContain("Flow example");
 expect(wikiSupplementTitle({language:"text",text:"标题里的第一句\n另一个标签"},"",true,"库存确认")).toBe("库存确认的参考示例");
 const diagram={language:"text",text:"Release v2.4\nCapture\n↓\nProcess\n↓\nPublish"};
 expect(wikiSupplementTitle(diagram,"*Flow · v2 · AI suggestion*",false,"Delivery plan")).toBe("Flow example for Delivery plan · Source diagram v2.4, scope unverified · AI suggestion");
 expect(diagram.text).toContain("Release v2.4");
});
