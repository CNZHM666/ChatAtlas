import { describe, expect, it } from "vitest";
import { readExportRecords, readExportZip, readImportRecords } from "./zip-import";
import { importerFor } from "./importers";

function zipWithStoredEntries(entries: Array<[string, string]>): File {
  const encoder = new TextEncoder();
  const encoded = entries.map(([name, json]) => ({ filename: encoder.encode(name), data: encoder.encode(json) }));
  const localLength = encoded.reduce((length, entry) => length + 30 + entry.filename.length + entry.data.length, 0);
  const centralLength = encoded.reduce((length, entry) => length + 46 + entry.filename.length, 0);
  const bytes = new Uint8Array(localLength + centralLength + 22);
  const view = new DataView(bytes.buffer);
  let local = 0;
  let central = localLength;
  for (const { filename, data } of encoded) {
    view.setUint32(local, 0x04034b50, true);
    view.setUint32(local + 18, data.length, true);
    view.setUint32(local + 22, data.length, true);
    view.setUint16(local + 26, filename.length, true);
    bytes.set(filename, local + 30);
    bytes.set(data, local + 30 + filename.length);
    view.setUint32(central, 0x02014b50, true);
    view.setUint32(central + 20, data.length, true);
    view.setUint32(central + 24, data.length, true);
    view.setUint16(central + 28, filename.length, true);
    view.setUint32(central + 42, local, true);
    bytes.set(filename, central + 46);
    local += 30 + filename.length + data.length;
    central += 46 + filename.length;
  }
  const end = central;
  view.setUint32(end, 0x06054b50, true);
  view.setUint16(end + 8, entries.length, true);
  view.setUint16(end + 10, entries.length, true);
  view.setUint32(end + 12, centralLength, true);
  view.setUint32(end + 16, localLength, true);
  return { name: "export.zip", arrayBuffer: async () => bytes.buffer } as File;
}

function zipWithStoredJson(name: string, json: string): File { return zipWithStoredEntries([[name, json]]); }

describe("ChatGPT export ZIP", () => {
  it("imports a stored conversations.json file", async () => {
    const file = zipWithStoredJson("conversations.json", JSON.stringify([{ id: "zip-1", title: "From ZIP", current_node: "m1", mapping: { m1: { id: "m1", parent: null, message: { id: "m1", author: { role: "user" }, content: { parts: ["Hello ZIP"] } } } } }]));
    const captures = [];
    for await (const capture of readExportZip(file)) captures.push(capture);
    expect(captures).toHaveLength(1);
    expect(captures[0].messages[0].content).toBe("Hello ZIP");
  });

  it("rejects files without a ZIP directory", async () => {
    const iterator = readExportZip({ name: "export.zip", arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer } as File);
    await expect(iterator.next()).rejects.toThrow("valid ZIP");
  });

  it("combines all conversations-*.json shards and ignores other archive entries", async () => {
    const file = zipWithStoredEntries([
      ["conversations-1.json", JSON.stringify([{ id: "part-1" }])],
      ["README.txt", "ignored"],
      ["nested/conversations-2.json", JSON.stringify([{ id: "part-2" }])],
    ]);
    const ids = [];
    for await (const raw of readExportRecords(file)) ids.push(raw.id);
    expect(ids).toEqual(["part-1", "part-2"]);
  });

  it("reads a 127-conversation official ZIP inventory", async () => {
    const records = Array.from({ length: 127 }, (_, index) => ({ id: `zip-${index}`, title: `Conversation ${index}` }));
    const ids = [];
    for await (const raw of readExportRecords(zipWithStoredJson("conversations.json", JSON.stringify(records)))) ids.push(raw.id);
    expect(ids).toHaveLength(127);
    expect(new Set(ids).size).toBe(127);
  });

  it("continues past a malformed shard and reports that shard", async () => {
    const errors: string[] = [];
    const ids = [];
    const file = zipWithStoredEntries([["conversations-1.json", "bad-json"], ["conversations-2.json", JSON.stringify([{ id: "safe" }])]]);
    for await (const raw of readExportRecords(file, (name) => errors.push(name))) ids.push(raw.id);
    expect(ids).toEqual(["safe"]);
    expect(errors).toEqual(["conversations-1.json"]);
  });

  it("imports JSON and TXT conversations under their original filenames in one ZIP",async()=>{
    const archive=zipWithStoredEntries([
      ["Qwen/my-original-export.json",JSON.stringify({platform:"qwen",messages:[{role:"user",content:"Qwen question"},{role:"assistant",content:"Qwen answer"}]})],
      ["Doubao/讨论记录.txt","用户：豆包问题\n豆包：豆包回答"],
      ["metadata.json",JSON.stringify({account:"not a conversation"})],
      ["README.txt","No conversation here"],
    ]);
    const captures=[];
    for await(const record of readImportRecords(archive))captures.push(await importerFor(record).normalize(record.raw,"revision",1_800_000_000_000));
    expect(captures.map(capture=>capture.conversation.platform)).toEqual(["qwen","doubao"]);
    expect(captures.map(capture=>capture.messages.map(message=>message.content))).toEqual([["Qwen question","Qwen answer"],["豆包问题","豆包回答"]]);
  });
});
