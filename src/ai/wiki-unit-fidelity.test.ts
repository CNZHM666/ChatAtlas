import { describe, expect, it } from "vitest";
import { reanchorWikiUnit, repairedStatements, statementDrift, trimmedQuote, wikiCompleteDetail } from "./wiki-unit-fidelity";
import type { WikiKnowledgeUnit } from "../shared/wiki-knowledge";
import type { StructuredAIRequest } from "./provider";
import { AIProviderResponseError } from "./provider-errors";

const unit = (statement: string, quote: string, role: "user" | "assistant" = "assistant"): WikiKnowledgeUnit => ({ id: `u:${statement.length}`, subject: "订单", statement, kind: "plan", details: [], delivery: "unknown", adoption: { status: role === "assistant" ? "proposal" : "unknown" },
  evidence: { evidenceId: "e", conversationId: "c", messageId: "m", messageIndex: 1, role, pasted: false, quote } });

describe("statements saying more than their source", () => {
  it("reanchors a clipped receipt to a complete original section without accepting a reversed prohibition", () => {
    const detail = "右侧 Inspector 展示详情。";
    const allowed = "画布节点选中使用蓝色边框，右侧 Inspector 展示详情。";
    const denied = "整个节点染成红色。";
    const original = `# 画布节点\n\n${allowed}\n\n不要：${denied}\n\n# Inspector\n\n${detail}`;
    const clipped = { ...unit(allowed, detail), subject: "画布节点", details: ["左边的", "蓝色边框"] };
    const restored = reanchorWikiUnit(clipped, original);
    expect(restored.id).toBe(clipped.id);
    expect(restored.evidence.section).toBe("画布节点");
    expect(restored.evidence.quote).not.toContain("# Inspector");
    expect(original).toContain(restored.evidence.quote);
    expect(restored.details).not.toContain("左边的");
    expect(wikiCompleteDetail("右边的", detail)).toBe(false);
    const reversed = { ...unit(denied, detail), subject: "画布节点" };
    expect(reanchorWikiUnit(reversed, original)).toBe(reversed);
    expect(statementDrift(unit(denied, `不要：${denied}`), original)).toContainEqual(expect.stringMatching(/^assertion polarity:/u));
  });
  it("recovers an ordered roadmap only if the original headings support every stage in order", () => {
    const old = "# UI 规则\n\n# Foundation 样式\n\n使用默认字体。";
    const plan = "# 开发顺序\n\n## Phase 1 — Foundation\n\n创建工程。\n\n## Phase 2 — Domain\n\n建立领域模型。\n\n## Phase 3 — Editing\n\n接着加入编辑。";
    const full = `${old}\n\n${plan}\n\n# 结束\n\n其他讨论。`;
    const original = unit("严格按 Phase 1-3 执行：Foundation → Domain → Editing。", old);
    const roadmap = { ...original, subject: "开发顺序", evidence: { ...original.evidence, section: "UI 规则" } };
    expect(statementDrift(roadmap, full)).toContainEqual(expect.stringMatching(/^assertion topic:/u));
    expect(statementDrift({ ...roadmap, evidence: { ...roadmap.evidence, quote: plan, section: "开发顺序" } }, full)).toEqual([]);
    expect(reanchorWikiUnit(roadmap, full).evidence.quote).toBe(plan.slice(0, plan.indexOf("\n\n接着")));
    const wrongOrder = { ...roadmap, statement: "严格按 Phase 1-3 执行：Foundation → Editing → Domain。" };
    expect(reanchorWikiUnit(wrongOrder, full)).toBe(wrongOrder);
  });

  it("reanchors a UI instruction to the supporting child section and keeps the other screen out",()=>{
    const evidence="# 接下来最值得做的工作\n\n## 1）点击 AI 输入框后，真的能改图\n哪怕只做三个固定命令也行：\n\n- 删除 OLED\n- 换成蜂鸣器\n- 为什么需要 MOSFET\n\n## 2）真正做出接线视图\n接线视图要区分颜色和端点。";
    const original=unit("实现点击输入框后能真正修改设计图，初期支持删除组件、替换组件等固定命令。",evidence);
    const scoped={...original,subject:"AI 助手交互能力",evidence:{...original.evidence,section:"接下来最值得做的工作"}};
    const moved=reanchorWikiUnit(scoped,evidence);
    expect(moved.evidence.quote).toContain("删除 OLED");
    expect(moved.evidence.quote).not.toContain("真正做出接线视图");
    expect(reanchorWikiUnit({...scoped,statement:scoped.statement.replace("三个","五个")+"至少支持5条命令。"},evidence).evidence.quote).toBe(evidence);
  });
  it("leaves separately headed content out of the unit even if the new statement matches its quote", () => {
    const quote = "# 右侧 Inspector\n\n宽度 320px，默认显示项目概览。";
    const original = unit("右侧 Inspector 宽度 320px，默认显示项目概览。", quote);
    const topic = { ...original, subject: "Edge 视觉规范", evidence: { ...original.evidence, section: "Edge 设计" } };
    expect(statementDrift(topic, quote)).toContainEqual(expect.stringMatching(/^assertion topic:/u));
    const action = "整个节点染成红色。";
    expect(statementDrift(unit(action, action), "不要：\n" + action)).toContainEqual(expect.stringMatching(/^assertion polarity:/u));
  });
  it("names a rule made stricter, and a recommendation told as chosen", () => {
    const quote = "退款审核时不要让客服直接改金额，我更推荐走审批单。";
    expect(statementDrift(unit("严禁客服直接修改退款金额，最终选择审批单流程。", quote), quote).map(reason => reason.split(":")[0])).toEqual(["strength", "decided"]);
    expect(statementDrift(unit("不要让客服直接修改退款金额，推荐走审批单。", quote), quote)).toEqual([]);
    // The source's own strength may be kept, and a word near the cut quote counts.
    expect(statementDrift(unit("必须保留审批记录。", "保留审批记录"), "所有退款必须保留审批记录，方便追查。")).toEqual([]);
    // Not deciding is no decision word; the user's own choice may be told as chosen.
    expect(statementDrift(unit("退款方式暂不确定。", "退款方式还没想好"), "退款方式还没想好")).toEqual([]);
    expect(statementDrift(unit("决定使用审批单处理退款。", "就用审批单吧", "user"), "就用审批单吧")).toEqual([]);
  });

  it("names a figure its message never gives, reading counted Han numerals as digits", () => {
    const body = "建议首页只放三个入口，退款入口放第二位。";
    expect(statementDrift(unit("首页只放3个入口。", "首页只放三个入口"), body)).toEqual([]);
    expect(statementDrift(unit("首页只放4个入口，转化率提升20%。", "首页只放三个入口"), body)).toEqual(["figures: 4, 20 not in the source"]);
  });

  it("names a day of a sequence told as a length, not a length the source gives", () => {
    const body = "第1—3天每天推送一条使用提示；第3天展示账单摘要并提示升级。根据过去3天记录生成建议。";
    expect(statementDrift(unit("新用户前3天免费试用，之后提示升级。", "第3天展示账单摘要并提示升级"), body)[0]).toMatch(/^role: "前3天"/u);
    expect(statementDrift(unit("第3天展示账单摘要并提示升级。", "第3天展示账单摘要并提示升级"), body)).toEqual([]);
    expect(statementDrift(unit("试用期为前7天。", "前7天免费"), "前7天免费，第7天提醒续费。")).toEqual([]);
  });
});

describe("quotes trimmed to the blocks stating their point", () => {
  const quote = "另外，支付前要确认商户资质和结算规则，不要走私下转账。\n\n我的最终建议：先免费开放7天体验，然后卖19元的月度套餐。";
  it("drops an edge block sharing nothing with the statement, keeping a span of the quote", () => {
    const trimmed = trimmedQuote("先免费开放7天体验，随后销售19元月度套餐。", quote);
    expect(trimmed).toBe("我的最终建议：先免费开放7天体验，然后卖19元的月度套餐。");
    expect(quote.includes(trimmed)).toBe(true);
  });
  it("keeps a quote whose blocks all bear on the point, or none plainly states it", () => {
    expect(trimmedQuote("支付前确认商户资质，开放7天体验后销售月度套餐。", quote)).toBe(quote);
    expect(trimmedQuote("用户留存偏低。", quote)).toBe(quote);
  });
});

it("takes a rewrite only when it drifts less, and keeps the statement when the request fails", async () => {
  const body = "退款审核时不要让客服直接改金额。", drifting = unit("严禁客服直接修改退款金额。", body), other = unit("必须让客服直接改退款金额，并提升30%效率。", body);
  const ai = { generateStructured: async <T,>(request: StructuredAIRequest<T>) => request.validate!({ units: [{ id: "u1", statement: "不要让客服直接修改退款金额。" }, { id: "u2", statement: "必须让客服直接改退款金额，提升30%效率。" }] }) as T };
  const flagged = [drifting, other].map(item => ({ unit: item, body, reasons: statementDrift(item, body) }));
  const { statements } = await repairedStatements(flagged, ai, "zh-CN", new AbortController().signal);
  expect([...statements]).toEqual([[drifting.id, "不要让客服直接修改退款金额。"]]);
  const failing = { generateStructured: async () => { throw new Error("down"); } };
  expect(await repairedStatements(flagged, failing, "zh-CN", new AbortController().signal)).toMatchObject({ failed: 1, requests: 1 });
});

it("does not accept an unrelated true statement as a repair", async () => {
  const quote = "线条尽量保持灰色。右侧 Inspector 建议宽度为 320px。";
  const original = { ...unit("线条必须保持灰色。", quote), subject: "线条样式" };
  const ai = { generateStructured: async <T,>(request: StructuredAIRequest<T>) => request.validate({
    units: [{ id: "u1", statement: "右侧 Inspector 建议宽度为 320px。" }],
  }) };
  const result = await repairedStatements([{ unit: original, body: quote, reasons: statementDrift(original, quote) }], ai, "zh-CN", new AbortController().signal);
  expect(result.statements.size).toBe(0);
});

it("splits truncated repairs and keeps the successful half", async () => {
  const body = "建议本地保存配置。";
  const flagged = Array.from({ length: 4 }, (_, index) => {
    const source = { ...unit("必须本地保存配置。", body), id: "point-" + index };
    return { unit: source, body, reasons: statementDrift(source, body) };
  });
  const sizes: number[] = [];
  const ai = { generateStructured: async <T,>(request: StructuredAIRequest<T>): Promise<T> => {
    const rows = JSON.parse(request.prompt).units as Array<{ id: string; statement: string }>;
    sizes.push(rows.length);
    if (rows.length > 2) throw new AIProviderResponseError("PROVIDER_OUTPUT_TRUNCATED");
    if (sizes.length === 3) throw new Error("offline");
    return request.validate({ units: rows.map(row => ({ id: row.id, statement: body })) });
  } };
  const result = await repairedStatements(flagged, ai, "zh-CN", new AbortController().signal);
  expect(sizes).toEqual([4, 2, 2]);
  expect(result.statements.size).toBe(2);
  expect(result.checked.size).toBe(2);
  expect(result.failed).toBe(1);
});
