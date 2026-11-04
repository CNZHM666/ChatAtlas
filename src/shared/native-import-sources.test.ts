import { expect, it } from "vitest";
import { nativeImportSources } from "./native-import-sources";
it("deduplicates platform tabs while separating Qwen regions and Google account slots", () => {
  const sources = nativeImportSources([{ id: 1, url: "https://claude.ai/chat/a" }, { id: 2, active: true, url: "https://claude.ai/chat/b" }, { id: 3, url: "https://chat.qwen.ai/c/a" }, { id: 4, url: "https://www.qianwen.com/chat/a" }, { id: 5, url: "https://gemini.google.com/app?authuser=0" }, { id: 6, url: "https://gemini.google.com/app?authuser=1" }, { id: 7, url: "https://claude.ai.attacker.example" }] as chrome.tabs.Tab[]);
  expect(sources).toHaveLength(5); expect(sources[0].tabId).toBe(2);
  expect(sources.map(source => source.id)).toContain("https://gemini.google.com:1");
});
