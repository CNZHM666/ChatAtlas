import {expect,it} from "vitest";
import {hasCredentialStoragePlan,reviewFullInteractionAcceptance,reviewProjectAcceptance,separateConfirmedStartingCount} from "./project-acceptance-review";
import {organizeProjectChapterTopics} from "./project-chapter-layout";

it("flags a first-release metric about a deferred capability, preserving later metrics and literal examples",()=>{
 const first="| MVP 成功标准（第一阶段） | MFA 通过率 > 90% |",later="| Beta v2.0 成功标准 | MFA 通过率 > 90% |";
 const table=["| 阶段 | 指标 |","| --- | --- |",first,later].join("\n");
 const literal=`~~~text\n${table}\n~~~`;
 const deferral=[{stage:"v1.0",feature:"MFA"}];
 const reviewed=reviewProjectAcceptance(`${table}\n\n${literal}`,deferral,false,true);
 expect(reviewed.scopeCount).toBe(1);
 expect(reviewed.body).toContain("已确认暂缓 v1.0 MFA");
 expect(reviewed.body).toContain("| 候选指标，适用版本待确认 · 原阶段标签 MVP 成功标准（第一阶段） | MFA 通过率 > 90% |");
 expect(reviewed.body).toContain(later);
 expect(reviewed.body).toContain(literal);
 expect(reviewProjectAcceptance(reviewed.body,deferral,false,true).body).toBe(reviewed.body);
});

it("separates mixed acceptance metrics when their boundaries and prerequisites are identifiable",()=>{
 const table="| 阶段 | 指标 | 条件 |\n| --- | --- | --- |\n| MVP 成功标准（第一阶段） | 查询正确率 > 90% 代码编译率 > 95% 离线仿真通过率 > 80% | 使用历史样本 |";
 const reviewed=reviewProjectAcceptance(table,[{stage:"v1.0",feature:"离线仿真"}],false,true);
 expect(reviewed.body).toContain("| 候选指标，适用范围待确认 | 查询正确率 > 90% |");
 expect(reviewed.body).toContain("| 依赖交付能力，适用版本待确认 | 代码编译率 > 95%；离线仿真通过率 > 80% |");
 expect(reviewed.body).toContain("> 原指标分组 · MVP 成功标准（第一阶段） · 使用历史样本");
});

it("labels the clash between a storage plan and an unbound all-store acceptance check",()=>{
 const check="1. 检查会话恢复。\n2. 检查各存储层均无完整 API Key。";
 expect(hasCredentialStoragePlan("API Key 暂存在 sessionStorage；禁止记入日志。")).toBe(true);
 expect(hasCredentialStoragePlan("API Key 不得保存在 sessionStorage。")).toBe(false);
 const review=reviewProjectAcceptance(check,[],true,true);
 expect(review.credentialCount).toBe(1);
 expect(review.body).toContain("凭据存储验收待确认");
 expect(review.body).toContain("1. 检查会话恢复。\n2. **凭据存储验收待确认** · 按使用模式核对允许保存的位置、期限和清理行为。");
 expect(review.body).toContain("\n\n> 原验收提案 · 检查各存储层均无完整 API Key。");
 expect(reviewProjectAcceptance(review.body,[],true,true).body).toBe(review.body);
});

it("asks for operation-level acceptance without assigning unconfirmed operations",()=>{
 const choice="Mobile mode supports full account editing.";
 const reviewed=reviewFullInteractionAcceptance(choice,[choice],false);
 expect(reviewed.count).toBe(1);
 expect(reviewed.body).toContain("| Candidate area | Conditions to define |");
 expect(reviewed.body).toContain("Which operations must work and what observable result is expected?");
 expect(reviewFullInteractionAcceptance(`${choice}\n\n### Account editing acceptance`,[choice],false).count).toBe(0);
 const canvas="平板首阶段支持完整画布编辑。";
 expect(reviewFullInteractionAcceptance(canvas,[canvas],true).body).toContain("| 连线与撤销 | 若纳入");
});

it("keeps only the pending target in the table that cites the confirmed initial count",()=>{
 const first="| 模板数量 | 先做稳6个基础模板，再逐步扩展至约15个；〔未定〕 [S-1-a] |";
 const other="| 其他配额 | 先做稳6个基础模板，再逐步扩展至约20个；〔未定〕 [S-2-b] |";
 const review=separateConfirmedStartingCount(`| 范围 | 第一版 |\n| --- | --- |\n${first}\n${other}`,"先做稳6个，再逐步扩展","S-1-a",true);
 expect(review).toContain("| 后续扩展数量 | 约15个；〔未定〕 [S-1-a] |");
 expect(review).toContain(other);
});

it("moves a named project workflow out of external references and labels misrouted delivery prose",()=>{
 const product={title:"Product overview",body:"### Scope\n\nExisting scope.\n\n### Earlier versions\n\nOld scope."};
 const refs={title:"External references",body:"### Competitors\n\nA distinct comparison.\n\n### River Notes workflow\n\nCapture → review.\n\n### Reference products\n\nAnother comparison."};
 const delivery={title:"Delivery plan",body:"### Learning path\n\nPhase 1 builds search.\n\nPhase 2 deploys tagging.\n\n### Earlier versions\n\n### Earlier versions\n\nEarlier plan."};
 organizeProjectChapterTopics([product,refs,delivery],"River Notes",false);
 expect(product.body.indexOf("Capture → review.")).toBeLessThan(product.body.indexOf("### Earlier versions"));
 expect(refs.body).not.toContain("River Notes workflow");
 expect(refs.body).toContain("Another comparison.");
 expect(delivery.body).toContain("### Delivery stages and references");
 expect(delivery.body.match(/^### Earlier versions$/gmu)).toHaveLength(1);
});
