import { expect, it } from "vitest";
import type { WikiKnowledgeUnit } from "../shared/wiki-knowledge";
import { applyWikiConfirmationScope, wikiConfirmationCovers, wikiConfirmationDetails } from "./wiki-confirmation-scope";

function unit(id: string, statement: string): WikiKnowledgeUnit {
  return { id, subject: "Setting", statement, kind: "plan", details: [], delivery: "unknown", adoption: { status: "proposal" },
    evidence: { evidenceId: id, conversationId: "source", messageId: id, messageIndex: 1, role: "assistant", pasted: false, quote: statement } };
}

it("separates a chosen technical direction from a proposed parameter in prose and table rows", () => {
  const decision = unit("direction", "Enable cache refresh."), proposal = unit("detail", "Cache refresh interval is 500 ms.");
  const scopes = [{ decision, proposal, choice: "Enable cache refresh" }];
  const prose = "Confirmed: enable cache refresh; cache refresh interval is 500 ms.";
  const table = "| Setting | Status |\n| --- | --- |\n| Cache refresh interval is 500 ms | Confirmed |";
  const result = applyWikiConfirmationScope(`${prose}\n\n${table}`, scopes, [decision], false);
  expect(result.text).toContain("Confirmed: enable cache refresh. AI proposal for the details: cache refresh interval is 500 ms.");
  expect(result.text).toContain("| Cache refresh interval is 500 ms | AI proposal, pending confirmation |");
  expect(result.edits[0].parts.map(part => part.unit?.id)).toEqual([decision.id, proposal.id]);
  expect(applyWikiConfirmationScope(result.text, scopes, [decision], false).edits).toEqual([]);
  expect(applyWikiConfirmationScope(table, scopes, [decision], false, new Set([table])).text).toBe(table);
  expect(applyWikiConfirmationScope(prose, scopes, [decision, unit("approved-value", proposal.statement)], false).text).toBe(prose);
  expect(applyWikiConfirmationScope(prose, scopes, [decision, unit("unrelated-value", "Request timeout is 500 ms.")], false).text).toBe(result.edits[0].parts.map(part => part.text).join(" "));
  const compoundRow = table.replace("Cache refresh interval is 500 ms | Confirmed", `${prose} | Confirmed`);
  expect(applyWikiConfirmationScope(compoundRow, scopes, [decision], false).text).toContain("Confirmed: enable cache refresh. AI proposal for the details: cache refresh interval is 500 ms. | AI proposal, pending confirmation");
});

it("keeps an unchosen trigger separate and labels an unsupported extension for review", () => {
  const decision = unit("direction", "开启自动重试机制。"), proposal = unit("trigger", "仅当设备校验通过，才自动重试失败任务。");
  const scopes = [{ decision, proposal, choice: "开启自动重试机制" }];
  const input = "已确认开启自动重试机制：仅当设备校验通过，才自动重试失败任务。";
  const result = applyWikiConfirmationScope(input, scopes, [decision], true);
  expect(result.text).toBe("已确认开启自动重试机制。AI 对具体细节的建议：仅当设备校验通过，才自动重试失败任务。");
  const unsupported = applyWikiConfirmationScope(input.replace("设备校验通过", "管理员授权"), scopes, [decision], true);
  expect(unsupported.text).toContain("以下细节待核对：仅当管理员授权");
  expect(unsupported.edits[0].parts[1].unit).toBeUndefined();
});

it("keeps unit, sign, comparator, and range attached to a value", () => {
  const detail = wikiConfirmationDetails("Upper bound ≤ -10 ms; window 20–30 days; $30");
  expect(wikiConfirmationCovers("Upper bound ≤ −10ms; window 20-30 days; $30", detail)).toBe(true);
  for (const wrong of ["Upper bound ≥ -10 ms", "Upper bound ≤ 10 ms", "Upper bound ≤ -10 px"]) {
    expect(wikiConfirmationCovers(`${wrong}; window 20–30 days; $30`, detail)).toBe(false);
  }
  expect(wikiConfirmationCovers("30 days", wikiConfirmationDetails("$30"))).toBe(false);
});

it("separates a separately proposed behavior with no numerical parameter", () => {
  const decision = unit("direction", "采用增量同步。");
  const proposal = unit("detail", "采用增量同步，同时上传诊断日志。");
  const scope = { decision, proposal, choice: "采用增量同步" };
  const result = applyWikiConfirmationScope(proposal.statement, [scope], [decision], true);
  expect(result.text).toBe("采用增量同步。AI 对具体细节的建议：同时上传诊断日志。");
  expect(result.edits[0].parts.map(part => part.unit?.id)).toEqual([decision.id, proposal.id]);
});

it("uses the confirmed wording when the original lead already includes an unchosen value", () => {
  const decision = unit("direction", "采用增量同步。");
  const proposal = unit("detail", "采用增量同步，刷新周期为 30 秒，同时上传诊断日志。");
  const input = "采用每 30 秒增量同步，同时上传诊断日志。";
  const result = applyWikiConfirmationScope(input, [{ decision, proposal, choice: "采用增量同步" }], [decision], true);
  expect(result.edits[0].parts[0]).toEqual({ text: decision.statement, unit: decision });
  expect(result.edits[0].parts[1].text).toContain("30 秒");
});

it("keeps a list item's marker ahead of the label and leaves a list the label already leads", () => {
  const decision = unit("direction", "开启自动重试机制。"), proposal = unit("trigger", "仅当设备校验通过，才自动重试失败任务。");
  const scopes = [{ decision, proposal, choice: "开启自动重试机制" }];
  const list = "- 已确认开启自动重试机制：仅当设备校验通过，才自动重试失败任务。\n- 失败记录保留七天。";
  const result = applyWikiConfirmationScope(list, scopes, [decision], true);
  expect(result.text.split("\n")[0]).toBe("- 已确认开启自动重试机制。AI 对具体细节的建议：仅当设备校验通过，才自动重试失败任务。");
  // Run again over what it wrote, as the export does: nothing more is labelled.
  expect(applyWikiConfirmationScope(result.text, scopes, [decision], true).text).toBe(result.text);
  const led = "AI 对具体细节的建议：\n- 已确认开启自动重试机制：仅当设备校验通过，才自动重试失败任务。";
  expect(applyWikiConfirmationScope(led, scopes, [decision], true).text).toBe(led);
});
