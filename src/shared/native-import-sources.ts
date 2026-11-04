import type { NativeImportSource } from "./native-import";
import { webCaptureSite } from "./web-capture";

/** Several tabs of the same site/account slot are one choice. Regional Qwen
 * stays separate; Gemini's account selector is part of its source identity. */
export function nativeImportSources(tabs: chrome.tabs.Tab[]): NativeImportSource[] {
  const sources = new Map<string, NativeImportSource>();
  for (const tab of tabs) {
    if (tab.id === undefined || !tab.url) continue;
    try {
      const url = new URL(tab.url), site = webCaptureSite(tab.url);
      const platform = url.origin === "https://chatgpt.com" ? "chatgpt" : site?.id;
      if (!platform) continue;
      const slot = platform === "gemini" ? url.searchParams.get("authuser") ?? /^\/u\/(\d+)\//u.exec(url.pathname)?.[1] ?? "0" : "";
      const id = `${url.origin}${slot ? `:${slot}` : ""}`;
      const existing = sources.get(id);
      if (!existing || tab.active) sources.set(id, { id, origin: url.origin, platform, tabId: tab.id, label: platform === "chatgpt" ? "ChatGPT" : platform === "gemini" ? `Gemini · ${Number(slot) + 1}` : platform === "qwen" && url.hostname === "chat.qwen.ai" ? "Qwen 国际站" : site!.name });
    } catch { /* Restricted or navigating tabs are not import sources. */ }
  }
  return [...sources.values()];
}
