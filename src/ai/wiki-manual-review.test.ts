import { expect, it } from "vitest";
import { prepareManualWikiReview } from "./wiki-manual-review";
import { projectSession, projectText } from "../test/project-fixture";
import type { ConversationMessage } from "../shared/types";

it("locally rejects fabricated quotes without erasing the missing-anchor count or modifying prose", () => {
  const session = projectSession(); session.sections[0].claims = [
    {text: "先验证核心流程", quote: "先验证核心流程", evidenceIds:["e1"]},
    {text: "M2 已完成", quote: "M2 已完成", evidenceIds:["e1"]},
  ];
  const original: ConversationMessage = {id:"message",conversationId:"source",role:"user",content:projectText,messageIndex:0,preview:"",contentHash:"",createdAt:1,updatedAt:1};
  const next = prepareManualWikiReview(session,[original]);
  expect(next.sections[0].body).toBe(session.sections[0].body);
  expect(next.sections[0].claims).toHaveLength(1);
  expect(next.sections[0].evidenceReview).toMatchObject({mode:"manual",status:"partial",invalidClaims:1,totalClaims:2,checkedClaims:0});
  expect(session.sections[0].claims).toHaveLength(2);
});
