import { expect, it } from "vitest";
import { matchesMessageQuery, matchesNearbyQuery, messageSearchTokens, planMessageQuery } from "./message-query";

it("relaxes descriptive terms only when requested, keeping nearby evidence and identifiers mandatory", () => {
  const query=planMessageQuery("IndexedDB 自动 持久化 索引"),body="IndexedDB 索引持久化减少重复扫描。",terms=new Set(messageSearchTokens(body));
  expect(matchesMessageQuery(query,terms,body)).toBe(false);
  expect(matchesMessageQuery(query,terms,body,.67)).toBe(true);
  expect(matchesNearbyQuery(query,[body],120,.67)).toBe(true);
  expect(matchesMessageQuery(query,new Set(messageSearchTokens("自动持久化索引")),"自动持久化索引",.67)).toBe(false);
  expect(matchesNearbyQuery(query,[`IndexedDB${"无关文字".repeat(50)}索引持久化`],120,.67)).toBe(false);
});
it("does not relax quoted phrases or one- and two-term lookups",()=>{
 const body="自动采购尚未发布";
 expect(matchesMessageQuery(planMessageQuery('"自动采购已经发布"'),new Set(messageSearchTokens(body)),body,.67)).toBe(false);
 expect(matchesMessageQuery(planMessageQuery("采购 发布"),new Set(messageSearchTokens("采购清单")),"采购清单",.67)).toBe(false);
 expect(matchesMessageQuery(planMessageQuery("保留 编辑 草稿"),new Set(messageSearchTokens("不清空编辑草稿")),"不清空编辑草稿",2/3)).toBe(true);
});
