import { expect, it } from "vitest";
import { comparedProducts, discussedProjects, droppedExceptions, movedCodes, extractWikiKnowledge, fittingQuote, ownNamesTaggedAsOthers, wikiUnitBatches, wikiUnitRequest, droppedFigures } from "./wiki-knowledge-units";
import { projectProofBlocks } from "../shared/atlas/project-knowledge.js";
import { pastedUserText, quotedDetails, type WikiKnowledgeUnit } from "../shared/wiki-knowledge";
import type { CoverageMaterial } from "./focus-coverage";
import type { StructuredAIRequest } from "./provider";

const material = (index: number, role: "user" | "assistant", body: string, conversationId = "c1"): CoverageMaterial => ({ id: `e:${conversationId}:${index}:1`, role, conversationId, sourceConversationIds: [conversationId], title: "讨论", messageId: `m${index}`, messageIndex: index, text: `${role}: ${body}`, rawEvidenceIds: [`e:${conversationId}:${index}:1`] });
const signal = new AbortController().signal;
const proposal = "我建议第一版用 Orama 做全文索引，每 30 秒增量更新一次。";
const reply = (batch: CoverageMaterial[], all: CoverageMaterial[], value: unknown) => wikiUnitRequest(batch, all, "zh-CN", signal, material => pastedUserText(material.text)).validate(value);
const unit = (extra: Record<string, unknown>) => ({ subject: "全文索引", statement: "全文索引使用 Orama，每 30 秒增量更新。", kind: "decision", details: ["30 秒"], quoteKey: "p1:1", adoption: "proposal", delivery: "unknown", ...extra });

it("accepts an adoption only from a later, unpasted user reply to that single proposal", () => {
  const all = [material(0, "assistant", proposal), material(1, "user", "好，就这样。")];
  // The reply lies outside the batch; it is attached as read-only context.
  const adopted = reply([all[0]], all, { units: [unit({ adoption: "user_adopted", confirmationQuoteKey: "c1:1" })] });
  expect(adopted.units[0].adoption).toEqual({ status: "user_adopted", approval: { evidenceId: all[1].id, messageId: "m1", quote: "好，就这样。" } });
  expect(adopted.units[0].details).toEqual(["30 秒"]);
  // Two enumerated options: a bare "好" cannot say which one was accepted.
  const options = [material(0, "assistant", `方案一：用 Orama 做全文索引。\n方案二：用 SQLite FTS。\n${proposal}`), material(1, "user", "好")];
  const ambiguous = reply([options[0]], options, { units: [unit({ adoption: "user_adopted", confirmationQuoteKey: "c1:1" })] });
  expect(ambiguous.units[0].adoption.status).toBe("proposal");expect(ambiguous.rejected.adoption_downgraded).toBe(1);
});

it("never takes a decision from assistant text or pasted material, but lets pasted reports state delivery", () => {
  const pasted = `审查发现，现有消息搜索仍是逐条匹配；仓库虽然已安装 Orama。\n${"- 兼容方案一行说明，保留原有索引与派生数据库。\n".repeat(30)}`;
  const all = [material(0, "assistant", proposal), material(1, "user", pasted)];
  expect(pastedUserText(pasted)).toBe(true);
  // Short pastes: a review marker, or another AI's Markdown answer; typed chat stays the user's own.
  expect(pastedUserText("审查发现，现有消息搜索仍是逐条匹配。同时用 Orama 足够了吗")).toBe(true);
  expect(pastedUserText("目前是 **A：每条消息单独存储**。IndexedDB 的 `messages` 表按消息 `id` 保存，用 `conversationId` 关联对话，并通过索引读取，这也便于侧边栏收藏、定位和复用具体消息。")).toBe(true);
  expect(pastedUserText("直接把聊天记录复制给 ChatGPT 让它总结不就行了吗？可是复制很麻烦，尤其是想要分析一整个对话，同时我的项目还有个功能就是所有AI的管家，用户只需要在输入区输入就能立刻帮他找到不同AI的聊天")).toBe(false);
  const result = reply(all, all, { units: [
    unit({ adoption: "user_decision" }),
    { ...unit({ adoption: "user_decision", delivery: "user_reported", quoteKey: "p2:1", details: [] }), statement: "仓库已安装 Orama。", kind: "report" },
  ] });
  expect(result.units.map(item => [item.adoption.status, item.delivery, item.evidence.pasted])).toEqual([["proposal", "unknown", false], ["unknown", "user_reported", true]]);
  expect(result.rejected.adoption_downgraded).toBe(2);
});

it("keeps a user's own unpasted statement as a decision and rejects invented quotes, details and context citations", () => {
  const all = [material(0, "user", "我的项目还有个功能就是所有 AI 的管家，在输入区输入就能找到不同 AI 的聊天。"), material(1, "assistant", proposal), material(2, "user", "嗯")];
  const result = reply(all.slice(0, 2), all, { units: [
    { subject: "对话管家", statement: "产品提供所有 AI 对话管家。", kind: "decision", details: ["输入区", "语音输入"], quoteKey: "p1:1", adoption: "user_decision" },
    unit({ quoteKey: "p9:1" }),
    unit({ quoteKey: "c1:1" }),
  ] });
  expect(result.units).toHaveLength(1);
  expect(result.units[0]).toMatchObject({ subject: "对话管家", adoption: { status: "user_decision" }, details: ["输入区"], evidence: { role: "user", messageId: "m0" } });
  expect(result.rejected).toMatchObject({ quote: 2, detail_not_in_source: 1 });
  expect(result.rejectedSamples.map(sample => sample.reason)).toEqual(["detail_not_in_source", "quote", "quote"]);
  expect(result.rejectedSamples[1].keys).toContain("p9:1");
});

it("reads labels written with brackets, as ranges or under the old approval name, and never lets a question decide", () => {
  const long = `${"我建议第一版先做浏览器扩展，导入后立刻能搜索。".repeat(12)}
${"Orama 负责全文索引，每 30 秒增量更新一次。".repeat(12)}`;
  const all = [material(0, "assistant", long), material(1, "user", "好，就这样。"), material(2, "user", "首页中间的对话区要不要用来分析哪些对话值得做项目？")];
  const result = reply(all.slice(0, 1).concat(all[2]), all, { units: [
    unit({ quoteKeys: ["[p1:1]", "p1:2", "p1:3"], details: [], adoption: "user_adopted", approvalQuoteKey: "[c1:1]" }),
    unit({ subject: "首页", quoteKey: "p1:2-4", details: [] }),
    { subject: "首页对话区", statement: "首页中间对话区的用途待定。", kind: "question", quoteKey: "p2:1", adoption: "user_decision" },
    // Several labels in one string, a range into another passage, block 0, an unlisted kind.
    unit({ subject: "增量", quoteKeys: ["p1:2,p1:3"], details: [] }),
    unit({ subject: "索引", quoteKey: "p1:2-p2:1", details: [] }),
    unit({ subject: "扩展", quoteKey: "p1:0", details: [], kind: "requirement" }),
  ] });
  expect(result.units.map(item => item.adoption.status)).toEqual(["user_adopted", "proposal", "unknown", "proposal", "proposal", "proposal"]);
  expect(result.units.at(-1)).toMatchObject({ kind: "fact", evidence: { messageId: "m0" } });
  // Two adjacent ranges at most, within one quote.
  expect(result.units[0].evidence.quote.length).toBeLessThanOrEqual(350);
  expect(result.rejected.quote).toBeUndefined();
});

it("reads details given as one string and adds identifiers and counts the quote states", () => {
  const all = [material(0, "assistant", "每条消息保存 `contentHash`，首轮邀请 10 个真实用户，每 30 秒增量更新。")];
  const result = reply(all, all, { units: [unit({ details: "30 秒，增量", statement: "索引每 30 秒增量更新。" })] });
  // Code the quote states is kept; its loose counts ("10 个") are not stored as details.
  expect(result.units[0].details).toEqual(["30 秒", "增量", "contentHash"]);
  // Rendering markup beside the knowledge is layout, never a detail.
  expect(quotedDetails('<caption textAlign="center" maxWidth={120px}>示意</caption> 官网首屏只放 3 个入口，支持 10,000 条消息。', "官网")).toEqual(["3 个", "10,000 条"]);
});

it("decides only from deciding kinds and drops requests made to the assistant", () => {
  const all = [material(0, "user", "我觉得原生的 compaction 对用户就是黑箱。我决定首页只放搜索入口。给我一个给 codex 的提示词。")];
  const result = reply(all, all, { units: [
    { subject: "Compaction", statement: "原生 Compaction 对用户是黑箱。", kind: "fact", quoteKey: "p1:1", adoption: "user_decision" },
    { subject: "首页", statement: "首页只放搜索入口。", kind: "decision", quoteKey: "p1:1", adoption: "user_decision" },
    { subject: "Codex", statement: "用户要求为 Codex 生成一个提示词。", kind: "decision", quoteKey: "p1:1", adoption: "user_decision" },
  ] });
  expect(result.units.map(item => [item.subject, item.adoption.status])).toEqual([["Compaction", "unknown"], ["首页", "user_decision"]]);
  expect(result.rejected).toMatchObject({ adoption_downgraded: 1, assistant_request: 1 });
});

it("gives a unit the same ID whatever its wording, and batches materials by size", () => {
  const all = [material(0, "assistant", proposal)];
  const first = reply(all, all, { units: [unit({})] }), second = reply(all, all, { units: [unit({ statement: "索引选用 Orama。" })] });
  expect(first.units[0].id).toBe(second.units[0].id);
  const long = Array.from({ length: 7 }, (_, index) => material(index, "assistant", "长".repeat(4000)));
  expect(wikiUnitBatches(long).map(batch => batch.length)).toEqual([2, 2, 2, 1]);
});

it("records a failed batch without failing the ledger and reports coverage", async () => {
  const all = Array.from({ length: 4 }, (_, index) => material(index, "assistant", `${proposal}${"细节".repeat(2900)}`));
  let calls = 0;
  const ai = { generateStructured: async <T,>(request: StructuredAIRequest<T>): Promise<T> => {
    // The provider stays down after the first batch: the second fails whole and as halves.
    if (++calls >= 2) throw new Error("provider down");
    const passages = JSON.parse(request.prompt).passages as Array<{ id: string; context?: boolean }>;
    return request.validate({ units: passages.filter(passage => !passage.context).map(passage => unit({ quoteKey: `${passage.id}:1`, details: [] })) });
  } };
  const { ledger, report } = await extractWikiKnowledge({ materials: all, locale: "zh-CN", signal, ai });
  expect(ledger.status).toBe("partial");
  expect(ledger.batches.map(batch => batch.status)).toEqual(["ok", "failed"]);
  expect(report).toMatchObject({ requests: 2, failed: 1, materials: 4, coveredMaterials: 2 });
});

it("rereads only the batches whose material changed when a conversation continues", async () => {
  // Two conversations of three long messages each: three batches per conversation, never shared.
  const long = (index: number, conversationId: string) => material(index, index % 2 ? "user" : "assistant", `${proposal}${"细节".repeat(2900)}`, conversationId);
  const first = [0, 1, 2].map(index => long(index, "c1")), second = [0, 1, 2].map(index => long(index, "c2"));
  let calls = 0;
  const ai = { generateStructured: async <T,>(request: StructuredAIRequest<T>): Promise<T> => {
    calls++;
    const passages = JSON.parse(request.prompt).passages as Array<{ id: string; context?: boolean }>;
    return request.validate({ units: passages.filter(passage => !passage.context).map(passage => unit({ quoteKey: `${passage.id}:1`, details: [] })) });
  } };
  const before = await extractWikiKnowledge({ materials: [...first, ...second], locale: "zh-CN", signal, ai });
  expect(before.ledger.batches.map(batch => batch.sourceIds.map(id => id.split(":")[1]))).toEqual([["c1", "c1"], ["c1"], ["c2", "c2"], ["c2"]]);
  expect(calls).toBe(4);
  // The user replies in c1: c1's last batch gains the reply; everything else is reused.
  calls = 0;
  const answered = { ...before.ledger, scopeAnswers: { chatatlas: "exclude" as const }, sameGroups: ["g1"], separateGroups: ["g2"] };
  const after = await extractWikiKnowledge({ materials: [...first, long(3, "c1"), ...second], locale: "zh-CN", signal, ai, previous: answered });
  expect(calls).toBe(1);
  // The user's answers on other projects and repeated points survive the rerun.
  expect(after.ledger).toMatchObject({ scopeAnswers: { chatatlas: "exclude" }, sameGroups: ["g1"], separateGroups: ["g2"] });
  expect(after.report).toMatchObject({ requests: 1, reused: 3 });
  expect(after.ledger.batches[0].units).toEqual(before.ledger.batches[0].units);
  // A ledger saved before signatures existed is reused when its quotes still stand.
  calls = 0;
  const legacy = { ...before.ledger, batches: before.ledger.batches.map(batch => ({ ...batch, signature: undefined })) };
  await extractWikiKnowledge({ materials: [...first, ...second], locale: "zh-CN", signal, ai, previous: legacy });
  expect(calls).toBe(0);
  // An edited message is read again.
  const edited = [material(0, "assistant", `改为 SQLite FTS。${"细节".repeat(2900)}`, "c1"), ...first.slice(1)];
  calls = 0;
  await extractWikiKnowledge({ materials: [...edited, ...second], locale: "zh-CN", signal, ai, previous: before.ledger });
  expect(calls).toBe(1);
});

it("records what a unit is about when it is not this project, and never takes it as this project's decision", () => {
  const all = [material(0, "user", "我决定硬件平台用 Hardware IR 作为统一数据来源。"), material(1, "assistant", "Personal AI Memory 的最后 Release 为 v0.0.5。")];
  const ask = (batch: CoverageMaterial[], value: unknown) => wikiUnitRequest(batch, all, "zh-CN", signal, material => pastedUserText(material.text), "Atlas").validate(value);
  const hardware = ask([all[0]], { units: [unit({ statement: "硬件平台以 Hardware IR 为统一数据来源。", adoption: "user_decision", details: [], about: { name: "AI Circuit Studio", role: "other_project" } })] });
  expect(hardware.units[0]).toMatchObject({ about: { name: "AI Circuit Studio", role: "other_project" }, adoption: { status: "unknown" } });
  const competitor = ask([all[1]], { units: [unit({ statement: "最后 Release 为 v0.0.5。", kind: "fact", details: [], about: { name: "Personal AI Memory", role: "competitor" } })] });
  expect(competitor.units[0].about).toEqual({ name: "Personal AI Memory", role: "competitor" });
  // The project's own name, or an unknown role, means no about.
  const own = ask([all[1]], { units: [unit({ statement: "Atlas 本地优先。", kind: "fact", details: [], about: { name: "atlas", role: "competitor" } }), unit({ subject: "密钥", statement: "Atlas 支持 BYOK。", kind: "fact", details: [], about: { name: "X", role: "friend" } })] });
  expect(own.units.map(item => item.about)).toEqual([undefined, undefined]);
  // The document's name is checked locally, never sent: a renamed document asks the same requests and reuses their answers.
  expect(JSON.parse(wikiUnitRequest([all[1]], all, "zh-CN", signal, () => false, "Atlas").prompt).project).toBeUndefined();
  expect(wikiUnitRequest([all[1]], all, "zh-CN", signal, () => false, "Atlas").prompt).toBe(wikiUnitRequest([all[1]], all, "zh-CN", signal, () => false, "AI 硬件画布").prompt);
});

it("reports progress batch by batch, reused batches included", async () => {
  const long = (index: number) => material(index, index % 2 ? "user" : "assistant", `${proposal}${"细节".repeat(2900)}`);
  const ai = { generateStructured: async <T,>(request: StructuredAIRequest<T>): Promise<T> => request.validate({ units: [] }) };
  const seen: string[] = [];
  const first = await extractWikiKnowledge({ materials: [0, 1, 2].map(long), locale: "zh-CN", signal, ai, progress: step => seen.push(`${step.stage}:${step.done}/${step.total}`) });
  expect(seen).toEqual(["extract:0/2", "extract:1/2", "extract:2/2"]);
  seen.length = 0;
  await extractWikiKnowledge({ materials: [0, 1, 2].map(long), locale: "zh-CN", signal, ai, previous: first.ledger, progress: step => seen.push(`${step.done}/${step.total}`) });
  expect(seen).toEqual(["0/2", "1/2", "2/2"]);
});

it("keeps an intent and a question from one quote, and refuses qualified approvals and refusals without refusal words", () => {
  const all = [material(0, "user", "我打算增加书签功能，是不是可以降低检索成本？")];
  const both = reply(all, all, { units: [unit({ subject: "书签", statement: "增加书签功能。", kind: "plan", details: [], adoption: "unknown" }), unit({ subject: "书签", statement: "书签是否能降低检索成本？", kind: "question", details: [], adoption: "unknown" }), unit({ subject: "书签", statement: "增加书签功能。", kind: "plan", details: [], adoption: "unknown" })] });
  expect(both.units.map(item => item.kind)).toEqual(["plan", "question"]);expect(both.rejected.duplicate).toBe(1);
  expect(new Set(both.units.map(item => item.id)).size).toBe(2);
  const qualified = [material(0, "assistant", proposal), material(1, "user", "好，但不要加书签。")];
  expect(reply([qualified[0]], qualified, { units: [unit({ adoption: "user_adopted", confirmationQuoteKey: "c1:1" })] }).units[0].adoption.status).toBe("proposal");
  const agreed = [material(0, "assistant", proposal), material(1, "user", "好的。")];
  expect(reply([agreed[0]], agreed, { units: [unit({ adoption: "rejected", confirmationQuoteKey: "c1:1" })] }).units[0].adoption.status).toBe("proposal");
  const declined = [material(0, "assistant", proposal), material(1, "user", "算了，不用 Orama。")];
  expect(reply([declined[0]], declined, { units: [unit({ adoption: "rejected", confirmationQuoteKey: "c1:1" })] }).units[0].adoption.status).toBe("rejected");
});

it("keeps a count of a named thing the statement dropped, and ignores generic counts", () => {
  const stars = { ...unit({ subject: "发布", statement: "放弃以 GitHub Stars 数量作为首要目标，先找到真实用户。", details: [] }), details: [] } as unknown as WikiKnowledgeUnit;
  expect(droppedFigures(stars, "在发布之前，不要把「获得 100 颗 Stars」作为第一个目标，先找到 5 个真实用户。")).toEqual(["100 颗 Stars"]);
  // Already stated, or a generic noun after the count: nothing to add.
  expect(droppedFigures({ ...stars, statement: "不要把 100 颗 Stars 作为目标。" }, "不要把「获得 100 颗 Stars」作为第一个目标。")).toEqual([]);
  expect(droppedFigures({ ...stars, statement: "只分析新增的对话。" }, "例如新增 20 条对话时只分析这 20 条对话。")).toEqual([]);
});


it("reads the user's own words that produced no unit once more, and records what still has none", async () => {
  const all = [material(0, "assistant", proposal), material(1, "user", "我打算先做复制上下文以后慢慢加自动记忆读取。"), material(2, "user", "这个全文索引功能现在已经可以正常使用了吗？")];
  const prompts: Array<{ cover?: string[] }> = [];
  const ai = { generateStructured: async <T,>(request: StructuredAIRequest<T>): Promise<T> => { prompts.push(JSON.parse(request.prompt)); return request.validate({ units: [unit({ details: [] })] }); } };
  const result = await extractWikiKnowledge({ materials: all, locale: "zh-CN", signal, ai });
  // A second request for the uncovered intent only; a message that only asks is not counted as uncovered. Its answer
  // states what the batch already has, so the message stays noted.
  expect(prompts).toHaveLength(2);
  expect(prompts[1].cover).toHaveLength(1);
  expect(result.ledger.batches[0].uncovered).toEqual([all[1].id]);
  expect(result.ledger.batches[0].coverChecked).toBe(1);
  expect(result.report).toMatchObject({ requests: 1, coverRetries: 1, uncoveredMessages: 1 });
  // Read again with the earlier ledger, it is not asked a third time.
  prompts.length = 0;
  await extractWikiKnowledge({ materials: all, locale: "zh-CN", signal, ai, previous: result.ledger });
  expect(prompts).toHaveLength(0);
});

it("keeps what the user's uncovered message gives when read again, with the batch it belongs to", async () => {
  const all = [material(0, "assistant", proposal), material(1, "user", "既然是小白，应该首屏就展示一个类似 ChatGPT 的欢迎页面。")];
  const ai = { generateStructured: async <T,>(request: StructuredAIRequest<T>): Promise<T> => { const data = JSON.parse(request.prompt);
    return request.validate(data.cover ? { units: [unit({ subject: "首屏", statement: "首屏展示类似 ChatGPT 的欢迎页。", kind: "decision", details: [], quoteKey: "p1:1", adoption: "user_decision" })] } : { units: [unit({ details: [] })] }); } };
  const result = await extractWikiKnowledge({ materials: all, locale: "zh-CN", signal, ai });
  expect(result.ledger.batches[0].units.map(item => item.statement)).toContain("首屏展示类似 ChatGPT 的欢迎页。");
  expect(result.ledger.batches[0].uncovered).toBeUndefined();
  expect(result.report).toMatchObject({ coverRetries: 1, coverUnits: 1 });
});

it("reads material put to the user last, leaves out what the user skips, and keeps the skips for later updates", async () => {
  const long = (index: number, role: "user" | "assistant" = "assistant") => material(index, role, `${proposal}${"细节".repeat(2900)}`);
  const all = [long(0), long(1, "user"), long(2)];
  const read: string[] = [];
  let skipped = new Set<string>();
  const ai = { generateStructured: async <T,>(request: StructuredAIRequest<T>): Promise<T> => {
    const passages = JSON.parse(request.prompt).passages as Array<{ id: string; context?: boolean; text?: string }>;
    read.push(...passages.filter(passage => !passage.context).map(passage => passage.id));
    // The user answers while the first batch is read: the deferred message is left out.
    skipped = new Set(["c1:m1"]);
    return request.validate({ units: passages.filter(passage => !passage.context).map(passage => unit({ quoteKey: `${passage.id}:1`, details: [] })) });
  } };
  const { ledger, report } = await extractWikiKnowledge({ materials: all, locale: "zh-CN", signal, ai, deferred: item => item.messageId === "m1", skipped: () => skipped, sourceChoices: () => ({ "paste:c1:m1": "skip" }) });
  // Messages 0 and 2 are read together; message 1 is deferred to its own last batch and then skipped.
  expect(read).toHaveLength(2);
  expect(ledger.batches.map(batch => Boolean(batch.skipped))).toEqual([false, true]);
  expect(report).toMatchObject({ requests: 2, skippedMaterials: 1 });
  expect(report.skippedCharacters).toBeGreaterThan(5000);
  expect(ledger).toMatchObject({ skippedMessages: ["c1:m1"], sourceChoices: { "paste:c1:m1": "skip" } });
  // An update without a question leaves the same message out.
  read.length = 0;
  const again = await extractWikiKnowledge({ materials: all, locale: "zh-CN", signal, ai, previous: ledger });
  // Nothing is deferred now: the message is dropped from the batch it falls in.
  expect(again.report.skippedMaterials).toBe(1);expect(read).toHaveLength(2);
  expect(again.ledger.skippedMessages).toEqual(["c1:m1"]);
});

it("takes the block of the message that states a unit when its quote is the example beside it", () => {
  const example = "<box gap={1}>\n <text size=\"xs\">9 月 1 日</text>\n **决定第一阶段使用关键词搜索。**\n</box>";
  const message = `## 七、它有什么缺点？为什么 Atlas 不适合直接照搬？\n\n### 1. Mem0 擅长记忆召回，但 Atlas 需要管理项目的「现行状态」\n\n假设先后发生两次讨论：\n\n${example}\n\n记住多条事实，不等于知道项目当前的真实状态。`;
  const blocks = projectProofBlocks(message).map(block => block.text);
  const statement = "Mem0擅长持续交互中的记忆召回，但不适合直接照搬至Atlas，因为Atlas需要管理项目现行状态。";
  expect(fittingQuote(statement, example, blocks)).toContain("Mem0 擅长记忆召回，但 Atlas 需要管理项目的「现行状态」");
  // A quote that states its unit stays.
  const own = blocks.find(block => block.includes("记住多条事实"))!;
  expect(fittingQuote("记住多条事实不等于知道项目当前的真实状态。", own, blocks)).toBe(own);
  // A quote in another language, with no block stating the unit in its words, stays.
  const english = "Messages are stored in IndexedDB and indexed with Orama.";
  expect(fittingQuote("消息保存在 IndexedDB，并用 Orama 建立全文索引。", english, projectProofBlocks(`${english}\n\nThe sidebar opens on the right.`).map(block => block.text))).toBe(english);
});

it("reads the working steps given to an implementing AI as no project knowledge, and a project rule as knowledge", async () => {
  const { assistantRequest } = await import("../shared/wiki-knowledge");
  expect(assistantRequest("运行 lint, typecheck, test, build 并全部通过，最后汇报新架构、Provider Adapter、Key 存储及下一阶段建议。")).toBe(true);
  expect(assistantRequest("用户需要向 Codex 传达 Milestone 4 的核心价值主张，即通过拍照识别电子模块并自动生成项目。")).toBe(true);
  expect(["先阅读现有代码识别问题，列出发现的问题及涉及的组件，运行现有代码检查测试与构建并说明修改结果。", "生成一份针对新手首页的最终收尾优化提示词，明确禁止重新设计页面。", "检查实际代码，画出简明数据流，找到事实提取的具体位置。", "不要只汇报测试通过，请提供实际 Context Pack 的前后对照。"].every(assistantRequest)).toBe(true);
  expect(["不修改核心 IndexedDB、搜索和导入架构，不删除已有数据。", "侧边栏支持整理为 Prompt 导入当前对话。", "发布前需通过五个真实场景测试。"].some(assistantRequest)).toBe(false);
});

it("tags another product the discussion talks about, with the rest of the message naming it and its restatements", () => {
  let next = 0;
  const said = (statement: string, messageId: string, extra: Partial<WikiKnowledgeUnit> = {}): WikiKnowledgeUnit => ({ id: `u${++next}`, subject: "s", statement, kind: "decision", details: [], evidence: { evidenceId: `e${next}`, conversationId: "c", messageId, messageIndex: next, role: "assistant", pasted: false, quote: statement }, adoption: { status: "proposal" }, delivery: "unknown", ...extra });
  const project = Array.from({ length: 22 }, (_, index) => said(`ESP32 方案第 ${index} 条：Validator 检查 GPIO 冲突。`, `m${index}`));
  const units = [...project,
    said("ChatAtlas 当前能收集项目知识，但缺乏判断最新决定的能力。", "talk"),
    said("下一轮优化应重点升级 ChatAtlas 的项目理解能力。", "talk"),
    said("默认提供简短 Project Brief，点击展开 Wiki，深入查看 Evolution。", "talk"),
    said("V0.1 中 ESP32 暂不做实时比价，只生成缺件清单。", "talk"),
    said("默认提供简短 Project Brief，点击展开 Wiki，再看 Evolution。", "later"),
    said("Validator 拒绝 Catalog 之外的元件。", "m9"),
  ];
  const tagged = discussedProjects(units, "AI电路生成平台");
  // The message's line naming ESP32, which the project names often, stays the project's (u26).
  expect([...tagged.keys()].sort()).toEqual(["u23", "u24", "u25", "u27"]);
  expect(new Set(tagged.values())).toEqual(new Set(["ChatAtlas"]));
  // The project's own name, or a product named in passing, is no other project.
  expect(discussedProjects(units, "ChatAtlas").size).toBe(0);
  expect(discussedProjects([said("使用 Supabase 存储项目。", "a"), said("后续引入 Supabase Auth。", "a")], "硬件").size).toBe(0);
});

it("tags the rest of a message extraction already tagged as about another project, but not a restated point of this one", () => {
  let next = 0;
  const said = (statement: string, messageId: string, extra: Partial<WikiKnowledgeUnit> = {}): WikiKnowledgeUnit => ({ id: `w${++next}`, subject: "s", statement, kind: "decision", details: [], evidence: { evidenceId: `e${next}`, conversationId: "c", messageId, messageIndex: next, role: "assistant", pasted: false, quote: statement }, adoption: { status: "proposal" }, delivery: "unknown", ...extra });
  const atlas = { about: { name: "ChatAtlas", role: "other_project" as const } };
  const project = Array.from({ length: 22 }, (_, index) => said(`Hardware IR 方案第 ${index} 条：Validator 检查 GPIO 冲突。`, `m${index}`));
  const units = [...project,
    said("V0.1 版本暂不开发实时商品比价功能，只输出采购规格与缺件清单。", "docs"),
    said("每条结论至少区分已决定、建议、已报告实现六种状态。", "review", atlas),
    said("文档顶部应优先显示一屏当前状态快照。", "review", atlas),
    said("V0.1 暂不做实时比价，仅生成缺件清单和采购规格。", "review", atlas),
    said("核心价值在于基于原始消息可靠回答项目当前决定，并支持一键追溯依据。", "review", { subject: "ChatAtlas" }),
    said("需识别新决定替代旧决定的关系，避免保留互相冲突的方案。", "review"),
    said("产品主链：自然语言 -> Hardware IR + Validator -> Canvas 可视化工作区。", "review"),
  ];
  const tagged = discussedProjects(units, "AI电路工坊");
  // Its untagged points go with it; the line naming what this project often names stays, and so does this project's
  // own decision that a tagged point restates.
  expect([...tagged.keys()].sort()).toEqual(["w27", "w28"]);
  expect(new Set(tagged.values())).toEqual(new Set(["ChatAtlas"]));
});

it("reads from a message's original text that it is about another product, however its points were worded", () => {
  let next = 0;
  const said = (statement: string, messageId: string): WikiKnowledgeUnit => ({ id: `v${++next}`, subject: "s", statement, kind: "decision", details: [], evidence: { evidenceId: `e${next}`, conversationId: "c", messageId, messageIndex: next, role: "assistant", pasted: false, quote: statement }, adoption: { status: "proposal" }, delivery: "unknown" });
  const units = [...Array.from({ length: 6 }, (_, index) => said(`ESP32 方案第 ${index} 条：Validator 检查 GPIO 冲突。`, `m${index}`)),
    said("系统需识别新决定替代旧决定的关系。", "review"), said("默认提供简短 Project Brief，点击展开 Wiki。", "review")];
  const bodies = new Map([["review", "ChatAtlas 当前能收集项目知识。针对 ChatAtlas 生成的综述，下一轮应升级 ChatAtlas 的项目理解能力。"]]);
  // No point names it; the message's own text talks about ChatAtlas three times.
  expect(discussedProjects(units, "AI电路生成平台").size).toBe(0);
  expect([...discussedProjects(units, "AI电路生成平台", bodies).values()]).toEqual(["ChatAtlas", "ChatAtlas"]);
  // A name in passing, or one extraction already tagged as a reference, is not.
  expect(discussedProjects(units, "AI电路生成平台", new Map([["review", "ChatAtlas 很好。ChatAtlas 也行。ChatAtlas。"]])).size).toBe(0);
});

it("reads the user's own statement of how it should be, typed a question, as their plan and decision", async () => {
  const said = "怎么跟codex说我记得之前没有这个流程感觉对小白不友好，既然是小白应该首屏就展示一个类似chatgpt的欢迎页面";
  const all = [material(0, "user", said), material(1, "user", "这个功能怎么实现比较好？")];
  const ai = { generateStructured: async <T,>(request: StructuredAIRequest<T>): Promise<T> => request.validate({ units: [
    unit({ quoteKey: "p1:1", kind: "question", adoption: "unknown", details: [], statement: "首屏应为类似 ChatGPT 的欢迎页，引导用户输入需求。" }),
    unit({ quoteKey: "p2:1", kind: "question", adoption: "unknown", details: [], statement: "这个功能怎么实现比较好？" }),
  ] }) };
  const { ledger, report } = await extractWikiKnowledge({ materials: all, locale: "zh-CN", signal, ai });
  const units = ledger.batches.flatMap(batch => batch.units);
  expect(units.map(item => [item.kind, item.adoption.status])).toEqual([["plan", "user_decision"], ["question", "unknown"]]);
  expect(report).toMatchObject({ questionsReadAsPlans: 1 });
});

it("finds the project's own name tagged as another product", () => {
  let next = 0;
  const said = (statement: string, about?: WikiKnowledgeUnit["about"]): WikiKnowledgeUnit => ({ id: `w${++next}`, subject: "s", statement, kind: "decision", details: [], evidence: { evidenceId: `e${next}`, conversationId: "c", messageId: `m${next}`, messageIndex: next, role: "assistant", pasted: false, quote: statement }, adoption: { status: "proposal" }, delivery: "unknown", ...(about ? { about } : {}) });
  const units = [
    said("项目定位为“AI Circuit Studio”，即面向大学生和硬件小白的 AI 硬件生成平台。"), said("AI Circuit Studio 是面向初学者的自然语言硬件设计工作台。"),
    said("聚焦 ESP32 低压模块，不竞争专业 EDA。", { name: "AI Circuit Studio", role: "reference" }),
    said("Boardly 已实现从自然语言到 PCB 的自动化。", { name: "Boardly", role: "competitor" }), said("Boardly 主要面向专业工程师。"), said("Boardly 的 PCB 自动化成熟。"),
  ];
  expect([...ownNamesTaggedAsOthers(units)]).toEqual(["AI Circuit Studio"]);
});

it("reads a batch that failed whole as two halves, keeping every half's units", async () => {
  const materials = [0, 1, 2, 3].map(index => material(index, index % 2 ? "user" : "assistant", `${proposal}第 ${index} 条。`));
  let calls = 0;
  const ai = { generateStructured: async <T,>(request: StructuredAIRequest<T>): Promise<T> => {
    calls++;
    const passages = (JSON.parse(request.prompt).passages as Array<{ id: string; context?: boolean }>).filter(passage => !passage.context);
    // The whole batch is over the input budget; each half fits.
    if (passages.length > 2) throw new Error("AI task exceeds its input budget (15358/14000 estimated tokens).");
    return request.validate({ units: passages.map(passage => unit({ quoteKey: `${passage.id}:1` })) });
  } };
  const { ledger, report } = await extractWikiKnowledge({ materials, locale: "zh-CN", signal, ai });
  expect(calls).toBe(3);
  expect(ledger.batches).toHaveLength(1);
  expect(ledger.batches[0]).toMatchObject({ status: "ok" });
  expect(ledger.batches[0].units.map(item => item.evidence.evidenceId)).toEqual(materials.map(item => item.id));
  expect(report.splitRetries).toBe(1);
});

it("reads a passage comparing other products once more, for each product it names, and tags what the first read left untagged", async () => {
  const compare = "竞品对比：Boardly 面向专业工程师，覆盖从需求到 PCB 仿真；WireMind 自动生成原理图。参考项目 Fritzing 降低了面包板理解门槛。我们应借鉴 Fritzing，避开与 Boardly 竞争。";
  expect(comparedProducts(compare)).toEqual(expect.arrayContaining(["Boardly", "WireMind", "Fritzing"]));
  // A stack named without comparing anything is no comparison.
  expect(comparedProducts("前端用 React Flow 和 Zustand，后端用 Next.js。")).toEqual([]);
  const all = [material(0, "assistant", compare)];
  const prompts: Array<Record<string, unknown>> = [];
  const ai = { generateStructured: async <T,>(request: StructuredAIRequest<T>): Promise<T> => {
    const data = JSON.parse(request.prompt); prompts.push(data);
    return request.validate(data.products ? { units: [
      unit({ subject: "Boardly", statement: "Boardly 面向专业工程师，覆盖从需求到 PCB 仿真。", kind: "fact", details: [], about: { name: "Boardly", role: "competitor" } }),
      unit({ subject: "WireMind", statement: "WireMind 自动生成原理图。", kind: "fact", details: [], about: { name: "WireMind", role: "competitor" } }),
      unit({ subject: "Fritzing", statement: "借鉴 Fritzing 降低面包板理解门槛的做法。", kind: "fact", details: [], about: { name: "Fritzing", role: "reference" } }),
    ] } : { units: [unit({ subject: "竞品", statement: "借鉴 Fritzing 降低面包板理解门槛的做法。", kind: "fact", details: [] })] });
  } };
  const { ledger, report } = await extractWikiKnowledge({ materials: all, locale: "zh-CN", signal, ai });
  // One more request, naming the products; the first read stays as it was.
  expect(prompts).toHaveLength(2);
  expect(prompts[0].products).toBeUndefined();
  expect((prompts[1].products as Array<{ names: string[] }>)[0].names).toEqual(expect.arrayContaining(["Boardly", "WireMind", "Fritzing"]));
  const units = ledger.batches[0].units;
  expect(units.map(item => item.about?.name)).toEqual(["Fritzing", "Boardly", "WireMind"]);
  expect(report).toMatchObject({ productRequests: 1, productUnits: 2, productTagged: 1 });
  expect(ledger.batches[0].productsChecked).toBe(1);
  // Read again with the earlier ledger, the batch is not asked about its products a second time.
  prompts.length = 0;
  await extractWikiKnowledge({ materials: all, locale: "zh-CN", signal, ai, previous: ledger });
  expect(prompts).toHaveLength(0);
});

it("gives back an exception the message adds right after a rule, and none to a rule it does not limit", () => {
  const message = "Header 高度：约 56~64px。\n\n左侧：极简 Logo / Product name\n\n右侧最多：继续项目、Theme、Settings。不要超过 3 个高权重 action。\n\n不要显示：\n\nProvider connection status\n\n除非用户正在进行需要 Provider 的任务。\n\n颜色保持中性。";
  const header = { ...unit({ subject: "顶部导航", statement: "高度约56~64px，左侧为Logo/Product name，右侧最多3个高权重action（继续项目/Theme/Settings），默认不显示Provider连接状态。", kind: "constraint", details: [] }), id: "u1", adoption: { status: "proposal" as const }, delivery: "unknown" as const, evidence: { evidenceId: "e", conversationId: "c", messageId: "m", messageIndex: 1, role: "assistant" as const, pasted: false, quote: "" } } as unknown as WikiKnowledgeUnit;
  expect(droppedExceptions(header, message)).toEqual(["除非用户正在进行需要 Provider 的任务。"]);
  // Already kept, or a rule that forbids nothing: nothing added.
  expect(droppedExceptions({ ...header, details: ["除非用户正在进行需要 Provider 的任务。"] }, message)).toEqual([]);
  expect(droppedExceptions({ ...header, statement: "颜色保持中性，整体风格克制。" }, message)).toEqual([]);
});

it("takes the rest of a message whose points are mostly another project's, keeping what this project names", () => {
  let next = 0;
  const said = (statement: string, messageId: string, extra: Partial<WikiKnowledgeUnit> = {}): WikiKnowledgeUnit => ({ id: `h${++next}`, subject: "s", statement, kind: "plan", details: [], evidence: { evidenceId: `e${next}`, conversationId: "c", messageId, messageIndex: messageId === "review" ? 111 : messageId === "again" ? 112 : next, role: "assistant", pasted: false, quote: statement }, adoption: { status: "proposal" }, delivery: "unknown", ...extra });
  const own = Array.from({ length: 22 }, (_, index) => said(`Hardware IR 方案第 ${index} 条：Validator 检查 GPIO 冲突。`, `m${index}`));
  const atlas = { about: { name: "ChatAtlas", role: "other_project" as const } };
  const review = [said("每条结论至少区分已决定、建议、已报告实现、已核验实现六种状态。", "review", atlas), said("文档顶部应显示包含定位、确认能力和下一步任务的一屏快照。", "review", atlas), said("关键事实仅引用一到三条直接证据，点击定位到具体消息。", "review", atlas)];
  const again = [said("每条结论必须明确区分已决定、建议、已报告实现、已核验实现六种状态。", "again"), said("文档顶部应显示包含当前定位、确认能力和下一步任务的一屏快照。", "again"), said("关键事实仅引用一至三条直接证据，支持点击定位到具体消息。", "again"),
    said("第一阶段目标：当前决定识别准确率不低于九成。", "again"), said("产品主链：自然语言 -> Hardware IR + Validator -> Canvas。", "again")];
  const tagged = discussedProjects([...own, ...review, ...again], "AI电路工坊", new Map(), { seededOnly: true, projects: new Set(["chatatlas"]) });
  // Three told again, so the message is about it: the target goes too; the line naming Hardware IR stays.
  expect(again.filter(item => tagged.has(item.id)).map(item => item.statement)).toEqual(again.slice(0, 4).map(item => item.statement));
});

it("moves a code given on the wrong point of its message to the point its line is about", () => {
  const message = "仿真入口仅在 Canvas 设计通过后才出现。\n\nGPIO 不能直接驱动 DC Fan、Motor、Pump 等负载，必须通过驱动器模块，否则报 LOAD_REQUIRES_DRIVER ERROR。";
  const at = (index: number, statement: string, details: string[]): WikiKnowledgeUnit => ({ id: `c${index}`, subject: "s", statement, kind: "constraint", details, evidence: { evidenceId: "e", conversationId: "c", messageId: "m", messageIndex: 1, role: "assistant", pasted: false, quote: "" }, adoption: { status: "proposal" }, delivery: "unknown" });
  const gate = at(1, "仿真入口仅在 Canvas 设计通过后才出现。", ["LOAD_REQUIRES_DRIVER ERROR"]), load = at(2, "GPIO 不能直接驱动 DC Fan/Motor/Pump 等负载类设备，必须通过驱动器模块。", []);
  const moved = movedCodes([gate, load], () => message);
  expect(moved.count).toBe(1);
  expect(moved.units.map(unit => unit.details)).toEqual([[], ["LOAD_REQUIRES_DRIVER ERROR"]]);
  // Already on its point, or a code the message does not give: unchanged.
  expect(movedCodes([load, { ...gate, details: [] }], () => message).count).toBe(0);
});
