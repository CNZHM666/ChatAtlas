import {it,expect} from "vitest";
import {joinWikiOwnerProse} from "./wiki-owner-prose";
import {projectSession} from "../test/project-fixture";
it("groups repeated subheadings, preserves scope and fenced examples without orphaning prose",()=>{
 const base=projectSession().sections[0];
 const result=joinWikiOwnerProse([{...base,body:"## 存储\n\n仅保存本地。\n\n## 检索\n\n按消息定位。"},{...base,body:"## 存储\n\n仅保存本地。\n\n失败后保留原数据。\n\n```md\n## 不是目录\n\n代码不拆开\n```\n\n## 检索\n\n用户确认后才建立向量索引。"}]);
 expect(result.match(/^## 存储$/gmu)).toHaveLength(1);expect(result.match(/^## 检索$/gmu)).toHaveLength(1);expect(result.match(/仅保存本地。/gu)).toHaveLength(1);
 expect(result.indexOf("失败后保留原数据")).toBeLessThan(result.indexOf("## 检索"));expect(result).toContain("```md\n## 不是目录\n\n代码不拆开\n```");expect(result).toContain("用户确认后");
});
it("does not deduplicate away a proposal or a different version's condition",()=>{
 const base=projectSession().sections[0];const body="## 检索\n\n使用消息索引。";
 const result=joinWikiOwnerProse([{...base,kind:"finding",phase:"现行",body},{...base,kind:"proposal",phase:"待讨论",body}]);
 expect(result).toContain("现行");expect(result).toContain("待讨论 · 待确认建议");expect(result.match(/使用消息索引。/gu)).toHaveLength(2);
});

it("merges repeated nested headings with their own paragraphs rather than attaching new detail to the last sibling",()=>{
 const base=projectSession().sections[0];
 const result=joinWikiOwnerProse([{...base,body:"## 检索\n\n### 索引\n\n失败时保留原文。\n\n### 排序\n\n按相关性排序。"},{...base,body:"## 检索\n\n### 索引\n\n失败时保留原文。\n\n仅在用户确认后更新索引。\n\n### 排序\n\n保留消息级定位。"}]);
 expect(result.match(/^### 索引$/gmu)).toHaveLength(1);expect(result.match(/^### 排序$/gmu)).toHaveLength(1);
 expect(result.indexOf("仅在用户确认后更新索引")).toBeLessThan(result.indexOf("### 排序"));
 expect(result.match(/失败时保留原文。/gu)).toHaveLength(1);expect(result).toContain("保留消息级定位。");
});

it("retains identical text under distinct parent conditions and keeps fenced heading examples intact",()=>{
 const base=projectSession().sections[0],body="## 模式\n\n### 平台服务\n\n#### 密钥归属\n\n此处需要独立授权。\n\n### 用户 BYOK\n\n#### 密钥归属\n\n此处需要独立授权。\n\n```md\n### 平台服务\n```";
 const result=joinWikiOwnerProse([{...base,body},{...base,body}]);
 expect(result.match(/此处需要独立授权。/gu)).toHaveLength(2);expect(result).toContain("```md\n### 平台服务\n```");
});

it("keeps one opening and places later chunk prefaces beside their own topic without losing facts",()=>{
 const base=projectSession().sections[0];
 const sections=["授权","失败保护","存储","同步"].map((title,index)=>({...base,body:`本章记录${title}的原始限制${index}。\n\n## ${title}\n\n${title}必须经过用户确认。`}));
 const shown=joinWikiOwnerProse(sections);
 expect(shown.split("## 授权")[0]).toBe("本章记录授权的原始限制0。\n\n");
 for(const [index,title] of ["失败保护","存储","同步"].entries())expect(shown).toContain(`## ${title}\n\n本章记录${title}的原始限制${index+1}。`);
 expect(joinWikiOwnerProse([{...base,body:shown}])).toBe(shown);
});

it("coalesces repeated bold scopes while preserving identical conditions under distinct modes",()=>{
 const base=projectSession().sections[0],body="## 接入\n\n**平台服务**\n\n仅允许使用自己的密钥。\n\n**用户 BYOK**\n\n仅允许使用自己的密钥。";
 const shown=joinWikiOwnerProse([{...base,body},{...base,body:body+"\n\n失败时保留原文。"}]);
 expect(shown.match(/\*\*平台服务\*\*/gu)).toHaveLength(1);expect(shown.match(/仅允许使用自己的密钥。/gu)).toHaveLength(2);
 expect(shown.indexOf("失败时保留原文")).toBeGreaterThan(shown.indexOf("**用户 BYOK**"));
});
