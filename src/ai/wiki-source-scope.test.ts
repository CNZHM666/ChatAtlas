import { expect, it } from "vitest";
import type { WikiKnowledgeUnit } from "../shared/wiki-knowledge";
import { measuredSourceScope, sourceScopedUnit, sourceScopeConflict } from "./wiki-source-scope";

const quote = `例如先启用邮件提醒。\n\n观察两周。\n\n如果发现：\n\n原来的内测用户中，\n\n**50%+ 启用了邮件提醒**\n\n**30%+ 连续记录 7 天**`;
const broadened = "若原来的内测用户中超过50%启用所有新功能且30%连续记录7天，则判定扩展成功。";

const unit = (statement: string, original = quote): WikiKnowledgeUnit => ({ id: "u1", subject: "内测", statement, kind: "plan", details: [], delivery: "unknown", adoption: { status: "proposal" },
  evidence: { evidenceId: "e", conversationId: "c", messageId: "m", messageIndex: 1, role: "assistant", pasted: false, quote: original } });

it("restores the scope of a uniquely sourced experiment while retaining its evidence and proposal status", () => {
  const old = unit(broadened);
  const corrected = sourceScopedUnit(old);
  expect(corrected).toMatchObject({ id: old.id, evidence: old.evidence, adoption: old.adoption });
  expect(corrected.statement).toContain("观察两周");
  expect(corrected.statement).toContain("50%+ 启用了邮件提醒");
  expect(corrected.statement).toContain("30%+ 连续记录 7 天");
  expect(corrected.statement).not.toContain("扩展成功");
  expect(sourceScopeConflict(corrected.statement, [corrected])).toBe(false);
  expect(sourceScopedUnit(corrected)).toBe(corrected);
  const accepted = { ...old, adoption: { status: "user_adopted" as const } };
  expect(sourceScopedUnit(accepted)).toBe(accepted);
});

it("protects version, comparator and object for non-percentage limits", () => {
  const original = "Only for API v2 uploads, up to 20 MB per CSV file.";
  const units = [unit(original, original)];
  expect(sourceScopeConflict(original, units)).toBe(false);
  expect(sourceScopeConflict("For all uploads, up to 20 MB per CSV file.", units)).toBe(true);
  expect(sourceScopeConflict("Only for API v2 uploads, under 20 MB per CSV file.", units)).toBe(true);
  expect(sourceScopeConflict("Only for API v2 uploads, up to 20 MB per CSV file or video.", units)).toBe(true);
});

it("does not join matching amounts from different experiments or restore an ambiguous block", () => {
  const twice = `${quote}\n\n## 新方案\n\n${quote.replaceAll("邮件提醒", "短信提醒")}`;
  expect(measuredSourceScope(broadened, twice)).toEqual({ conflict: true, excerpt: undefined });
  const ambiguous = unit(broadened, twice);
  expect(sourceScopedUnit(ambiguous)).toBe(ambiguous);
  expect(measuredSourceScope(broadened, "如果50%启用邮件提醒。\n\n如果30%连续记录7天。")).toBeUndefined();
  expect(measuredSourceScope(broadened, `\`\`\`text\n${quote}\n\`\`\``)).toBeUndefined();
  expect(measuredSourceScope(broadened, "如果50%启用邮件提醒。\n系统会记录，30%连续记录7天是上月的数据。")).toBeUndefined();
});
