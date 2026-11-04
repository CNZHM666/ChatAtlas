import {expect,it} from "vitest";
import {projectPurposeText} from "./project-introduction-text";

it("projects standalone purpose and scope without copying separately attributed UI advice",()=>{
 const purpose="产品面向长期维护项目的用户，帮助找回已经形成的理解。首版仅支持用户确认的来源。";
 const body=purpose+"助手建议不新增独立的 Memory 页面，改用现有 Wiki 模块。";
 expect(projectPurposeText(body)).toBe(purpose);
 expect(projectPurposeText(projectPurposeText(body))).toBe(purpose);
 expect(projectPurposeText("The product helps users recover prior understanding. The assistant suggests a separate page.")).toBe("The product helps users recover prior understanding.");
});

it("preserves qualifications, conditions, unattributed design and literal examples",()=>{
 for(const body of ["助手建议新增独立页面。","产品建议面向开发者，帮助复习；仅在用户授权后导入。","产品用于复习。首版不新增独立页面。","产品帮助复习。助手建议保留用户确认的来源。","产品帮助复习。示例：`助手建议新增页面。`","产品帮助复习。\n\n助手建议新增页面。"]){expect(projectPurposeText(body)).toBe(body);}
});
