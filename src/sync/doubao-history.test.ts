import { expect, it, vi } from "vitest";
import { doubaoHistoryBody, doubaoHasMore, doubaoInteger } from "./doubao-history";
import { NativeHistoryAdapter } from "./native-history-adapter";
import type { NativeImportSource, NativeTransport } from "../shared/native-import";

const source = (): NativeImportSource => ({ id: "doubao", platform: "doubao", origin: "https://www.doubao.com", tabId: 1, label: "豆包", account: "same-account" });
const reply = (data: unknown) => ({ account: "same-account", data });
const page = (has_more: unknown, next_conv_version?: unknown) => ({ downlink_body: { pull_recent_conv_chain_downlink_body: { cells: [{ conversation: { conversation_id: "7891234567890123456", name: "Chat" } }], has_more, next_conv_version } } });

it.each([true, 1, "1", "true"])("accepts explicit true pagination marker %s", value => expect(doubaoHasMore(value)).toBe(true));
it.each([false, 0, "0", "false"])("accepts explicit false pagination marker %s", value => expect(doubaoHasMore(value)).toBe(false));
it.each([undefined, null, "", "unknown", 2])("refuses unknown pagination marker %s", value => expect(() => doubaoHasMore(value)).toThrow("has_more"));
it("decodes known IM response envelopes without treating missing fields as empty history", () => {
  expect(doubaoHistoryBody({ data: JSON.stringify(page(0)) }, "pull_recent_conv_chain_downlink_body")).toMatchObject({ has_more: 0 });
  expect(() => doubaoHistoryBody({}, "pull_recent_conv_chain_downlink_body")).toThrow("downlink_body");
  expect(() => doubaoHistoryBody({ status_code: "712010702", status_desc: "private server message" }, "pull_recent_conv_chain_downlink_body")).toThrow("712010702");
  try { doubaoHistoryBody({ status_code: "712010702", status_desc: "private server message" }, "pull_recent_conv_chain_downlink_body"); } catch (error) { expect(String(error)).not.toContain("private server message"); }
});
it("keeps int64 conversation IDs and pagination cursors exact", async () => {
  const transport = vi.fn<NativeTransport>().mockResolvedValueOnce(reply(page("1", "7891234567890123457"))).mockResolvedValueOnce(reply(page("0")));
  const adapter = new NativeHistoryAdapter(source(), transport);
  const first = await adapter.list(), last = await adapter.list(first.next);
  expect(first.conversations[0].id).toBe("doubao:7891234567890123456");
  expect(first.next).toBe("7891234567890123457"); expect(last.next).toBeUndefined();
  const body = transport.mock.calls[1][1].body as { uplink_body: { pull_recent_conv_chain_uplink_body: { conv_version: string; option: { need_coco_conversation: boolean; need_coco_bot: boolean } } } };
  expect(body.uplink_body.pull_recent_conv_chain_uplink_body).toMatchObject({ conv_version: "7891234567890123457", option: { need_coco_conversation: false, need_coco_bot: false } });
  expect(() => doubaoInteger(Number("7891234567890123456"), "cursor")).toThrow("精度");
});
it("reads string roles and index_in_conv across every older message page", async () => {
  const wrap = (messages: unknown[], has_more: unknown) => reply({ downlink_body: { pull_singe_chain_downlink_body: { messages, has_more } } });
  const row = (id: string, index: string, role: string, text: string) => ({ message_id: id, index_in_conv: index, user_type: role, content: JSON.stringify({ text }) });
  const transport = vi.fn<NativeTransport>().mockResolvedValueOnce(wrap([row("a2", "4", "2", "Answer 2"), row("u2", "3", "1", "Question 2")], "1")).mockResolvedValueOnce(wrap([row("a1", "2", "2", "Answer 1"), row("u1", "1", "1", "Question 1")], "0"));
  const capture = await new NativeHistoryAdapter(source(), transport).detail({ id: "doubao:123", platform: "doubao", title: "Chat", updatedAt: 1, url: "", messageCount: null });
  expect(capture.messages.map(message => message.content)).toEqual(["Question 1", "Answer 1", "Question 2", "Answer 2"]);
  expect(capture.conversation.historyCoverage).toBe("complete");
  expect(transport.mock.calls[1][1].body).toMatchObject({ uplink_body: { pull_singe_chain_uplink_body: { anchor_index: "2" } } });
});
it("rejects missing continuation data while preserving complete-history semantics", async () => {
  const adapter = new NativeHistoryAdapter(source(), async () => reply(page(true)));
  await expect(adapter.list()).rejects.toThrow("next_conv_version");
});
