import { expect, it, vi } from "vitest";
import type { AtlasAI } from "./atlas-ai";
import type { StructuredAIRequest } from "./provider";
import type { ConversationMessage } from "../shared/types";
import { projectSession } from "../test/project-fixture";
import { sourceMessageSignature } from "../shared/source-signature";
import { importantWikiStatements, uncoveredWikiStatements } from "./wiki-coverage";
import { verifyWikiDraft } from "./wiki-verification";

function fixture(body = "检索已完成。", original = body) {
  const session = projectSession();
  const message: ConversationMessage = { id: "raw", conversationId: "source", messageIndex: 0, role: "user", content: original, preview: "", contentHash: "", createdAt: 1, updatedAt: 1 };
  session.evidence = [{ id: "e", conversationId: "source", messageId: "raw", title: "讨论", excerpt: original, sourceSignature: sourceMessageSignature(original) }];
  session.sections = [{ id: "wiki", title: "检索", body, kind: "finding", transition: "", evidenceIds: ["e"] }];
  return { session, message };
}
function reviewer(anchors?: (input: { statements: Array<{ id: string; text: string }> }) => unknown) {
  return { modelId: "fixture", synthesize: vi.fn(async (request: StructuredAIRequest<unknown>) => {
    const input = JSON.parse(request.prompt);
    if (input.presentation === "wiki_missing_anchors") return request.validate(anchors?.(input) ?? { anchors: input.statements.map((statement: { id: string }) => ({ id: statement.id, quote: "", evidenceIds: [] })) });
    return request.validate({ checks: input.facts.map((fact: { key: string }) => ({ key: fact.key, verdict: "supported" })) });
  }) } as unknown as AtlasAI;
}

it("finds a second unsupported assertion instead of accepting a supported clause for the whole sentence", () => {
  const { session } = fixture("已采用本地搜索，已经完成发布。");
  session.sections[0].claims = [{ text: "已采用本地搜索", quote: "已采用本地搜索", evidenceIds: ["e"] }];
  expect(uncoveredWikiStatements(session.sections[0])).toEqual(["已采用本地搜索，已经完成发布。"]);
});
it("does not use an anchored 1.5 percent condition to cover a different 15 percent condition", () => {
  const { session } = fixture("成功率必须超过 15%。");
  session.sections[0].claims = [{text:"成功率必须超过 1.5%。",quote:"成功率必须超过 1.5%。",evidenceIds:["e"]}];
  expect(uncoveredWikiStatements(session.sections[0])).toEqual(["成功率必须超过 15%。"]);
});
it("keeps source-like code and empty headings out of prose coverage", () => {
  const { session } = fixture("# 已完成\n\n```ts\nconst completed = true;\n```\n\n普通背景。\n\n必须保留用户修改。");
  expect(importantWikiStatements(session.sections[0])).toEqual(["必须保留用户修改。"]);
});
it("adds a literal missing assertion locally then independently verifies it, without an anchor request", async () => {
  const { session, message } = fixture(), ai = reviewer();
  const result = await verifyWikiDraft(session, [message], ai, new AbortController().signal);
  expect(ai.synthesize).toHaveBeenCalledOnce();
  expect(JSON.parse(vi.mocked(ai.synthesize).mock.calls[0][0].prompt).presentation).toBe("wiki_claim_verification");
  expect(result.sections[0].claims?.[0]).toMatchObject({ text: message.content, verification: "supported" });
  expect(result.sections[0].evidenceReview).toMatchObject({ status: "verified", coverage: { version: 1, uncoveredStatements: 0 } });
  expect(session.sections[0].claims).toBeUndefined();
});
it("binds paraphrased prose to literal sources but requires independent interpretation review", async () => {
  const { session, message } = fixture("检索已完成。", "用户报告：我做完了检索，还没有运行测试。");
  const ai = reviewer(input => ({ anchors: input.statements.map(statement => ({ id: statement.id, quote: message.content, evidenceIds: ["e"], overviewRole: "progress", workStatus: "reported" })) }));
  const result = await verifyWikiDraft(session, [message], ai, new AbortController().signal);
  expect(ai.synthesize).toHaveBeenCalledTimes(2);
  expect(result.sections[0].claims?.[0]).toMatchObject({ quote: message.content, workStatus: "reported", verification: "supported" });
  expect(result.sections[0].body).toBe(session.sections[0].body);
});
it.each(["missing", "forged", "timeout"])("retains an explicit draft instead of certifying %s original evidence", async kind => {
  const { session, message } = fixture("已完成上线。", "建议以后上线。");
  const ai = reviewer(input => ({ anchors: input.statements.map(statement => ({ id: statement.id, quote: "伪造的完成报告", evidenceIds: ["e"] })) }));
  if (kind === "missing") { const empty = reviewer(); ai.synthesize = empty.synthesize; }
  if (kind === "timeout") vi.mocked(ai.synthesize).mockRejectedValue(new Error("timeout"));
  const result = await verifyWikiDraft(session, [message], ai, new AbortController().signal);
  expect(result.sections[0].body).toBe(session.sections[0].body);
  expect(result.sections[0].evidenceReview?.status).toBe("partial");
  expect(result.sections[0].reviewIssue).toBeTruthy();
  expect(result.sections[0].claims?.some(claim => claim.verification === "supported")).not.toBe(true);
});
it("reuses only a coverage receipt for the same prose, claims and original source version", async () => {
  const { session, message } = fixture(), ai = reviewer();
  const first = await verifyWikiDraft(session, [message], ai, new AbortController().signal);
  await verifyWikiDraft(first, [message], ai, new AbortController().signal);
  expect(ai.synthesize).toHaveBeenCalledOnce();
  first.sections[0].body += " 已经完成发布。";
  const changed = await verifyWikiDraft(first, [message], ai, new AbortController().signal);
  expect(changed.sections[0].evidenceReview?.status).toBe("partial");
  expect(changed.sections[0].reviewIssue).toBeTruthy();
});
it("does not reuse an original anchor after its source changes", async () => {
  const { session, message } = fixture(), ai = reviewer();
  const result = await verifyWikiDraft(session, [{ ...message, content: "原文已修正。" }], ai, new AbortController().signal);
  expect(ai.synthesize).not.toHaveBeenCalled();
  expect(result.sections[0].evidenceReview?.status).toBe("partial");
});
it("invalidates a completed receipt when the user excludes its original message from scope", async () => {
  const { session, message } = fixture(), ai = reviewer();
  const first = await verifyWikiDraft(session, [message], ai, new AbortController().signal);
  first.scope = {kind:"goal",blocks:[]};
  const changed = await verifyWikiDraft(first, [message], ai, new AbortController().signal);
  expect(changed.sections[0].evidenceReview?.status).toBe("partial");
  expect(ai.synthesize).toHaveBeenCalledOnce();
});
it("bounds local additions and model anchors and leaves excess important prose visibly incomplete", async () => {
  const { session, message } = fixture(Array.from({ length: 30 }, (_, index) => `功能${index}已完成。`).join("\n")), ai = reviewer();
  const result = await verifyWikiDraft(session, [message], ai, new AbortController().signal);
  expect(result.sections[0].claims).toHaveLength(24);
  expect(result.sections[0].evidenceReview?.coverage?.uncoveredStatements).toBe(6);
  expect(result.sections[0].evidenceReview?.status).toBe("partial");
  expect(ai.synthesize).toHaveBeenCalledTimes(2);
  const resumed = await verifyWikiDraft(result, [message], ai, new AbortController().signal);
  expect(resumed.sections[0].claims).toHaveLength(30);
  expect(resumed.sections[0].evidenceReview).toMatchObject({status:"verified",coverage:{uncoveredStatements:0}});
  expect(ai.synthesize).toHaveBeenCalledTimes(3);
  expect(JSON.parse(vi.mocked(ai.synthesize).mock.calls[2][0].prompt).facts).toHaveLength(6);
});
it("does not audit or overwrite a personal page, or make requests after cancellation", async () => {
  const { session, message } = fixture(); session.sections[0].userEdited = true;
  const ai = reviewer(), result = await verifyWikiDraft(session, [message], ai, new AbortController().signal);
  expect(result.sections[0]).toBe(session.sections[0]); expect(ai.synthesize).not.toHaveBeenCalled();
  session.sections[0].userEdited = false;
  const abort = new AbortController(); abort.abort();
  await expect(verifyWikiDraft(session, [message], ai, abort.signal)).rejects.toThrow();
  expect(ai.synthesize).not.toHaveBeenCalled();
});
it("keeps completed independent groups when a later group fails, then retries only that remaining group", async () => {
  const {session,message} = fixture(Array.from({length:24},(_,index)=>`功能${index}已完成。`).join("\n")), ai=reviewer();
  vi.mocked(ai.synthesize).mockImplementationOnce(async request=>request.validate({checks:JSON.parse(request.prompt).facts.map((fact:{key:string})=>({key:fact.key,verdict:"supported"}))}));
  vi.mocked(ai.synthesize).mockRejectedValueOnce(new Error("timeout"));
  const partial=await verifyWikiDraft(session,[message],ai,new AbortController().signal);
  expect(partial.sections[0].claims?.filter(claim=>claim.verification==="supported")).toHaveLength(12);
  expect(partial.sections[0].evidenceReview?.status).toBe("partial");
  const resumed=await verifyWikiDraft(partial,[message],ai,new AbortController().signal);
  expect(resumed.sections[0].evidenceReview?.status).toBe("verified");
  expect(ai.synthesize).toHaveBeenCalledTimes(3);
  const keys=JSON.parse(vi.mocked(ai.synthesize).mock.calls[2][0].prompt).facts.map((fact:{key:string})=>fact.key);
  expect(keys).toEqual(Array.from({length:12},(_,index)=>`wiki:${index+12}`));
});
