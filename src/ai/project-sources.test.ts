import { expect, it } from "vitest";
import { projectOriginalSources } from "./project-sources";
import { projectFixture } from "../test/project-fixture";
import type { ConversationMessage } from "../shared/types";

it("includes distant original interfaces and merges overlapping citation windows", () => {
  const ref = projectFixture.evidence[0];
  const content = ref.excerpt + "背景记录。".repeat(900) + "Hardware IR将方案提交给规则校验，规则校验反馈给方案规划。输出：校验结果。" + "后续记录。".repeat(900);
  const raw = { id: ref.messageId, conversationId: ref.conversationId, content, role: "assistant", messageIndex: 1, createdAt: 1 } as ConversationMessage;
  const result = projectOriginalSources({ ...projectFixture, mode: "work" }, [raw]);
  expect(result).toHaveLength(1);
  expect(result[0].text).toContain("Hardware IR将方案提交给规则校验，规则校验反馈给方案规划。");
  expect(result[0].text.match(/规则校验反馈给方案规划/gu)).toHaveLength(1);
  expect(result[0].partial).toBe(false);
  expect(projectOriginalSources({ ...projectFixture, mode: "work", scope: { kind: "goal", blocks: [] } }, [raw])).toEqual([]);
  expect(projectOriginalSources({ ...projectFixture, mode: "work", sourceConversationIds: [] }, [raw])).toEqual([]);
});
