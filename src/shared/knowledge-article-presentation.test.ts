import {expect,it} from "vitest";
import {knowledgeArticlePresentation} from "./knowledge-article-presentation";

it("deduplicates exact generated paragraphs in one topic while preserving scoped variants and originals",()=>{
 const paragraph="Hardware IR 保存当前设计状态，界面、物料清单与代码视图均从同一份设计数据派生。修改失败时保留原项目，不将半成品覆盖已经保存的结果。";
 const body=`## 修改事务\n\n${paragraph}\n\n${paragraph}\n\n## V2 计划\n\n${paragraph}`;
 const shown=knowledgeArticlePresentation(body);
 expect(shown.split(paragraph)).toHaveLength(3);expect(knowledgeArticlePresentation(shown)).toBe(shown);
 expect(knowledgeArticlePresentation(body,true,[paragraph])).toBe(body);
 const code=`\n\n\`\`\`text\n${paragraph}\n${paragraph}\n\`\`\``;
 expect(knowledgeArticlePresentation(code)).toBe(code);
});

it("hides bold wire evidence bullets without hiding confirmed progress or named sources",()=>{
 const result=knowledgeArticlePresentation("用户确认当前完成度为90%。\n\n* **证据来源**: e1, e2, e4\n\n**证据来源**：用户测试记录\n\n- **Evidence IDs**: e3, e5");
 expect(result).toContain("完成度为90%");expect(result).toContain("用户测试记录");expect(result).not.toMatch(/\be[1-5]\b/u);
 expect(knowledgeArticlePresentation("保留事务回滚（**证据来源**: e1, e2）。\n\n仅在用户确认后提交，**Evidence IDs:** e3。")).toBe("保留事务回滚。\n\n仅在用户确认后提交。");
});

it("removes generated evidence-source ID columns, retaining real sources and business target states",()=>{
 const body="| 指标 | 目标状态 | 证据来源 |\n|---|---|---|\n| 目标用户 | 大学生小白 | e5 |\n| 验证周期 | 两周 | [e5] |\n| 停止阈值 | <3人继续使用 | e5、e6 |";
 const result=knowledgeArticlePresentation(body);
 expect(result).not.toMatch(/证据来源|e5|e6/u);expect(result).toContain("目标状态");expect(result).toContain("<3人继续使用");expect(knowledgeArticlePresentation(result)).toBe(result);
 const real=body.replaceAll("e5", "用户访谈记录");expect(knowledgeArticlePresentation(real)).toBe(real);
 expect(knowledgeArticlePresentation("```md\n"+body+"\n```")).toContain("证据来源");
});

it("hides uniform internal status and evidence columns but preserves the proposal meaning",()=>{
 const body="| 验证层级 | 检查内容 | 状态 | 证据 |\n|---|---|---|---|\n| Level 1 | Schema | Proposal | e1 |\n| Level 2 | GPIO、电压 | Proposal | e2 |";
 const result=knowledgeArticlePresentation(body);
 expect(result).toContain("讨论提出以下设计：");expect(result).toContain("GPIO、电压");expect(result).not.toMatch(/Proposal|e1|证据|状态/u);
 expect(knowledgeArticlePresentation(result)).toBe(result);
});
it("turns a two-column evidence-ID summary into readable conclusions without losing formatting",()=>{
 const body="| 证据ID | 关键结论 |\n|---|---|\n| e1 | 确立**工程工具感**，支持完整深浅模式 |\n| e2 | 保留 `Node/Edge` 样式 |\n| e5 | 建议强化视觉焦点与视图区分 |";
 const result=knowledgeArticlePresentation(body);
 expect(result).toBe("**关键结论**\n\n- 确立**工程工具感**，支持完整深浅模式\n- 保留 `Node/Edge` 样式\n- 建议强化视觉焦点与视图区分");
 expect(knowledgeArticlePresentation(result)).toBe(result);
 const english=body.replace("证据ID","Evidence ID").replace("关键结论","Conclusion");
 expect(knowledgeArticlePresentation(english,false)).not.toMatch(/Evidence ID|\be[125]\b/u);
 expect(knowledgeArticlePresentation(body,true,[body])).toBe(body);
 expect(knowledgeArticlePresentation(body.replace("e1", "访谈记录1"))).toContain("证据ID");
 expect(knowledgeArticlePresentation("> "+body.replaceAll("\n","\n> "))).toContain("证据ID");
});
it("preserves business states, real evidence, source quotations and executable code",()=>{
 const body="| 任务 | 状态 | 说明 |\n|---|---|---|\n| 构建 | completed | 测试通过 |\n| 发布 | planned | 待发布 |\n\n```js\nconst value = validateProject(project);\nconsole.log(value);\n```\n\n> Proposal 仅代表建议。";
 expect(knowledgeArticlePresentation(body)).toBe(body);
 const original="```js\nvalidateProject(project)\n```";
 expect(knowledgeArticlePresentation(original,true,[original])).toBe(original);
});
it("renders a generated function mention inline and normalizes only the known three-output ASCII diagram",()=>{
 expect(knowledgeArticlePresentation("```js\nvalidateProject(project)\n```")).toBe("`validateProject(project)`");
 const body="```text\nPrompt\n↓\nAI\n↓\nHardware IR\n/    |    \\\\\n↓    ↓    ↓\nCanvas  BOM  Code\n```";
 expect(knowledgeArticlePresentation(body)).toBe("Prompt → AI → Hardware IR\n\nHardware IR → Canvas / BOM / Code");
 const path="```text\nC:\\\\project\\\\code\n```";expect(knowledgeArticlePresentation(path)).toBe(path);
});

it("keeps mixed proposal and discussion qualifications in the descriptions without a wire status column",()=>{
 const body="| 特性 | 描述 | 状态 |\n|---|---|---|\n| 推开式分屏 | 不遮挡正文 | Documented |\n| 极简结构 | 历史查找与上下文收藏 | Proposal |";
 const result=knowledgeArticlePresentation(body);
 expect(result).not.toMatch(/Documented|Proposal|状态/u);expect(result).toContain("以下为讨论记录：不遮挡正文");expect(result).toContain("讨论提出以下设计：历史查找与上下文收藏");expect(knowledgeArticlePresentation(result)).toBe(result);
});
it("presents deep generated headings as quiet labels while retaining examples and source headings",()=>{
 const body="## 主小节\n\n#### 短要点\n\n保留条件与细节。\n\n##### 补充条件\n\n输入失败时保留原稿。\n\n```md\n#### literal\n```";
 const result=knowledgeArticlePresentation(body);expect(result).toContain("## 主小节");expect(result).toContain("**短要点**");expect(result).toContain("**补充条件**");expect(result).toContain("#### literal");expect(knowledgeArticlePresentation(result)).toBe(result);
 expect(knowledgeArticlePresentation(body,true,[body])).toBe(body);
});

it("retains identical conditions in different deep subject scopes across repeated presentation",()=>{
 const paragraph="仅当用户明确确认后才写回，失败时保留现有结果。".repeat(4);
 const body=`## 主流程\n\n#### 导入\n\n${paragraph}\n\n#### 导出\n\n${paragraph}`;
 const once=knowledgeArticlePresentation(body);expect(once.split(paragraph)).toHaveLength(3);expect(knowledgeArticlePresentation(once)).toBe(once);
});
