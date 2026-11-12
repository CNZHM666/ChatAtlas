import { describe, expect, it } from "vitest";
import { repairedStatements, statementDrift, trimmedQuote } from "./wiki-unit-fidelity";
import type { WikiKnowledgeUnit } from "../shared/wiki-knowledge";
import type { StructuredAIRequest } from "./provider";

const unit = (statement: string, quote: string, role: "user" | "assistant" = "assistant"): WikiKnowledgeUnit => ({ id: `u:${statement.length}`, subject: "订单", statement, kind: "plan", details: [], delivery: "unknown", adoption: { status: role === "assistant" ? "proposal" : "unknown" },
  evidence: { evidenceId: "e", conversationId: "c", messageId: "m", messageIndex: 1, role, pasted: false, quote } });

describe("statements saying more than their source", () => {
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
