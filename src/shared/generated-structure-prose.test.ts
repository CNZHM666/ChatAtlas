import { expect, it } from "vitest";
import { generatedProse,withoutGeneratedDiscussionAppendix } from "./generated-structure-prose";
import { structureCode, structureMetadata } from "../test/structure-metadata-fixture";

it("suppresses the exact v3 appendix without deleting real quotations, code or source text",()=>{
 const appendix="### Original details\n\nAI discussion：\n\n> a proposal";
 expect(generatedProse(`A conclusion.\n\n${appendix}`).body).toBe("A conclusion.");
 const genuine="### 原文中的具体说明\n\n作者解释如下：\n\n> 保留的原文。";expect(withoutGeneratedDiscussionAppendix(genuine)).toBe(genuine);
 const code=`\`\`\`md\n${appendix}\n\`\`\``;expect(withoutGeneratedDiscussionAppendix(code)).toBe(code);
 expect(withoutGeneratedDiscussionAppendix(appendix,[appendix])).toBe(appendix);
 expect(withoutGeneratedDiscussionAppendix("普通引用：\n\n> 不删除这段。")).toBe("普通引用：\n\n> 不删除这段。");
 const old="正文。\n\n### 原文中的具体说明\n\nAI 讨论原句：\n\n> 第一句。\nAI 讨论原句：\n\n> 第二句。";
 expect(withoutGeneratedDiscussionAppendix(old)).toBe("正文。");
});
it("separates leaked structure blocks from prose without promoting them into verified facts", () => {
  const original = `## 验证策略\n\n先验证基础能力。\n\n${structureCode}\n\n继续执行测试。`;
  const result = generatedProse(original);
  expect(result.removedBlocks).toBe(1);
  expect(result.body).toContain("先验证基础能力。");
  expect(result.body).toContain("继续执行测试。");
  expect(result.body).not.toContain("validation_bench");
  expect(original).toContain("validation_bench");
  expect(generatedProse(JSON.stringify(structureMetadata))).toEqual({ body: "", removedBlocks: 1 });
});

it("preserves declared examples, exact source code, unrelated JSON and quoted metadata", () => {
  const samples = [
    `接口的 JSON 示例：\n\n${structureCode}`,
    `## Response schema\n\n${structureCode}`,
    '```json\n{"nodes":[{"id":"a"}],"relations":[]}\n```',
    `> ${structureCode.replaceAll("\n", "\n> ")}`,
    `\`\`\`js\nconst sample = ${JSON.stringify(structureMetadata)};\n\`\`\``,
  ];
  for (const body of samples) expect(generatedProse(body)).toEqual({ body, removedBlocks: 0 });
  expect(generatedProse(structureCode, [JSON.stringify(structureMetadata, null, 2)])).toEqual({ body: structureCode, removedBlocks: 0 });
});

it("does not mistake malformed or incomplete metadata for a removable block", () => {
  const malformed = structureCode.replace('"discussed"', '"other"');
  expect(generatedProse(malformed).removedBlocks).toBe(0);
  expect(generatedProse(structureCode.slice(0, -4)).removedBlocks).toBe(1); // Markdown treats a final unclosed fence as a code block.
});

it("turns only leaked inventory records into qualified prose, preserving actual schema examples",()=>{
 const json=JSON.stringify({kind:"decisions",text:"聚焦项目演变与当前状态",status:"documented",quote:"建议聚焦项目演变与当前状态。"}),code=`\`\`\`json\n${json}\n\`\`\``;
 expect(generatedProse(code).body).toBe("讨论建议：聚焦项目演变与当前状态");
 expect(generatedProse(json).body).toBe("讨论建议：聚焦项目演变与当前状态");
 expect(generatedProse(`接口的 JSON 示例：\n\n${code}`).body).toContain(json);
 expect(generatedProse(code,[json]).body).toBe(code);
 expect(generatedProse(`> ${code.replaceAll("\n","\n> ")}`).body).toContain(json);
 expect(generatedProse("正文。\n\n依据本次材料解释机制、条件与限制。\n\nTransition to next section.").body.trim()).toBe("正文。");
});
