import { expect, it } from "vitest";
import type { WikiDraftChapter, WikiKnowledgeUnit } from "../shared/wiki-knowledge";
import { restoreDetachedWikiScope, restoredConditionalNegation, wikiChapterIntegrity, wikiIncompleteProse } from "./wiki-integrity";
import { lostNegation, recheckWikiTableNegation } from "./wiki-negation-review";

const point = (id: string, statement: string, quote = statement, section?: string): WikiKnowledgeUnit => ({
  id, statement, subject: "设计", kind: "plan", details: [], delivery: "unknown", adoption: { status: "proposal" },
  evidence: { evidenceId: id, conversationId: "c", messageId: id, messageIndex: 1, role: "assistant", pasted: false, quote, section },
});
const check = (body: string, claims: NonNullable<WikiDraftChapter["paragraphs"][number]["claims"]>, units: WikiKnowledgeUnit[]) =>
  wikiChapterIntegrity({ id: "c", title: "设计", group: "", question: "", body, problems: [],
    paragraphs: [{ text: body, subtopic: "规则", unitIds: units.map(unit => unit.id), claims }] }, id => units.find(unit => unit.id === id), true);

it("restores a detached release scope from the stored complete sentence only", () => {
  const tail = "的核心约束是以确定性规则验证结果。";
  expect(restoreDetachedWikiScope(tail, ["第一版" + tail])).toBe("第一版" + tail);
  expect(restoreDetachedWikiScope(tail, ["第一版" + tail, "第二版" + tail])).toBe(tail);
});

it("keeps a supported example command distinct from a general prohibition", () => {
  const source = point("command", "完整支持“不要 OLED，改成温度超过 30℃时蜂鸣器报警”的修改。");
  const sentence = "涵盖 DHT22、OLED、MOSFET 等元件。";
  expect(lostNegation(sentence, [source.statement])).toBeUndefined();
  expect(lostNegation("系统允许使用 OLED。", ["系统绝对禁止使用 OLED。"])).toBeDefined();
  expect(recheckWikiTableNegation('"涵盖 DHT22、OLED…" drops the negation of "完整支持“不要 OLED…"', sentence,
    [{ text: sentence, unitIds: [source.id] }], new Map([[source.id, source]]))).toBe(true);
});

it("clears negation warnings for response labels while retaining actual constraints", () => {
  const labels = "通过“我有/没有/不确定”及拍照识别来更新库存状态";
  const restriction = "禁止根据拍照识别直接写入库存或零件目录";
  const source = point("inventory", `库存不再作为独立导航项，${labels}。${restriction}。`);
  const sentence = `库存不再作为独立导航项，${labels}。${restriction}。`;
  const claims = [{ text: labels, unitIds: [source.id] }], units = new Map([[source.id, source]]);
  const warning = `"通过及拍照识别来更新库存状态…" drops the negation of "${labels}…"`;
  expect(lostNegation(sentence, [source.statement])).toBeUndefined();
  expect(recheckWikiTableNegation(warning, sentence, claims, units)).toBe(true);
  expect(recheckWikiTableNegation(warning, sentence, [{ ...claims[0], unitIds: ["unbound"] }], units)).toBe(false);
  expect(lostNegation("系统可以根据拍照识别直接写入库存或零件目录。", [source.statement])?.source).toBe(restriction);
});

it("keeps both source conditions for the saved short rule and resolves only its matching warning",()=>{
 const value="返回 unsupportedOrUnsafe=true 并阻止加入 Inventory";
 const table=`| 事项 | 第一版 |\n| --- | --- |\n| 危险部件识别 | ${value} |`;
 const sources=[
  point("a","若识别出市电、高压、膨胀电池等危险部件，返回 unsupportedOrUnsafe: true 并提示不建议新手拆解，阻止其加入 Inventory。"),
  point("b","疑似市电电源板、裸高压、膨胀电池、大型储能电容、CRT 部件等返回 unsupportedOrUnsafe=true，禁止加入 Inventory。"),
 ];
 const fixed=check(table,[{text:value,unitIds:["a","b"]}],sources);
 const claim=fixed.paragraphs[0].claims![0].text;
 for(const source of sources)expect(claim).toContain(source.statement);
 expect(restoredConditionalNegation('"返回 unsupportedOrUnsafe=true 并阻…" drops the negation of "禁止加入 Inventory…"',value,claim,sources)).toBe(true);
 expect(restoredConditionalNegation('"返回 unsupportedOrUnsafe=true 并阻…" drops the negation of "禁止加入项目…"',value,claim,sources)).toBe(false);
 expect(check(fixed.body,fixed.paragraphs[0].claims!,sources).repaired).toBe(0);
});

it("restores a clipped rule table cell from one exact bound action and consequence",()=>{
 const value="返回 unsupportedOrUnsafe: true 并阻止加入 Inventory";
 const table=`| 事项 | 行为 |\n| --- | --- |\n| 危险部件识别 | ${value} |`;
 const unit=point("a","若识别出市电、高压、膨胀电池等危险部件，返回 unsupportedOrUnsafe: true 并提示不建议新手拆解，阻止其加入 Inventory。");
 expect(check(table,[{text:value,unitIds:["a"]}],[unit]).body).toContain(unit.statement);
 expect(check(table,[{text:value,unitIds:["a","missing"]}],[unit]).body).toBe(table);
 expect(check(table,[{text:value,unitIds:["a"]}],[{...unit,evidence:{...unit.evidence,quote:table}}]).body).toBe(table);
});

it("completes a truncated flow only when its bound source gives a unique continuation", () => {
  const text = "全部操作通过 Prepare->Validate-。";
  const source = point("a", "全部操作通过 Prepare->Validate->Commit 流程。");
  const claims = [{ text, unitIds: [source.id] }];
  expect(check(text, claims, [source])).toMatchObject({ body: "全部操作通过 Prepare → Validate → Commit。", repaired: 1, problems: [] });
  const ambiguous = point("a", source.statement, "Prepare -> Validate -> Rollback");
  expect(check(text, claims, [ambiguous])).toMatchObject({ body: text, repaired: 0, problems: [expect.stringContaining("incomplete generated prose")] });
  expect(wikiIncompleteProse("正常的流程 A -> B。\n\n```text\nA -> B-。\n```")).toEqual([]);
  expect(wikiIncompleteProse("前置校验成功。随后运行 Prepare->Validate-。结果写入日志。")[0]?.preserved).toBe("前置校验成功。结果写入日志。");
});

it("flags a dangling term while preserving the complete explanation and literal code",()=>{
 const text="架构视图展示模块间的逻辑关系。I²C）。";
 expect(wikiIncompleteProse(text)[0]?.preserved).toBe("架构视图展示模块间的逻辑关系。");
 expect(wikiIncompleteProse("接口为 I²C（可选）。\n\n```text\nI²C）。\n```")).toEqual([]);
});

it("restores a missing Chinese subject only from its complete bound statement", () => {
 const tail="的通过标准包含查询速度和覆盖率。";
 const source=point("a",`夜间回归测试${tail}`);
 const claims=[{text:tail,unitIds:[source.id]}];
 expect(check(tail,claims,[source])).toMatchObject({body:source.statement,repaired:1,problems:[]});
 expect(check(tail,[{text:tail,unitIds:[source.id,"missing"]}],[source]).problems).toHaveLength(1);
 expect(wikiIncompleteProse(`> ${tail}\n\n的确还有一项计划需要验证。`)).toEqual([]);
});

it("removes editing residue and restores only the bound complete claim", () => {
  const source = point("a", "邀请测试时保留完整反馈记录，进度每周同步给所有参与者。");
  const text = "此前已推…（注：此处根据规则修正，不写时长）邀请测试时保留完整反馈记录，进度每周同步给所有参与者。";
  const checked = check(text, [{ text, unitIds: ["a"] }], [source]);
  expect(checked.body).toBe(source.statement);
  expect(checked.paragraphs[0].claims).toEqual([{ text: source.statement, unitIds: ["a"] }]);
});

it("binds a misnamed UI target to its actual heading, and keeps an ordered plan out of the exclusions column", () => {
  const section = "Detail Drawer", target = "Import Screen";
  const layout = "中间放置宽 420～480px 的文件导入区域。";
  const ui = point("ui", layout, `Previous: ${section}\n\n# 2. ${target}\n\n${layout}`, section);
  const plan = point("plan", "暂不扩充至 12 类文件，先把现有 3 类验证完整，再扩展至约 6 类。");
  const wrong = `${section} ${layout}`, cell = "扩充至 12 类文件、先把现有 3 类验证完整、再扩展至约 6 类";
  const body = `${wrong}\n\n| 阶段 | 不做 |\n| --- | --- |\n| 导入规划 | ${cell} |\n| 当前阶段 | 联网转换 |`;
  const fixed = check(body, [{ text: wrong, unitIds: ["ui"] }, { text: cell, unitIds: ["plan"] }], [ui, plan]);
  expect(fixed.body).toContain(`${target} ${layout}`);
  expect(fixed.body).toContain(plan.statement);
  expect(fixed.body).toContain("| 当前阶段 | 联网转换 |");
  expect(fixed.body).not.toContain("| 导入规划 |");
  expect(fixed.problems).toEqual([]);
});
