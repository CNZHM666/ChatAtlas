import { expect, it } from "vitest";
import { wikiBlockPresentation, planWikiSourceBlock, recoverWikiSourceLiterals, restoreWikiChapterLiterals, restoreWikiLiteralPayloads } from "./wiki-block-presentation";
import { wikiReadingFormat } from "./wiki-reading-format";
import type { WikiKnowledgeUnit, WikiDraftChapter } from "./wiki-knowledge";

const mark = String.fromCharCode(96).repeat(3);
const fence = (text: string, language = "text") => `${mark}${language}\n${text}\n${mark}`;
const unit = (text: string, statement = text): WikiKnowledgeUnit => ({ id: "u", subject: "接口", statement, details: [], kind: "constraint", evidence: { evidenceId: "e", conversationId: "c", messageId: "m", messageIndex: 1, role: "assistant", pasted: false, quote: text, code: { language: "text", text } }, adoption: { status: "proposal" }, delivery: "unknown" });
it("keeps redundant labels in sources while retaining unique syntax and diagrams",()=>{
 const code={language:"text",text:"Base URL\nAPI Key\nModel ID"};
 expect(planWikiSourceBlock(code,"",[],"自定义设置包含 Base URL、API Key 和 Model ID。").mode).toBe("source_only");
 expect(planWikiSourceBlock(code,"",[],"需要配置服务商。").mode).toBe("supplement");
 expect(planWikiSourceBlock({language:"ts",text:"const id = 1;"},"",[],"const id = 1;").mode).toBe("supplement");
 expect(planWikiSourceBlock({language:"text",text:"A → B"},"",[],"A → B").mode).toBe("supplement");
});

it("keeps fields as contextual examples and recovers only ledger-backed flattened copies",()=>{
 const original="Base URL\nAPI Key\nModel ID",flat="Base URL · API Key · Model ID";
 const result=wikiBlockPresentation(fence(original));
 expect(result.decisions[0].mode).toBe("supplement");
 expect(result.body).toContain(fence(original));
 expect(wikiBlockPresentation(flat,{units:[unit(original)]}).body).toContain(fence(original));
 expect(wikiBlockPresentation(flat).body).toBe(flat);
});
it("rechecks saved grouped examples without changing distinct literals or personal source objects",()=>{
 const saved='## 配置\n\n自定义模式填写 Base URL、API Key 和 Model ID。\n\n<details data-atlas="atlas-wiki-supplement">\n<summary>原文与示例 · 2 项</summary>\n\n#### 1. 原文示例 · 字段\n\n'+fence('Base URL\nAPI Key\nModel ID')+'\n\n#### 2. 数据结构 · Payload\n\n'+fence('interface Payload { id: string }','ts')+'\n\n</details>';
 const result=wikiBlockPresentation(saved).body;
 expect(result).not.toContain(fence('Base URL\nAPI Key\nModel ID'));
 expect(result).toContain(fence('interface Payload { id: string }','ts'));expect(result).toContain('<summary>Payload 接口</summary>');
 expect(wikiBlockPresentation(result).body).toBe(result);
});

it("keeps one literal with a known version and preserves the unlabelled occurrence and citation",()=>{
 const payload=fence("Read a document\nSave its summary");
 const saved=`### Validation\n\n<details data-atlas="atlas-wiki-supplement">\n<summary>Reference examples · 2 items</summary>\n\n#### 1. Validation scenarios · v0\n\n${payload}\n\nSource [S-1-a]\n\n#### 2. Validation scenarios\n\n${payload}\n\nSource [S-2-b]\n\n</details>`;
 const output=wikiBlockPresentation(saved,{zh:false}).body;
 expect(output.split(payload)).toHaveLength(2);
 expect(output).toContain("Validation scenarios · v0 · Also appeared without a version label");
 expect(output).toContain("Source [S-1-a]");
 expect(output).toContain("Source [S-2-b]");
 expect(wikiBlockPresentation(output,{zh:false}).body).toBe(output);
 const ambiguous=saved.replace("#### 2. Validation scenarios",`#### 2. Validation scenarios · v1\n\n${payload}\n\n#### 3. Validation scenarios`);
 expect(wikiBlockPresentation(ambiguous,{zh:false}).body.split(payload)).toHaveLength(4);
});

it("suppresses mock dialogue previews, single-line endpoints and respects writingMode admission",()=>{
 const preview=fence("AI 助手             ● 已连接\nDeepSeek Chat\n\n准备修改设计\n↑ 温度阈值 → 32℃\n\n[撤销]");
 const saved='<details data-atlas="atlas-wiki-supplement">\n<summary>原文与示例 · 流程示例 · AI 助手 ● 已连接</summary>\n\n'+preview+'\n\n</details>';
 expect(wikiBlockPresentation(saved).body).not.toContain(preview);
 expect(wikiBlockPresentation(saved,{writingMode:"audit"}).body).toContain(preview);
 expect(planWikiSourceBlock({language:"text",text:"POST /api/generate"}).mode).toBe("source_only");
 expect(planWikiSourceBlock({language:"text",text:"tests/hardware-bench/"}).mode).toBe("source_only");
 const status="AI 助手 ● 已连接\nDeepSeek Chat";
 expect(planWikiSourceBlock({language:"text",text:status},"",[unit(status)]).mode).toBe("source_only");
 expect(planWikiSourceBlock({language:"ts",text:"interface Payload {\n  id: string;\n}"},"",[],"### 架构\n\n描述契约。","concise").mode).toBe("source_only");
 expect(planWikiSourceBlock({language:"ts",text:"interface Payload {\n  id: string;\n}"},"",[],"### 架构\n\n描述契约。","handoff").mode).toBe("supplement");
 expect(planWikiSourceBlock({language:"mermaid",text:"flowchart TD\n  A --> B"},"",[],"","concise").mode).toBe("verbatim");
});

it("reformats short UI copy, explicit field pairs and unbranched flows without inventing steps", () => {
  expect(wikiBlockPresentation(fence("请输入需求")).body).toContain(fence("请输入需求"));
  expect(wikiBlockPresentation(fence("请输入需求")).decisions[0].mode).toBe("supplement");
  expect(wikiBlockPresentation(fence("输入\n↓\n验证\n↓\n提交")).body).toBe("输入 → 验证 → 提交");
  const stages = ["自然语言", "Hardware IR", "硬件综合", "KiCad", "ERC检查", "AI修复", "Firmware"];
  const long = "*讨论中的原文代码 · AI 建议，未确认*\n\n" + fence(stages.join("\n ↓\n"));
  expect(wikiReadingFormat(long, {})).toBe(stages.join(" → ") + "〔建议〕");
  const reference = {...unit(stages.join("\r\n ↓\r\n")),about:{name:"Boardsmith",role:"reference" as const}};
  expect(wikiReadingFormat(long, {}, {units:[reference]})).toBe("**Boardsmith 参考流程**：" + stages.join(" → ") + "〔建议〕");
  expect(wikiBlockPresentation(fence("模式：\n架构\n来源：\n本地")).body).toBe("| 项目 | 内容 |\n| --- | --- |\n| 模式 | 架构 |\n| 来源 | 本地 |");
  expect(wikiBlockPresentation(fence("- 保留原文\n- 按需展开")).body).toBe("- 保留原文\n- 按需展开");
  const branch = fence("输入\n↓\n有效 → 提交\n无效 → 返回");
  expect(wikiBlockPresentation(branch).body).toContain(branch);
  expect(wikiBlockPresentation(branch).decisions[0].mode).toBe("supplement");
});

it("retains executable syntax and every byte in folded layouts, including blank runs and narration words", () => {
  const code = fence('const label = "此前建议";\n\n\nconst id = 7;', "ts");
  expect(wikiBlockPresentation(code).body).toContain(code);
  expect(wikiBlockPresentation(code).decisions[0].mode).toBe("supplement");
  const sketch = fence("┌────────┐\n│ + Fan │\n\n\n└────────┘");
  const result = wikiBlockPresentation("*界面草图*\n\n" + sketch);
  expect(result.body).toContain("<details data-atlas=\"atlas-wiki-supplement\">");
  expect(result.body).toContain(sketch);
  expect(result.decisions[0]).toMatchObject({ mode: "supplement", reason: expect.any(String), sourceSignature: expect.any(String) });
  expect(wikiBlockPresentation(result.body).body).toBe(result.body);
  expect(planWikiSourceBlock({ language: "json", text: '{"id":7}' }).mode).toBe("supplement");
  expect(planWikiSourceBlock({language:"ts",text:"interface Payload { id: string }"},"",[],"### 接口定义\n\nPayload 描述请求契约。").mode).toBe("verbatim");
  expect(planWikiSourceBlock({language:"ts",text:"interface Payload { id: string }"},"",[],"### 架构\n\nPayload 描述请求契约。").mode).toBe("supplement");
});

it("deduplicates the same process once and suppresses a source label that does not support its associated point", () => {
  const flow = fence("输入\n↓\n校验\n↓\n输出");
  const result = wikiBlockPresentation(flow + "\n\n补充说明。\n\n" + flow);
  expect(result.body.match(/输入 → 校验 → 输出/gu)).toHaveLength(1);
  expect(result.decisions[1]).toMatchObject({ mode: "source_only", reason: expect.stringContaining("already shown") });
  const wrong = "Ask about this design...", units = [unit(wrong, "面板默认显示 Architecture 页签。")];
  const projected = wikiBlockPresentation("面板默认显示 Architecture 页签。\n\n" + fence(wrong), { units });
  expect(projected.body).not.toContain(wrong);
  expect(projected.decisions[0]).toMatchObject({ mode: "source_only", unitIds: ["u"] });
  expect(units[0].evidence.code?.text).toBe(wrong);
});

it("restores damaged source only when saved originals prove the exact correction", () => {
  const original = fence("+ Fan\n+ MOSFET"), damaged = fence("+ 此前建议Fan\n+ 此前建议MOSFET");
  expect(restoreWikiLiteralPayloads(original, damaged)).toBe(original);
  expect(recoverWikiSourceLiterals(damaged, [unit("+ Fan\n+ MOSFET")])).toBe(original);
  expect(recoverWikiSourceLiterals(damaged, [unit("+ Fan\n+ Button")])).toBe(damaged);
  const before: WikiDraftChapter[] = [{ id: "c", title: "接口", question: "", group: "", problems: [], body: original, paragraphs: [{ text: original, subtopic: "s", unitIds: ["u"] }] }];
  const after = structuredClone(before); after[0].body = damaged; after[0].paragraphs[0].text = damaged;
  expect(restoreWikiChapterLiterals(before, after)[0].body).toBe(original);
  expect(after[0].body).toBe(damaged);
});

it("keeps personal and original chapters literal while projecting generated blocks", () => {
  const source = fence("输入\n↓\n输出");
  expect(wikiReadingFormat(source, { userEdited: true })).toBe(source);
  expect(wikiReadingFormat(source, { origin: "user" })).toBe(source);
  expect(wikiReadingFormat(source, {})).toBe("输入 → 输出");
});

it("coalesces saved formatting variants with source locators and keeps meaningful variants",()=>{
 const first=fence('interface Payload {\n  value: string;\n}',"ts"),second=fence('interface Payload {\n value: string;\n}',"ts");
 const body=`### API\n\n<details data-atlas="atlas-wiki-supplement">\n<summary>参考示例 · 3 项</summary>\n\n#### 1. Payload 接口\n\n${first}\n\n原文来源 [S-1-a]\n\n#### 2. Payload 接口\n\n${second}\n\n原文来源 [S-2-b]\n\n#### 3. 不同定义\n\n${fence('interface Payload { value: number; }',"ts")}\n\n</details>`;
 const result=wikiBlockPresentation(body).body;
 expect(result.match(/interface Payload/gu)).toHaveLength(2);
 expect(result).toContain(first);expect(result).toContain("[S-1-a]");expect(result).toContain("[S-2-b]");
 expect(wikiBlockPresentation(result).body).toBe(result);
 const versioned=body.replace("1. Payload 接口","1. Payload v1 接口").replace("2. Payload 接口","2. Payload v2 接口");
 expect(wikiBlockPresentation(versioned).body.match(/interface Payload/gu)).toHaveLength(3);
});
