import { expect, it } from "vitest";
import { type WikiKnowledgeLedger, type WikiKnowledgeUnit } from "./wiki-knowledge";
import { datedWikiSources, withWikiSources, wikiByDiscussion, wikiDiscussionOrder, wikiSaidLater, wikiSourceLabels, wikiSourceName, wikiUnitPlatform } from "./wiki-sources";

const day = (n: number) => Date.UTC(2026, 8, n);
const unit = (id: string, conversationId: string, messageIndex: number, role: "user" | "assistant" = "assistant"): WikiKnowledgeUnit => ({ id, subject: "", statement: id, kind: "decision", details: [], evidence: { evidenceId: id, conversationId, messageId: id, messageIndex, role, pasted: false, quote: id }, adoption: { status: "proposal" }, delivery: "unknown" });
const ledger = (units: WikiKnowledgeUnit[]): WikiKnowledgeLedger => ({ version: 1, generatedAt: 0, status: "complete", materials: 0, batches: [{ sourceIds: [], status: "ok", units, rejected: {} }] });
const conversations = [
  { id: "a", platform: "chatgpt", title: "硬件方向", sourceCreatedAt: day(1), sourceUpdatedAt: day(3) },
  { id: "b", platform: "claude", title: "界面细化", sourceCreatedAt: day(5), sourceUpdatedAt: day(9) },
  // Taken up again while b went on: it overlaps b.
  { id: "c", platform: "chatgpt", title: "补充", sourceCreatedAt: day(4), sourceUpdatedAt: day(20) },
];
const read = () => {
  const sourced = withWikiSources(ledger([unit("a50", "a", 50), unit("b3", "b", 3), unit("b7", "b", 7), unit("c1", "c", 1), unit("a2", "a", 2, "user")]), conversations);
  return { sourced, units: new Map(sourced.batches[0].units.map(item => [item.id, item])) };
};

it("dates each unit by its conversation, and tells later across conversations only when one ended before the other began", () => {
  const { sourced, units } = read(), get = (id: string) => units.get(id)!;
  expect(sourced.sources?.b).toEqual({ platform: "claude", title: "界面细化", start: day(5), end: day(9) });
  expect(get("b3").evidence.conversationSpan).toEqual({ start: day(5), end: day(9) });
  // In one conversation, by message order.
  expect(wikiSaidLater(get("b7"), get("b3"))).toBe(true);
  // Message 3 of b is later than message 50 of a: a was over before b began.
  expect(wikiSaidLater(get("b3"), get("a50"))).toBe(true);
  expect(wikiSaidLater(get("a50"), get("b3"))).toBe(false);
  // c overlaps b: neither is later.
  expect(wikiDiscussionOrder(get("c1"), get("b7"))).toBeUndefined();
  expect(wikiSaidLater(get("b7"), get("c1"))).toBe(false);
  // Without platform times nothing is told across conversations, whatever the message numbers.
  expect(wikiDiscussionOrder(unit("x9", "x", 9), unit("y1", "y", 1))).toBeUndefined();
  expect([get("b7"), get("a50"), get("b3")].sort(wikiByDiscussion).map(item => item.id)).toEqual(["a50", "b3", "b7"]);
});

it("drops a platform time that is no real time", () => {
  const sourced = withWikiSources(ledger([unit("u", "a", 1)]), [{ id: "a", platform: "chatgpt", title: "t", sourceCreatedAt: 0, sourceUpdatedAt: day(2) }]);
  expect(sourced.sources?.a).toEqual({ platform: "chatgpt", title: "t", end: day(2) });
});

it("names several conversations by their AI, numbered only when one AI held several, and none when there is one", () => {
  const { sourced } = read();
  const labels = wikiSourceLabels(sourced, ["b", "a", "c"], "zh-CN");
  expect([...labels.values()].map(label => `${label.label} | ${label.title}`)).toEqual(["ChatGPT 1 | 硬件方向", "ChatGPT 2 | 补充", "Claude | 界面细化"]);
  expect(wikiSourceName(labels.get("b")!)).toBe("Claude");
  expect(wikiSourceLabels(sourced, ["a"], "zh-CN").size).toBe(0);
});

it("gives an assistant unit its AI only when the units come from more than one", () => {
  const { sourced, units } = read();
  const platformOf = wikiUnitPlatform(sourced, "zh-CN");
  expect(platformOf(units.get("b3")!)).toBe("Claude");
  expect(platformOf(units.get("a50")!)).toBe("ChatGPT");
  // The user's own words have no platform.
  expect(platformOf(units.get("a2")!)).toBeUndefined();
  const one = withWikiSources(ledger([unit("a1", "a", 1), unit("c1", "c", 1)]), conversations);
  expect(wikiUnitPlatform(one, "zh-CN")(one.batches[0].units[0])).toBeUndefined();
});

it("dates a conversation its platform gave no start time by its first dated message", () => {
  const sources = [{ id: "d", platform: "deepseek", title: "Review", sourceUpdatedAt: Date.UTC(2026, 10, 7, 7) }, { id: "c", platform: "chatgpt", title: "Plan", sourceCreatedAt: Date.UTC(2026, 10, 7, 5), sourceUpdatedAt: Date.UTC(2026, 10, 7, 6) }];
  const dated = datedWikiSources(sources, [{ conversationId: "d", sourceCreatedAt: Date.UTC(2026, 10, 7, 6, 50) }, { conversationId: "d", sourceCreatedAt: Date.UTC(2026, 10, 7, 6, 55) }, { conversationId: "d" }]);
  expect(dated[0].sourceCreatedAt).toBe(Date.UTC(2026, 10, 7, 6, 50));
  expect(dated[1]).toBe(sources[1]);
});
