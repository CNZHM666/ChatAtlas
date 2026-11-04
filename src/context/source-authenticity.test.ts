import { expect, it } from "vitest";
import { contextKnowledge } from "../test/context-fixture";
import { buildProjectContext } from "./engine";
import { formatContext } from "./format";

it("exports literal original excerpts rather than labelling a generated Wiki summary as the user's words", () => {
  const knowledge = contextKnowledge();
  knowledge.session.sections[0].claims = undefined;
  knowledge.session.sections[0].body = "经过重写的项目全景总结，绝非用户原话。";
  const pack = buildProjectContext(knowledge, { zh: true, task: "", length: "detailed", mode: "full", sections: ["wiki"] });
  const sources = formatContext(pack).split("## 来源")[1];
  expect(sources).not.toContain("经过重写的项目全景总结");
  expect(sources).toContain(knowledge.session.evidence[0].excerpt);
  expect(pack.sources.every(source => source.excerpts?.every(excerpt => knowledge.messages.find(message => message.id === source.messageId)!.content.includes(excerpt)))).toBe(true);
});
it("keeps complete internal source associations while limiting repeated chapter references in portable text", () => {
  const knowledge = contextKnowledge(), pack = buildProjectContext(knowledge, { zh: true, task: "", length: "detailed", sections: ["wiki"] });
  const base = pack.sources[0];
  pack.sources = Array.from({ length: 10 }, (_, index) => ({ ...base, id: `source-${index}`, excerpts: [`原始讨论${index}`] }));
  pack.sections = [{ kind: "wiki", items: [{ id: "chapter", text: "### 项目定位\n\n统一的项目定位总结。", status: "background", sourceIds: [], referenceIds: pack.sources.map(source => source.id), updatedAt: 1 }] }];
  const text = formatContext(pack);
  expect(text.match(/^- \[\d+\]/gmu)).toHaveLength(2);
  expect(text).toContain("其余 8 条关联参考保留在 ChatAtlas");
  expect(pack.sources).toHaveLength(10); expect(pack.sections[0].items[0].referenceIds).toHaveLength(10);
});
it("does not invent quotations for legacy bundles without original excerpts", () => {
  const knowledge = contextKnowledge(), pack = buildProjectContext(knowledge, { zh: true, task: "", length: "detailed", sections: ["wiki"] });
  pack.sources.forEach(source => { delete source.excerpts; });
  const sources = formatContext(pack).split("## 来源")[1];
  expect(sources).not.toMatch(/用户原文|AI 原文/u);
});
