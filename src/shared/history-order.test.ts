import { expect,it } from "vitest";
import { compareHistoryPositions,orderHistoryMessages } from "./history-order";
import { productReleaseMentions } from "./product-release-signals";
it("preserves native conversation order even when timestamps disagree and input/import order is reversed",()=>{
  const messages=[{id:"later",conversationId:"a",messageIndex:2,createdAt:1700000000000},{id:"earlier",conversationId:"a",messageIndex:1,createdAt:1700000005000},{id:"other",conversationId:"b",messageIndex:1,createdAt:1700000003000}];
  const ordered=orderHistoryMessages(messages);expect(ordered.indexOf(messages[1])).toBeLessThan(ordered.indexOf(messages[0]));expect(orderHistoryMessages([...messages].reverse())).toEqual(ordered);
});
it("does not compare missing, zero or equal cross-conversation timestamps",()=>{
  const a={conversationId:"a",messageId:"one",messageIndex:1,discussedAt:0},b={conversationId:"b",messageId:"two",messageIndex:2};
  expect(compareHistoryPositions(a,b)).toBeUndefined();expect(compareHistoryPositions({...a,discussedAt:1700000000000},{...b,discussedAt:1700000000000})).toBeUndefined();
});
it("ignores dependency versions and fenced code while retaining actual product versions",()=>{
  const text='React v18.2\nOrama version v3.1\n```ts\nconst version="v0.9"\n```\n我们的产品 v0.2 加入采购\nMilestone 3：公开测试';
  expect(productReleaseMentions(text).map(match=>match.label)).toEqual(["v0.2","Milestone 3"]);
});
