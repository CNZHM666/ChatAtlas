import { expect, it } from "vitest";
import type { WikiDraftChapter, WikiKnowledgeUnit } from "../shared/wiki-knowledge";
import { resolvedWikiFinalNotices } from "./wiki-final-notices";

const statement = "仅限离线模式，禁止上传用户原始文件。";
const unit: WikiKnowledgeUnit = { id: "privacy", subject: "隐私", statement, kind: "constraint", details: ["LOCAL_FILE_ONLY"], delivery: "unknown",
  adoption: { status: "proposal" }, evidence: { evidenceId: "e", conversationId: "c", messageId: "m", messageIndex: 1, role: "assistant", pasted: false, quote: statement } };
const chapter = (text: string, problem: string): WikiDraftChapter => ({ id: "c", title: "隐私", question: "", group: "", body: text, problems: [problem],
  paragraphs: [{ text, subtopic: "上传", unitIds: [unit.id], claims: [{ text, unitIds: [unit.id] }] }] });

it("clears a stale condition warning only when its full sourced condition is present in final prose", () => {
  const body = "仅限离线模式，禁止上传用户原始文件。";
  const warning = '"' + body.slice(0, 24) + '…" drops the condition "仅限离线模式，禁止上传" of k1; write every listed condition of a group';
  const original = chapter(body, warning), units = new Map([[unit.id, unit]]);
  expect(resolvedWikiFinalNotices(original, units, []).has(warning)).toBe(true);
  expect(resolvedWikiFinalNotices(original, units, [], "仅限离线模式，允许上传用户原始文件。").has(warning)).toBe(false);
  expect(resolvedWikiFinalNotices(original, units, [], "另一项要求。\n\n~~~text\n" + body + "\n~~~").has(warning)).toBe(false);
});

it("keeps an unsupported missing-detail warning, even if an unrelated block contains the identifier", () => {
  const text = "导出在本地完成。", warning = '"' + text + '…" drops the exact details LOCAL_FILE_ONLY';
  const original = chapter(text, warning), units = new Map([[unit.id, unit]]);
  expect(resolvedWikiFinalNotices(original, units, [], text + "\n\n另一项功能的 LOCAL_FILE_ONLY 开关。").has(warning)).toBe(false);
  expect(resolvedWikiFinalNotices(original, units, [], text + "支持 LOCAL_FILE_ONLY。").has(warning)).toBe(true);
});
