import type { ConversationCapture } from "../shared/types";
import type { RawConversation } from "./chatgpt-normalizer";
import { ChatGPTExportAdapter } from "./chatgpt-export-adapter";
import { isConversationEntry, recordsFromJson, recordsFromMarkdown, type ImportRecord } from "./importers";

const decoder = new TextDecoder();
const exportAdapter = new ChatGPTExportAdapter();

async function inflate(bytes: Uint8Array, method: number): Promise<string> {
  if (method === 0) return decoder.decode(bytes);
  if (method !== 8) throw new Error("Unsupported ZIP compression method.");
  const stream = new Blob([Uint8Array.from(bytes)]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return await new Response(stream).text();
}

function parseJson(text: string, name: string): unknown {
  try { return JSON.parse(text); }
  catch { throw new Error(`${name} is not valid JSON.`); }
}

function recordsFromText(text: string, name: string): ImportRecord[] | undefined {
  return /\.(?:md|markdown|txt)$/iu.test(name) ? recordsFromMarkdown(text, name) : recordsFromJson(parseJson(text, name), name);
}

const MARKDOWN_ENTRY = /\.(?:md|markdown|txt)$/iu;
const NO_CONVERSATIONS = "No conversations were found in this file. Choose an official AI export ZIP/JSON, or a Markdown/JSON transcript.";

/** Reads conversation files from ChatGPT, Claude, Gemini (Takeout), DeepSeek and
 * generic JSON/Markdown exports. Formats are detected by content, locally; no
 * network request or server upload occurs. */
export async function* readImportRecords(file: File, onEntryError?: (name: string, message: string) => void): AsyncGenerator<ImportRecord> {
  if (/\.(?:json|md|markdown|txt)$/iu.test(file.name)) {
    const records = recordsFromText(await file.text(), file.name);
    if (!records) throw new Error(NO_CONVERSATIONS);
    yield* records;
    return;
  }
  if (!/\.zip$/i.test(file.name)) throw new Error("Select an AI export ZIP, a JSON file or a Markdown transcript.");
  const buffer = await file.arrayBuffer();
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  let end = -1;
  for (let index = bytes.length - 22; index >= Math.max(0, bytes.length - 65557); index -= 1) {
    if (view.getUint32(index, true) === 0x06054b50) { end = index; break; }
  }
  if (end < 0) throw new Error("This file is not a valid ZIP export.");
  const count = view.getUint16(end + 10, true);
  let cursor = view.getUint32(end + 16, true);
  let found = 0;
  const entryErrors: string[] = [];
  for (let index = 0; index < count; index += 1) {
    if (view.getUint32(cursor, true) !== 0x02014b50) throw new Error("ZIP directory is damaged.");
    const flags = view.getUint16(cursor + 8, true);
    const method = view.getUint16(cursor + 10, true);
    const size = view.getUint32(cursor + 20, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const offset = view.getUint32(cursor + 42, true);
    const name = decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
    cursor += 46 + nameLength + extraLength + commentLength;
    if (!isConversationEntry(name) && !MARKDOWN_ENTRY.test(name)) continue;
    try {
      if (flags & 1) throw new Error("Encrypted ZIP exports are not supported.");
      if (view.getUint32(offset, true) !== 0x04034b50) throw new Error("ZIP entry is damaged.");
      const start = offset + 30 + view.getUint16(offset + 26, true) + view.getUint16(offset + 28, true);
      const records = recordsFromText(await inflate(bytes.subarray(start, start + size), method), name);
      // Other JSON/Markdown in an archive (account data, notes) is not an error.
      if (!records) continue;
      yield* records;
      found += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      entryErrors.push(message);
      onEntryError?.(name, message);
    }
  }
  if (!found) throw new Error(entryErrors[0] ?? NO_CONVERSATIONS);
}

/** ChatGPT-only view kept for existing callers: other platforms are omitted. */
export async function* readExportRecords(file: File, onEntryError?: (name: string, message: string) => void): AsyncGenerator<RawConversation> {
  for await (const record of readImportRecords(file, onEntryError)) if (record.platform === "chatgpt") yield record.raw as RawConversation;
}

/** Compatibility wrapper used by existing export tests and consumers. */
export async function* readExportZip(file: File): AsyncGenerator<ConversationCapture> {
  for await (const raw of readExportRecords(file)) yield await exportAdapter.normalizeConversation(raw);
}
