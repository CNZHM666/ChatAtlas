export const WEB_CAPTURE_KEY = "atlas-web-capture-platforms";
export const WEB_CAPTURE_PAUSED_KEY = "atlas-web-capture-paused-platforms";
export const WEB_CAPTURE_PLATFORMS = [
  { id: "claude", name: "Claude", origin: "https://claude.ai", pattern: "https://claude.ai/*", path: /^\/chat\/([\w-]+)\/?$/u },
  { id: "gemini", name: "Gemini", origin: "https://gemini.google.com", pattern: "https://gemini.google.com/*", path: /^\/app\/([\w-]+)\/?$/u },
  { id: "deepseek", name: "DeepSeek", origin: "https://chat.deepseek.com", pattern: "https://chat.deepseek.com/*", path: /^\/(?:a\/chat\/s|chat)\/([\w-]+)\/?$/u },
  { id: "doubao", name: "豆包", origin: "https://www.doubao.com", pattern: "https://www.doubao.com/*", path: /^\/chat\/(\d+)\/?$/u },
  { id: "kimi", name: "Kimi", origin: "https://www.kimi.com", pattern: "https://www.kimi.com/*", path: /^\/chat\/([\w-]+)\/?$/u },
  { id: "qwen", name: "通义千问", origin: "https://www.qianwen.com", pattern: "https://www.qianwen.com/*", path: /^\/chat\/([\da-f]{32})\/?$/iu },
] as const;
export type WebCapturePlatform = typeof WEB_CAPTURE_PLATFORMS[number]["id"];
export interface WebCaptureStatus { platform: WebCapturePlatform; enabled: boolean; permitted: boolean }
const ALIASES: Array<{ platform: WebCapturePlatform; origin: string; path?: RegExp }> = [
  { platform: "kimi", origin: "https://kimi.com" },
  { platform: "kimi", origin: "https://kimi.moonshot.cn" },
  { platform: "qwen", origin: "https://chat.qwen.ai", path: /^\/c\/([\w-]+)\/?$/u },
];
export function webCapturePatterns(platform: WebCapturePlatform): string[] {
  return [webCapturePlatform(platform)!.pattern, ...ALIASES.filter(site => site.platform === platform).map(site => `${site.origin}/*`)];
}
export const allWebCapturePatterns=()=>WEB_CAPTURE_PLATFORMS.flatMap(site=>webCapturePatterns(site.id));
export type WebPageState = "ready" | "streaming" | "empty" | "unsupported" | "disconnected" | "disabled";
export interface WebPageInspection { state: WebPageState; conversationId?: string; messageCount: number }
export interface WebCaptureTab extends WebPageInspection { tabId: number; title: string; url: string }
export interface WebHistoryEntry { conversationId:string; title:string; url:string }
export interface WebHistoryPage { entries:WebHistoryEntry[]; scope:"loaded" }
export function webConversation(url: string) {
  const site = webCaptureSite(url);
  if (!site) return undefined;
  const address = new URL(url), nativeId = site.path.exec(address.pathname)?.[1];
  if (!nativeId || /^(new|new-chat|new-thread|login|share)$/iu.test(nativeId)) return undefined;
  // Regional Qwen and international Qwen use independent accounts/ID spaces.
  const prefix = site.id === "qwen" && site.origin !== "https://chat.qwen.ai" ? "qwen:cn" : site.id;
  return { site, id: `${prefix}:${nativeId}`, url: `${site.origin}${address.pathname}${site.id === "kimi" ? "?chat_enter_method=history" : ""}` };
}
export function webCapturePlatform(value: unknown) { return WEB_CAPTURE_PLATFORMS.find(item => item.id === value); }
export function enabledWebCapturePlatforms(value: unknown): WebCapturePlatform[] {
  return Array.isArray(value) ? WEB_CAPTURE_PLATFORMS.filter(item => value.includes(item.id)).map(item => item.id) : [];
}
export function webCaptureSite(url: string) {
  try {
    const address = new URL(url);
    const direct = WEB_CAPTURE_PLATFORMS.find(item => item.origin === address.origin);
    if (direct) return direct;
    const alias = ALIASES.find(item => item.origin === address.origin);
    return alias ? { ...webCapturePlatform(alias.platform)!, origin: alias.origin, path: alias.path ?? webCapturePlatform(alias.platform)!.path } : undefined;
  } catch { return undefined; }
}
