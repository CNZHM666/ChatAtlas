import { expect, it } from "vitest";
import { streamedSectionProse, streamedAnswerProse } from "./streamed-prose";

it("shows incremental prose without exposing IDs, JSON metadata or reasoning at any stream boundary", () => {
  const response = JSON.stringify({ reasoning: "PRIVATE_THOUGHT", sections: [{ title: "方案", body: "中文条件\n`x^2` 与代码。", evidenceIds: ["PRIVATE_ID"], structure: { body: "PRIVATE_STRUCTURE" } }], brief: { body: "PRIVATE_BRIEF" } });
  for (let end = 0; end <= response.length; end++) expect(streamedSectionProse(response.slice(0, end))).not.toMatch(/PRIVATE_|evidenceIds|structure|sections/u);
  expect(streamedSectionProse(response)).toBe("### 方案\n\n中文条件\n`x^2` 与代码。");
  expect(streamedSectionProse('{"sections":[{"body":"正在')).toBe("正在");
});
it("handles split escapes, unicode, multiple sections and genuine code without fabricating completion", () => {
  expect(streamedSectionProse('{"sections":[{"body":"A\\u4e')).toBe("A");
  expect(streamedSectionProse('{"sections":[{"body":"A\\u4e2d\\nB\\')).toBe("A中\nB");
  const value = { sections: [{ body: '```ts\nconst x = "a";\n```' }, { title: "Next", body: "Context" }], body: "hidden" };
  expect(streamedSectionProse(JSON.stringify(value))).toBe('```ts\nconst x = "a";\n```\n\n### Next\n\nContext');
});

it("streams only sidecar answer text at every boundary, including escaped prose", () => {
  const text = JSON.stringify({reasoning:"PRIVATE_REASONING",answer:[{text:'**方案**\n`a` 与 "b"',sourceIds:["PRIVATE_SOURCE"]},{text:"后续条件",sourceIds:["PRIVATE_SOURCE"]}],matches:[{id:"PRIVATE_SOURCE",quote:"PRIVATE_QUOTE"}]});
  for(let end=0;end<=text.length;end++)expect(streamedAnswerProse(text.slice(0,end))).not.toMatch(/PRIVATE_|sourceIds|matches|reasoning/u);
  expect(streamedAnswerProse(text)).toBe('**方案**\n`a` 与 "b"\n\n后续条件');
  expect(streamedAnswerProse('{"answer":[{"text":"A\\u4e')).toBe("A");
  expect(streamedAnswerProse('{"answer":[{"text":"A\\u4e2d\\nB\\')).toBe("A中\nB");
});
