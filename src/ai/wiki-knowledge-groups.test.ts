import { expect, it } from "vitest";
import { buildExplanationGroups, GROUP_CLUSTER, groupCandidateClusters, recallGroupCandidates, updateExplanationGroups } from "./wiki-knowledge-groups";
import type { StructuredAIRequest } from "./provider";
import { AIProviderResponseError } from "./provider-errors";
import type { WikiExplanationGroup, WikiKnowledgeUnit } from "../shared/wiki-knowledge";

const unit = (index: number, statement: string, extra: { subject?: string; about?: WikiKnowledgeUnit["about"] } = {}): WikiKnowledgeUnit =>
  ({ id: `unit:${index}`, subject: extra.subject ?? "上下文", statement, kind: "mechanism", details: [], evidence: { evidenceId: `e${index}`, conversationId: "c", messageId: `m${index}`, messageIndex: index, role: "assistant", pasted: false, quote: statement }, adoption: { status: "proposal" }, delivery: "unknown", ...(extra.about ? { about: extra.about } : {}) });
// Filler units make the shared terms uncommon enough to count, as in a real ledger.
const filler = Array.from({ length: 40 }, (_, index) => unit(1000 + index, `第${index}号无关主题讨论界面配色与动画节奏${index}。`, { subject: `杂项${index}` }));
const pairOf = (candidates: ReturnType<typeof recallGroupCandidates>, a: string, b: string) => candidates.some(candidate => candidate.a === (a < b ? a : b) && candidate.b === (a < b ? b : a));

it("recalls candidates across subjects and far apart in the discussion", () => {
  const engine = unit(1, "Context Engine 根据当前任务选择相关知识。", { subject: "Context Engine" });
  const budget = { ...unit(900, "上下文引擎根据当前任务选择相关知识，并控制 Token 预算。", { subject: "Token 控制" }) };
  const candidates = recallGroupCandidates([engine, budget, ...filler]);
  expect(pairOf(candidates, engine.id, budget.id)).toBe(true);
  expect(groupCandidateClusters(candidates)).toContainEqual([engine.id, budget.id].sort());
});

it("never pairs what one requires and the other forbids, or units about different things", () => {
  const must = unit(1, "全文搜索必须在本地调用生成模型处理原始消息。"), never = unit(2, "全文搜索禁止在本地调用生成模型处理原始消息。");
  const own = unit(3, "保存用户确认过的项目知识与原始来源。"), competitor = unit(4, "保存用户确认过的项目知识与原始来源。", { about: { name: "Mem0", role: "reference" } });
  const candidates = recallGroupCandidates([must, never, own, competitor, ...filler]);
  expect(pairOf(candidates, must.id, never.id)).toBe(false);
  expect(pairOf(candidates, own.id, competitor.id)).toBe(false);
});

it("keeps different numbers as candidates: a parameter may be a condition of one core", () => {
  const thirty = unit(1, "索引每 30 秒在后台增量更新一次。"), sixty = unit(2, "索引每 60 秒在后台增量更新一次。");
  expect(pairOf(recallGroupCandidates([thirty, sixty, ...filler]), thirty.id, sixty.id)).toBe(true);
});

it("leaves unrelated units out and caps a large family, cutting where its links are weakest", () => {
  const family = Array.from({ length: 20 }, (_, index) => unit(index + 1, `Context Engine 根据当前任务选择相关知识，保留原文来源${index % 2 ? "并控制预算" : ""}。`));
  const clusters = groupCandidateClusters(recallGroupCandidates([...family, ...filler]));
  expect(clusters.every(cluster => cluster.length <= GROUP_CLUSTER)).toBe(true);
  expect(clusters.flat().every(id => family.some(item => item.id === id))).toBe(true);
  expect(new Set(clusters.flat()).size).toBe(clusters.flat().length);
  expect(groupCandidateClusters(recallGroupCandidates(filler))).toEqual([]);
});

// ---- Step 2: confirmation, local checks, merging ----

const signal = new AbortController().signal;
type Cluster = { id: string; units: Array<{ id: string; clauses: string[] }> };
/** A fake economy model: groups answers by cluster, merge answers by pair; every request is recorded. */
function groupModel(groups: (clusters: Cluster[]) => unknown, same: (pairs: Array<{ id: string; first: string; second: string }>) => unknown = () => ({ same: [] })) {
  const calls: Array<{ presentation: string; clusters?: Cluster[] }> = [];
  return { calls, ai: { generateStructured: async <T,>(request: StructuredAIRequest<T>): Promise<T> => {
    const data = JSON.parse(request.prompt) as { presentation: string; clusters?: Cluster[]; pairs?: Array<{ id: string; first: string; second: string }> };
    calls.push({ presentation: data.presentation, clusters: data.clusters });
    return request.validate(data.presentation === "wiki_unit_groups" ? groups(data.clusters!) : same(data.pairs!));
  } } };
}
/** The alias the request gave a unit, found by all its clauses. */
const aliasOf = (clusters: Cluster[], statement: string) => clusters.flatMap(cluster => cluster.units).find(item => item.clauses.map(clause => clause.replace(/^\d+\. /u, "")).join("") === statement.replace(/[，。]/gu, ""))!.id;
const build = (units: WikiKnowledgeUnit[], clusters: string[][], ai: ReturnType<typeof groupModel>["ai"], previous?: WikiExplanationGroup[]) => { const report: Record<string, number> = {}; return buildExplanationGroups(units, clusters, new Map(units.map(item => [item.id, `subject:${item.subject}`])), { ai, locale: "zh-CN", signal, previous }, report).then(result => ({ ...result, report })); };

it("groups units sharing a core from clause numbers, keeping each member's own clauses and marking pure restatements", async () => {
  const a = unit(1, "Context Engine 根据当前任务选择相关知识。"), b = unit(2, "Context Engine 根据当前任务选择相关知识，并控制 Token 预算。"), c = unit(3, "Context Engine 根据当前任务选择相关知识，保留原文来源。");
  const fake = groupModel(clusters => ({ groups: [{ core: "Context Engine 根据当前任务选择相关知识。", members: [
    { id: aliasOf(clusters, a.statement), support: [1], adds: [] }, { id: aliasOf(clusters, b.statement), support: [1], adds: [2] }, { id: aliasOf(clusters, c.statement), support: [1], adds: [2] }] }] }));
  const { groups, report } = await build([a, b, c], [[a.id, b.id, c.id]], fake.ai);
  // The request carries numbered clauses, not statements to copy.
  expect(fake.calls[0].clusters![0].units[1].clauses).toEqual(["1. Context Engine 根据当前任务选择相关知识", "2. 并控制 Token 预算"]);
  expect(groups).toHaveLength(1);
  expect(groups[0].members.map(member => [member.unitId, member.role, member.support, member.adds])).toEqual([[a.id, "restates", "Context Engine 根据当前任务选择相关知识", []], [b.id, "adds", "Context Engine 根据当前任务选择相关知识", ["并控制 Token 预算"]], [c.id, "adds", "Context Engine 根据当前任务选择相关知识", ["保留原文来源"]]]);
  expect(groups[0].homeSubjectId).toBe("subject:上下文");
  expect(report).toMatchObject({ groups: 1, group_members: 3, group_restates: 1, group_requests: 1 });
});

it("refuses a member leaving a clause unassigned, and drops one answered with a clause it does not have", async () => {
  const base = unit(1, "索引在后台增量更新。"), wrong = unit(2, "索引在后台增量更新，并控制更新频率。"), idle = unit(3, "仅在空闲时，索引在后台增量更新。");
  const fake = groupModel(clusters => ({ groups: [{ core: "索引在后台增量更新。", members: [
    { id: aliasOf(clusters, base.statement), support: [1], adds: [] }, { id: aliasOf(clusters, wrong.statement), support: [1], adds: [5] }, { id: aliasOf(clusters, idle.statement), support: [2], adds: [] }] }] }));
  const { groups, report } = await build([base, wrong, idle], [[base.id, wrong.id, idle.id]], fake.ai);
  // "仅在空闲时" belongs to no part, so that member stands alone; one member left is no group.
  expect(groups).toEqual([]);
  expect(report).toMatchObject({ group_rejected_covered: 1 });
});

it("never groups another value for the same aspect", async () => {
  const narrow = unit(1, "桌面端详情抽屉宽 400px。"), wide = unit(2, "桌面端详情抽屉宽 440px。"), drawer = unit(3, "详情以右侧抽屉展示。");
  const fake = groupModel(clusters => ({ groups: [{ core: "详情以右侧抽屉展示。", members: [
    { id: aliasOf(clusters, drawer.statement), support: [1], adds: [] }, { id: aliasOf(clusters, narrow.statement), support: [], adds: [1] }, { id: aliasOf(clusters, wide.statement), support: [], adds: [1] }] }] }));
  const { groups, report } = await build([drawer, narrow, wide], [[drawer.id, narrow.id, wide.id]], fake.ai);
  // The drawer and its 400px width share one explanation; 440px, another value for the same width, stands alone.
  expect(groups[0].members.map(member => member.unitId)).toEqual([drawer.id, narrow.id]);
  expect(report.group_rejected_conflict).toBe(1);
});

it("narrows a core saying more than a member to that member's own words, and the extra clause becomes the other's own", async () => {
  const plainStack = unit(1, "项目采用 IndexedDB 和 Orama 的本地优先架构。"), noFramework = unit(2, "项目采用 IndexedDB 和 Orama 的本地优先架构，不引入大型外部框架。");
  const fake = groupModel(clusters => ({ groups: [{ core: "项目采用 IndexedDB 和 Orama 的本地优先架构，不引入大型外部框架。", members: [
    { id: aliasOf(clusters, plainStack.statement), support: [1], adds: [] }, { id: aliasOf(clusters, noFramework.statement), support: [1, 2], adds: [] }] }] }));
  const { groups, report } = await build([plainStack, noFramework], [[plainStack.id, noFramework.id]], fake.ai);
  // The first never says it brings in no framework: the core becomes what both say, and the prohibition is the second's own.
  expect(groups[0].core).toBe("项目采用 IndexedDB 和 Orama 的本地优先架构。");
  expect(groups[0].members.map(member => [member.unitId, member.role, member.support, member.adds])).toEqual([[plainStack.id, "restates", "项目采用 IndexedDB 和 Orama 的本地优先架构", []], [noFramework.id, "adds", "项目采用 IndexedDB 和 Orama 的本地优先架构", ["不引入大型外部框架"]]]);
  expect(report).toMatchObject({ group_core_replaced: 1 });
  expect(report.group_core_unsupported).toBeUndefined();
});

it("never lets support naming more than the core pass as a restatement", async () => {
  const same = unit(1, "知识检索先做全文搜索，后续增加向量检索。"), phases = unit(2, "开发分为四个阶段：M1 做全文搜索，M2 增加向量检索。"), more = unit(3, "知识检索先做全文搜索，后续增加向量检索，M3 引入 LLM 重排。");
  const fake = groupModel(clusters => ({ groups: [{ core: "知识检索先做全文搜索，后续增加向量检索。", members: [
    { id: aliasOf(clusters, same.statement), support: [1, 2], adds: [] }, { id: aliasOf(clusters, phases.statement), support: [1, 2], adds: [] }, { id: aliasOf(clusters, more.statement), support: [1, 2, 3], adds: [] }] }] }));
  const { groups, report } = await build([same, phases, more], [[same.id, phases.id, more.id]], fake.ai);
  // The phases name M1 and M2 in every clause: nothing to split off, so the member keeps its words and adds.
  // The third's M3 clause is its own; the first alone restates.
  expect(groups[0].members.map(member => [member.unitId, member.role, member.support, member.adds])).toEqual([
    [same.id, "restates", "知识检索先做全文搜索，后续增加向量检索", []],
    [phases.id, "adds", "开发分为四个阶段：M1 做全文搜索，M2 增加向量检索", []],
    [more.id, "adds", "知识检索先做全文搜索，后续增加向量检索", ["M3 引入 LLM 重排"]]]);
  expect(report.group_support_wider).toBe(2);
});

it("takes out a member that holds neither the core nor any narrower one, while a member that only adds stays", async () => {
  const first = unit(1, "项目采用 IndexedDB 和 Orama，遵循 Local-first。"), second = unit(2, "项目采用 IndexedDB 和 Orama，遵循 Local-first 原则。"), other = unit(3, "项目采用 SQLite 做本地存储。"), extra = unit(4, "Orama 索引在空闲时重建。");
  const fake = groupModel(clusters => ({ groups: [{ core: "项目采用 IndexedDB 和 Orama，遵循 Local-first。", members: [
    { id: aliasOf(clusters, first.statement), support: [1, 2], adds: [] }, { id: aliasOf(clusters, second.statement), support: [1, 2], adds: [] }, { id: aliasOf(clusters, other.statement), support: [1], adds: [] }, { id: aliasOf(clusters, extra.statement), support: [], adds: [1] }] }] }));
  const { groups, report } = await build([first, second, other, extra], [[first.id, second.id, other.id, extra.id]], fake.ai);
  // SQLite shares nothing with the core: it stands alone rather than staying with all its words as its own.
  expect(groups[0].core).toBe("项目采用 IndexedDB 和 Orama，遵循 Local-first。");
  expect(groups[0].members.map(member => member.unitId)).toEqual([first.id, second.id, extra.id]);
  expect(report.group_core_unsupported).toBe(1);expect(report.group_core_replaced).toBeUndefined();
});

it("joins a family cut into two clusters when the model confirms their cores, and keeps a previous group's id", async () => {
  const clean = [1, 2, 3, 4].map(index => unit(index, index < 3 ? "保留原文来源作为核对依据。" : "保留原文来源，作为核对依据。"));
  const fake = groupModel(clusters => ({ groups: clusters.map(cluster => ({ core: "保留原文来源作为核对依据。", members: cluster.units.map(item => ({ id: item.id, support: item.clauses.map((_, index) => index + 1), adds: [] })) })) }), pairs => ({ same: pairs.map(pair => pair.id) }));
  const first = await build(clean, [[clean[0].id, clean[1].id], [clean[2].id, clean[3].id]], fake.ai);
  expect(first.groups).toHaveLength(1);expect(first.groups[0].members).toHaveLength(4);
  expect(first.report).toMatchObject({ group_merge_requests: 1 });
  // A later run with one more member keeps the id and the home.
  const extra = { ...unit(5, "保留原文来源作为核对依据。"), subject: "导出" };
  const again = await build([...clean, extra], [[clean[0].id, clean[1].id, extra.id], [clean[2].id, clean[3].id]], fake.ai, first.groups);
  expect(again.groups[0].id).toBe(first.groups[0].id);expect(again.groups[0].homeSubjectId).toBe(first.groups[0].homeSubjectId);
});

const exportPairs = (count: number) => Array.from({ length: count }, (_, index) => [unit(index * 2 + 1, `第${index}组：导出提供 Markdown 文件。`), unit(index * 2 + 2, `第${index}组：导出提供 Markdown 文件，附带来源。`)]);
const exportAnswer = (clusters: Cluster[]) => ({ groups: clusters.map(cluster => ({ core: "导出提供 Markdown 文件。", members: [
  { id: cluster.units[0].id, support: [1], adds: [] }, { id: cluster.units[1].id, support: [1], adds: [2] }] })) });
const cutOff = () => new AIProviderResponseError("PROVIDER_OUTPUT_TRUNCATED");

it("asks a cut-off batch again in halves, counting progress by units so the total never grows", async () => {
  const pairs = exportPairs(4);
  let seen = 0;
  const fake = groupModel(clusters => { seen++; if (clusters.length > 2) throw cutOff(); return exportAnswer(clusters); });
  const steps: Array<[number, number]> = [], report: Record<string, number> = {}, units = pairs.flat();
  const { groups } = await buildExplanationGroups(units, pairs.map(pair => pair.map(item => item.id)), new Map(), { ai: fake.ai, locale: "zh-CN", signal, progress: step => steps.push([step.done, step.total]) }, report);
  expect(seen).toBe(3);expect(report).toMatchObject({ group_halved: 1, group_fail_truncated: 1 });
  expect(groups).toHaveLength(4);
  expect(steps).toEqual([[0, 8], [4, 8], [8, 8]]);
});

it("halves a batch only once, and gives up instead of halving a wrong-shaped answer", async () => {
  const pairs = exportPairs(4);
  let seen = 0;
  const truncating = groupModel(() => { seen++; throw cutOff(); });
  const cut = await build(pairs.flat(), pairs.map(pair => pair.map(item => item.id)), truncating.ai);
  // One request, then two halves; the halves are not cut again.
  expect(seen).toBe(3);expect(cut.report).toMatchObject({ group_halved: 1, group_failed: 2, group_fail_truncated: 3 });
  const malformed = groupModel(() => ({ nothing: true }));
  const wrong = await build(pairs.flat(), pairs.map(pair => pair.map(item => item.id)), malformed.ai);
  expect(malformed.calls).toHaveLength(1);expect(wrong.report).toMatchObject({ group_failed: 1, group_fail_invalid: 1 });
  expect(wrong.report.group_halved).toBeUndefined();
});

it("stops halving after three failures in a row", async () => {
  // Over 40 units, so the clusters go out in two batches; every answer is cut off.
  const pairs = exportPairs(30), fake = groupModel(() => { throw cutOff(); });
  const { report } = await build(pairs.flat(), pairs.map(pair => pair.map(item => item.id)), fake.ai);
  // Both batches go out at once and fail (one and two in a row), so each is halved once; the four halves fail
  // and are given up, never halved again.
  expect(fake.calls).toHaveLength(6);expect(report).toMatchObject({ group_halved: 2, group_failed: 4 });
});

it("keeps unchanged groups on an update, and redoes a group a new or changed unit reaches, under its old id", async () => {
  const a = unit(1, "Context Engine 根据当前任务选择相关知识。"), b = unit(2, "Context Engine 根据当前任务选择相关知识，并控制 Token 预算。");
  const whole = groupModel(clusters => ({ groups: clusters.map(cluster => ({ core: "Context Engine 根据当前任务选择相关知识。", members: cluster.units.map(item => ({ id: item.id, support: [1], adds: item.clauses.slice(1).map((_, index) => index + 2) })) })) }));
  const subjects = (units: WikiKnowledgeUnit[]) => new Map(units.map(item => [item.id, `subject:${item.subject}`]));
  const base = [a, b, ...filler], first = await build(base, [[a.id, b.id]], whole.ai);
  expect(first.groups).toHaveLength(1);
  // A new unit about something else: the group is kept as it was, and no group request is sent.
  const unrelated = unit(3, "首页使用深色极简风格，保留左侧导航。", { subject: "界面" });
  const quiet = groupModel(() => { throw new Error("no request expected"); });
  const report: Record<string, number> = {};
  const kept = await updateExplanationGroups(first.groups, [...base, unrelated], new Set([unrelated.id]), subjects([...base, unrelated]), { ai: quiet.ai, locale: "zh-CN", signal }, report);
  expect(kept.groups).toEqual(first.groups);expect(quiet.calls).toHaveLength(0);expect(report).toMatchObject({ group_kept: 1, group_redone: 0 });
  // A new unit stating the same core joins it; the group keeps its id.
  const joining = unit(4, "Context Engine 根据当前任务选择相关知识，并保留原文来源。", { subject: "来源" });
  const joined = await updateExplanationGroups(first.groups, [...base, joining], new Set([joining.id]), subjects([...base, joining]), { ai: whole.ai, locale: "zh-CN", signal }, {});
  expect(joined.groups).toHaveLength(1);expect(joined.groups[0].id).toBe(first.groups[0].id);
  expect(joined.groups[0].members.map(member => member.unitId).sort()).toEqual([a.id, b.id, joining.id].sort());
  // A member whose statement changed: the group no longer matches its fingerprint and is redone.
  const changed = { ...b, statement: "Context Engine 根据当前任务选择相关知识，并控制 2000 Token 预算。" }, redone: Record<string, number> = {};
  await updateExplanationGroups(first.groups, [a, changed, ...filler], new Set(), subjects([a, changed, ...filler]), { ai: whole.ai, locale: "zh-CN", signal }, redone);
  expect(redone).toMatchObject({ group_kept: 0, group_redone: 1 });
});

it("builds the same groups in queue order whichever request answers first", async () => {
  // Thirty pairs make two batches; the first batch answers last.
  const pairs = exportPairs(30), slow = (first: boolean) => ({ generateStructured: async <T,>(request: StructuredAIRequest<T>): Promise<T> => {
    const data = JSON.parse(request.prompt) as { presentation: string; clusters: Cluster[] };
    const late = data.clusters[0].units[0].clauses[0].includes("第0组");
    await new Promise(resolve => setTimeout(resolve, late === first ? 20 : 0));
    return request.validate(exportAnswer(data.clusters));
  } });
  const ids = pairs.map(pair => pair.map(item => item.id));
  const one = await build(pairs.flat(), ids, slow(true)), other = await build(pairs.flat(), ids, slow(false));
  expect(one.groups.map(group => group.anchorUnitId)).toEqual(other.groups.map(group => group.anchorUnitId));
  expect(one.groups[0].members.map(member => member.unitId)).toContain(pairs[0][0].id);
});
