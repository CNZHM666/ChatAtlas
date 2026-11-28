/** Display names for conversation source platforms. Stored IDs stay lowercase
 * and unchanged; unknown IDs from generic imports are shown as written. */
const NAMES: Record<string, string> = {
  chatgpt: "ChatGPT", claude: "Claude", gemini: "Gemini", deepseek: "DeepSeek", kimi: "Kimi", doubao: "豆包",
  qwen: "通义千问", grok: "Grok", perplexity: "Perplexity", copilot: "Copilot", mistral: "Mistral", yuanbao: "元宝", zhipu: "智谱 GLM",
};
const ENGLISH: Record<string, string> = { doubao: "Doubao", qwen: "Qwen", yuanbao: "Yuanbao", zhipu: "GLM" };

export function platformName(platform: string, locale: "zh-CN" | "en" | string = "zh-CN"): string {
  platform = conversationPlatformGroup(platform);
  if (platform === "other" || platform === "generic") return locale === "zh-CN" ? "其他 AI" : "Other AI";
  return (locale !== "zh-CN" && Object.hasOwn(ENGLISH,platform) ? ENGLISH[platform] : undefined) ?? (Object.hasOwn(NAMES,platform) ? NAMES[platform] : platform);
}

const PLATFORM_ALIASES: Record<string,string> = { generic:"other", moonshot:"kimi", tongyi:"qwen", qianwen:"qwen", "千问":"qwen", "豆包":"doubao", "通义":"qwen", "通义千问":"qwen", "元宝":"yuanbao", "腾讯元宝":"yuanbao", chatglm:"zhipu", glm:"zhipu", "智谱清言":"zhipu", "智谱glm":"zhipu", "智谱 glm":"zhipu" };
export function conversationPlatformGroup(platform: string): string {
  const id=platform.trim().toLowerCase();
  return Object.hasOwn(PLATFORM_ALIASES,id) ? PLATFORM_ALIASES[id] : Object.hasOwn(NAMES,id) || id === "other" ? id : platform;
}

const TITLE_BRANDS: Record<string, string[]> = { claude: ["Claude AI"], gemini: ["Google Gemini"], kimi: ["Kimi AI"], qwen: ["千问", "Qwen 国际站"] };

/** Strip a browser's platform decoration when the interface already identifies the source. */
export function conversationDisplayTitle(title: string, platform: string): string {
  const id = conversationPlatformGroup(platform);
  if (!id) return title.trim();
  const aliases = Object.hasOwn(TITLE_BRANDS, id) ? TITLE_BRANDS[id] : [];
  const brands = new Set([platform, platformName(id, "zh-CN"), platformName(id, "en"), ...aliases].map(name => name.toLowerCase()));
  const parts = title.trim().split(/(\s+[-–—|·｜]\s+)/u);
  while (parts.length && brands.has(parts[0].toLowerCase())) parts.splice(0, 2);
  while (parts.length && brands.has(parts[parts.length - 1].toLowerCase())) parts.splice(-2, 2);
  return parts.join("");
}

/** Map a free-form label (exporter metadata, Markdown speaker) to a known platform ID. */
export function platformFromLabel(label: unknown): string | undefined {
  if (typeof label !== "string") return undefined;
  const value = label.toLowerCase();
  if (/chatgpt|openai|gpt-?\d/u.test(value)) return "chatgpt";
  if (/claude|anthropic/u.test(value)) return "claude";
  if (/gemini|bard/u.test(value)) return "gemini";
  if (/deepseek/u.test(value)) return "deepseek";
  if (/kimi|moonshot/u.test(value)) return "kimi";
  if (/doubao|豆包/u.test(value)) return "doubao";
  if (/qwen|qianwen|tongyi|通义|千问/u.test(value)) return "qwen";
  if (/grok/u.test(value)) return "grok";
  if (/perplexity/u.test(value)) return "perplexity";
  if (/copilot/u.test(value)) return "copilot";
  if (/mistral|le chat/u.test(value)) return "mistral";
  if (/yuanbao|元宝/u.test(value)) return "yuanbao";
  if (/chatglm|智谱|zhipu|(?:^|[^a-z])glm(?:[-_.\d]|$)/u.test(value)) return "zhipu";
  return undefined;
}

/** Items grouped by their AI, in the order each AI first appears; one group when they all come from one AI. */
export function platformGroups<T extends { platform: string }>(items: readonly T[]): Array<{ platform: string; items: T[] }> {
  const groups = new Map<string, T[]>();
  for (const item of items) { const key = conversationPlatformGroup(item.platform); groups.set(key, [...groups.get(key) ?? [], item]); }
  return [...groups].map(([platform, members]) => ({ platform, items: members }));
}
