import { expect, it } from "vitest";
import { wikiDocumentIdentity, wikiDocumentIdentityBrief } from "./wiki-document-identity";
import type { WikiVerification } from "./wiki-explanations";

const verification = (status: WikiVerification["status"]) => ({ status, claims: { confirmed: 1, proposals: 2, unread: 0 }, openIssues: 1, implementation: "not_checked", sources: { conversations: 1, messages: 39 } }) as unknown as WikiVerification;

it("calls a learning record a learning record, checked or not, and leaves a project's wording as it was", () => {
  expect(wikiDocumentIdentity(verification("decisions_checked"), true, true)[0]).toBe("文档类型：学习记录（已按所选来源核对关键内容）。");
  expect(wikiDocumentIdentity(verification("history_digest"), true, true)[0]).toBe("文档类型：学习记录整理稿。内容已组织，但仍有部分内容未对照原文核对，另有 1 处待处理的表述问题。");
  expect(wikiDocumentIdentity(verification("decisions_checked"), true)[0]).toBe("文档类型：项目 Wiki（已按所选来源核对关键决定）。");
  expect(wikiDocumentIdentityBrief(verification("decisions_checked"), true, true).label).toBe("已核对关键内容");
});
