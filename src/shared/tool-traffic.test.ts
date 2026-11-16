import { expect, it } from "vitest";
import { isToolTrafficMessage, toolProtocolRanges } from "./tool-traffic";
import { messagePresentation } from "./message-ui";
import { normalizeHistoryConversation } from "../sync/chatgpt-normalizer";

const call = '{"path":"/files/read","args":{"read":[{"ref_id":"file","start_line":7}]}}';
it("filters actual execution messages and inline tool envelopes while retaining source offsets", async () => {
  const capture = await normalizeHistoryConversation({ id: "tools", current_node: "a", mapping: {
    command: { message: { id: "command", author: { role: "assistant" }, recipient: "python", content: { parts: ["print(1)"] } } },
    a: { parent: "command", message: { id: "a", author: { role: "assistant" }, recipient: "all", content: { parts: ["结果说明"] } } },
  } });
  expect(capture.messages[0].contentKind).toBe("tool");
  expect(isToolTrafficMessage(capture.messages[0])).toBe(true);
  expect(isToolTrafficMessage(capture.messages[1])).toBe(false);
  const content = `Before\n\n${call}\n\nAfter`;
  const parts = messagePresentation(content, undefined, false, true);
  expect(parts.map(part => part.kind === "text" ? part.text : "ui").join("")).toBe("Before\n\n\n\nAfter");
  expect(parts.at(-1)).toEqual({ kind: "text", text: "\n\nAfter", sourceStart: content.indexOf("\n\nAfter") });
});
it("does not mistake user examples, fenced tool JSON, or ordinary bash instructions for execution traffic", () => {
  expect(isToolTrafficMessage({ role: "user", content: call })).toBe(false);
  expect(messagePresentation(call, undefined, true)).toEqual([{ kind: "text", text: call }]);
  expect(toolProtocolRanges(`\`\`\`json\n${call}\n\`\`\``)).toEqual([]);
  expect(toolProtocolRanges("Run bash -lc ls to inspect the files.")).toEqual([]);
  expect(messagePresentation('{"path":"/api/save","args":{},"description":"API example"}', undefined)).toHaveLength(1);
  expect(toolProtocolRanges('{"path":"/api/save","args":{}}')).toEqual([]);
});
