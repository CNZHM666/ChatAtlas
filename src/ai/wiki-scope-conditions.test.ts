import { expect, it } from "vitest";
import { applyWikiScopeConditions, unscopedWikiDirections, wikiScopeConditions } from "./wiki-scope-conditions";
import { conditionKept, keepsDetail, type WikiDraftChapter, type WikiKnowledgeOrganization, type WikiKnowledgeUnit } from "../shared/wiki-knowledge";

const unit = (id: string, statement: string, index: number): WikiKnowledgeUnit => ({ id, statement, subject: "同步", kind: "plan", details: [], adoption: { status: "proposal" }, delivery: "unknown", evidence: { evidenceId: id, messageId: id, conversationId: "c", messageIndex: index, role: "assistant", pasted: false, quote: statement } });
const direction = unit("wish", "提供云端同步功能。", 1), scope = unit("scope", "第一版暂不提供云端同步，仅保留本地存储。", 2);
const organization = { relations: [{ older: direction.id, newer: scope.id, kind: "narrows", status: "resolved" }] } as WikiKnowledgeOrganization;

it("keeps a direction and its phase restriction together with independent citations", () => {
  const conditions = wikiScopeConditions(organization, [direction, scope]);
  const chapter: WikiDraftChapter = { id: "ch", title: "同步", question: "", group: "", body: direction.statement, paragraphs: [{ subtopic: "同步", text: direction.statement, unitIds: [direction.id], claims: [{ text: direction.statement, unitIds: [direction.id] }] }], problems: [] };
  expect(applyWikiScopeConditions([chapter], conditions)).toBe(1);
  expect(chapter.body).toContain(scope.statement);
  expect(chapter.paragraphs[0].claims).toContainEqual({ text: scope.statement, unitIds: [scope.id] });
  expect(applyWikiScopeConditions([chapter], conditions)).toBe(0);
  expect(direction.statement).toBe("提供云端同步功能。");
});

it("rejects an unqualified excluded feature in an overview while allowing its long-term direction", () => {
  const conditions = wikiScopeConditions(organization, [direction, scope]);
  expect(unscopedWikiDirections("产品以云端同步为核心功能。", conditions)).toHaveLength(1);
  expect(unscopedWikiDirections("长期方向包含云端同步，第一版仅保留本地存储。", conditions)).toEqual([]);
  expect(wikiScopeConditions(organization, [direction, { ...scope, statement: "本阶段不提供云端同步，仅保留本地存储。" }, unit("later", "下一阶段实现云端同步。", 4)])).toEqual([]);
});

it("accepts translated design vocabulary but keeps identifiers, numbers and code exact", () => {
  expect(keepsDetail("本轮只调整排版和布局。", "typography")).toBe(true);
  expect(conditionKept("本轮只调整 typography 和 layout。", "本轮只调整排版和布局。")).toBe(true);
  expect(keepsDetail("显示需要复核。", "NEEDS_REVIEW")).toBe(false);
  expect(keepsDetail("宽度为 64px。", "56-64px")).toBe(false);
  expect(keepsDetail("字段为排版。", "`typography`")).toBe(false);
});

it("keeps list formatting and only the restriction relevant to the direction",()=>{
 const buy=unit("buy","提供采购清单和比价推荐。",1);
 const limit=unit("limit","本轮禁止重写Canvas、开发PCB/Simulation/CAD/3D Enclosure/商城/比价、新建复杂Dashboard、大规模重构Hardware IR或新增Agent系统/LangGraph/RAG。",2);
 const org={relations:[{older:buy.id,newer:limit.id,kind:"narrows",status:"resolved"}]} as WikiKnowledgeOrganization;
 const conditions=wikiScopeConditions(org,[buy,limit]);
 expect(conditions[0].text).toContain("比价");expect(conditions[0].text).not.toContain("Canvas");expect(conditions[0].text).not.toContain("LangGraph");
 const text="- **采购引导**：提供采购清单和比价推荐。";
 const written:WikiDraftChapter={id:"c",title:"产品定位",question:"",group:"",body:text,paragraphs:[{subtopic:"方向",text,unitIds:[buy.id]}],problems:[]};
 applyWikiScopeConditions([written],conditions);
 expect(written.body.startsWith("- **采购引导**")).toBe(true);
 expect(written.body).not.toContain("方向与阶段范围：-");
 expect(written.paragraphs[0].claims?.[0].unitIds).toEqual([limit.id]);
});

it("adds no restriction a paragraph already states, scopes the opening, and reads without a double colon", () => {
  const wish = unit("buy", "针对小白用户，提供比价推荐及链接。", 1), round = unit("round", "本轮禁止比价、商城和支付。", 2);
  const conditions = wikiScopeConditions({ relations: [{ older: wish.id, newer: round.id, kind: "narrows", status: "resolved" }] } as WikiKnowledgeOrganization, [wish, round]);
  const said = "针对小白用户，提供比价推荐及链接，但本轮禁止比价。";
  const chapter: WikiDraftChapter = { id: "ch", title: "定位", question: "", group: "", openingUnitIds: [wish.id], body: `已确认提供比价推荐功能。\n\n### 用户\n\n${said}`, paragraphs: [{ subtopic: "用户", text: said, unitIds: [wish.id] }], problems: [] };
  expect(applyWikiScopeConditions([chapter], conditions)).toBe(1);
  expect(chapter.body).toBe(`已确认提供比价推荐功能。\n\n阶段范围：本轮禁止比价。\n\n### 用户\n\n${said}`);
  expect(chapter.openingUnitIds).toEqual([wish.id, round.id]);
});

it("reads an identifier however it is joined, and skip or 绕过 as 跳过", () => {
  expect(keepsDetail("引入 VERIFIED、NEEDS_REVIEW 四种状态。", "Needs Review")).toBe(true);
  expect(conditionKept("不得跳过测试", "全部通过，不得用 skip 绕过失败测试。")).toBe(true);
});
