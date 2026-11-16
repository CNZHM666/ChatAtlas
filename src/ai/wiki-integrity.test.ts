import { expect, it } from "vitest";
import type { WikiDraftChapter, WikiKnowledgeUnit } from "../shared/wiki-knowledge";
import { restoredConditionalNegation, wikiChapterIntegrity, wikiIncompleteProse } from "./wiki-integrity";

const point = (id: string, statement: string, quote = statement, section?: string): WikiKnowledgeUnit => ({
  id, statement, subject: "设计", kind: "plan", details: [], delivery: "unknown", adoption: { status: "proposal" },
  evidence: { evidenceId: id, conversationId: "c", messageId: id, messageIndex: 1, role: "assistant", pasted: false, quote, section },
});
const check = (body: string, claims: NonNullable<WikiDraftChapter["paragraphs"][number]["claims"]>, units: WikiKnowledgeUnit[]) =>
  wikiChapterIntegrity({ id: "c", title: "设计", group: "", question: "", body, problems: [],
    paragraphs: [{ text: body, subtopic: "规则", unitIds: units.map(unit => unit.id), claims }] }, id => units.find(unit => unit.id === id), true);

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
