import { expect, it } from "vitest";
import { approximatePoints, wikiEvidencePoints } from "./wiki-evidence";
import { needsConfirmation } from "./workspace-evidence-context";
import { overviewChapterCards, overviewChapterSummary } from "./project-overview-workspace";
import { projectSession } from "../test/project-fixture";
import { restoreWikiSourceNegation } from "../shared/wiki-source-negation";

it("opens the original that holds the claim's quote, whatever order the originals are listed in", () => {
  const session = projectSession();
  const other = { id: "a", conversationId: "c", messageId: "m-other", title: "", excerpt: "首页只保留搜索入口。" };
  const holding = { id: "b", conversationId: "c", messageId: "m-quote", title: "", excerpt: "我们决定索引使用 Orama 做全文检索。" };
  const section = { ...session.sections[0], evidenceIds: ["a", "b"], claims: [{ text: "索引使用 Orama 做全文检索。", quote: "索引使用 Orama 做全文检索", evidenceIds: ["a", "b"] }] };
  const [point] = wikiEvidencePoints(section, [other, holding], true);
  expect(point.reference.messageId).toBe("m-quote");
  // The quote is found, so the point needs no look for a missing quote.
  expect(point.quote).toBe("索引使用 Orama 做全文检索");
  expect(point.attention?.kind).not.toBe("missing");
});

it("takes a point the user answered out of the questions, whatever it was flagged for", () => {
  const session = projectSession();
  const source = { id: "a", conversationId: "c", messageId: "m", title: "", excerpt: "索引可以用 Orama。" };
  const claim = { text: "已决定索引使用 Orama。", quote: "索引可以用 Orama", evidenceIds: ["a"], workStatus: "proposed" as const, holder: "ai" as const, holderMark: true };
  const section = { ...session.sections[0], body: claim.text, evidenceIds: ["a"], claims: [claim] };
  const [asked] = wikiEvidencePoints(section, [source], true);
  expect(asked.attention?.kind).toBe("settled");expect(needsConfirmation(asked)).toBe(true);
  const [answered] = wikiEvidencePoints({ ...section, claims: [{ ...claim, checked: true }] }, [source], true);
  expect(answered.checked).toBe(true);expect(needsConfirmation(answered)).toBe(false);
  expect(wikiEvidencePoints({ ...section, body: "索引方式仍在讨论。" }, [source], true).some(needsConfirmation)).toBe(false);
});

it("flags high-signal risks (unproven completion and revived earlier plans) while skipping noisy lexical nitpicks", () => {
  const session = projectSession();
  const source = { id: "a", conversationId: "c", messageId: "m", title: "", excerpt: "不要搞太复杂，首版用轻量本地索引。" };
  const normal = { text: "首版采用轻量本地索引。", quote: source.excerpt, evidenceIds: ["a"], holder: "decided" as const };
  const section = { ...session.sections[0], body: normal.text, evidenceIds: ["a"], claims: [normal] };
  expect(wikiEvidencePoints(section, [source], true).some(needsConfirmation)).toBe(false);

  const unprovenSource = { id: "b", conversationId: "c", messageId: "m2", title: "", excerpt: "后续计划接入本地向量索引。" };
  const unprovenClaim = { text: "已经完成本地向量索引接入。", quote: unprovenSource.excerpt, evidenceIds: ["b"], holder: "ai" as const, workStatus: "proposed" as const };
  const [unproven] = wikiEvidencePoints({ ...section, body: unprovenClaim.text, evidenceIds: ["b"], claims: [unprovenClaim] }, [unprovenSource], true);
  expect(unproven.attention?.kind).toBe("tentative");
  expect(needsConfirmation(unproven)).toBe(true);

  const earlierSource = { id: "e", conversationId: "c", messageId: "m3", title: "", excerpt: "最早想用服务端同步保存对话。" };
  const revivedClaim = { text: "已决定采用服务端同步保存对话。", quote: earlierSource.excerpt, evidenceIds: ["e"], holder: "earlier" as const };
  const [revived] = wikiEvidencePoints({ ...section, body: revivedClaim.text, evidenceIds: ["e"], claims: [revivedClaim] }, [earlierSource], true);
  expect(revived.attention?.kind).toBe("negation");
  expect(needsConfirmation(revived)).toBe(true);
});

it("checks a decided label on a proposal and explicit version or prerequisite mismatches", () => {
  const section = projectSession().sections[0];
  const inspect = (text: string, quote: string, holder: "decided" | "open" = "open") => {
    const ref = { ...projectSession().evidence[0], excerpt: quote };
    return wikiEvidencePoints({ ...section, body: text, claims: [{ text, quote, evidenceIds: [ref.id], holder,
      workStatus: holder === "decided" ? "proposed" : undefined }] }, [ref], true)[0];
  };
  expect(inspect("索引使用 Orama。", "建议索引使用 Orama。", "decided").attention?.kind).toBe("settled");
  expect(inspect("V0.1 支持批量导出历史对话。", "V0.2 支持批量导出历史对话。").attention?.kind).toBe("negation");
  expect(inspect("浏览器会保存密钥到本地。", "只有用户授权才保存密钥到本地。").attention?.kind).toBe("negation");
  expect(inspect("用户授权后才保存密钥到本地。", "只有用户授权才保存密钥到本地。").attention).toBeUndefined();
});

it("keeps wording matches and supported partial findings out of the review queue", () => {
  const session = projectSession(), ref = session.evidence[0];
  const points = approximatePoints("one", [ref], ref.excerpt, true);
  expect(points.length).toBeGreaterThan(0);
  expect(points.every(point => point.approximate && !needsConfirmation(point))).toBe(true);
  expect(needsConfirmation({ attention: { kind: "unsupported" }, sourceLocated: true })).toBe(false);
  expect(needsConfirmation({ attention: { kind: "missing" }, sourceLocated: false })).toBe(true);
  expect(needsConfirmation({ attention: { kind: "partial" }, sourceLocated: false })).toBe(false);
});

it("builds concise local chapter cards with the same review count as the evidence queue", () => {
  const session = projectSession(), ref = { ...session.evidence[0], excerpt: "建议采用本地索引，搜索结果保持原始顺序。" };
  const text = "已决定采用本地索引，搜索结果保持原始顺序。";
  const page = { ...session.sections[0], body: `### 索引说明\n\n**${text}** 〔已定〕 [来源1](#source-e1)`,
    claims: [{ text, quote: ref.excerpt, evidenceIds: [ref.id], workStatus: "proposed" as const, holder: "ai" as const }] };
  const view = { ...session, evidence: [ref], sections: [page] };
  expect(overviewChapterCards(view, true)[page.id]).toEqual({ summary: text, decidedCount: 0, pendingReviewCount: 1 });
  expect(overviewChapterSummary("### 章节\n\n" + "索引支持依据项目范围查询原始材料，".repeat(8) + "并保留结果顺序。").length).toBeLessThanOrEqual(65);
});

it("does not revive review tasks from the removed AI meaning check's stored verdicts", () => {
  const session = projectSession(), ref = { ...session.evidence[0], excerpt: "默认中性灰。" };
  const section = { ...session.sections[0], evidenceIds: [ref.id], claims: [{ text: "默认中性灰。", quote: "默认中性灰。", evidenceIds: [ref.id], meaning: { text: "默认中性灰。", verdict: "unsupported" as const, checkedAt: 1 } }] };
  expect(wikiEvidencePoints(section, [ref], true)[0].attention).toBeUndefined();
});

it("repairs a literal negation from one retained source and flags explicitly deferred scope items",()=>{
  const session=projectSession(),text="首版支持向量检索。",quote="首版不支持向量检索。";
  const ref={...session.evidence[0],excerpt:quote,sourceSignature:"original"};
  const section={...session.sections[0],body:text,claims:[{text,quote,evidenceIds:[ref.id],holder:"open" as const}]};
  session.evidence=[ref];
  const fixed=restoreWikiSourceNegation(section,session);
  expect(fixed.body).toBe(quote);
  expect(wikiEvidencePoints(fixed,[ref],true).some(needsConfirmation)).toBe(false);
  const alreadyRestricted = { ...section, body: `不要${text}` };
  expect(restoreWikiSourceNegation(alreadyRestricted,session).body).toBe(alreadyRestricted.body);
  expect(restoreWikiSourceNegation({...section,userEdited:true},session).body).toBe(text);
  expect(restoreWikiSourceNegation(section,{...session,sourceSignatures:{[ref.conversationId]:{[ref.messageId]:"changed"}}}).body).toBe(text);
  const ambiguous={...section,body:"首版涵盖计时控制、后台运行、网站屏蔽。",claims:[{...section.claims[0],text:"首版涵盖计时控制、后台运行、网站屏蔽。",quote:"| 网站屏蔽 | V2 |"}]};
  expect(wikiEvidencePoints(ambiguous,[{...ref,excerpt:ambiguous.claims[0].quote}],true).some(needsConfirmation)).toBe(true);
});
