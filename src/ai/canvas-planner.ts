import type { ConversationSemanticProfile, KnowledgeCanvas } from "../shared/types";

const stableDomains = ["数学", "英语", "控制与自动化", "编程与开源", "大学学习", "产品开发", "视觉设计", "生活与兴趣"];
const normalized = (value: string) => value.toLocaleLowerCase().replace(/[\s·与和及/_-]/gu, "");
const stableAliases: Record<string, string> = { 控制: "控制与自动化", 自动化: "控制与自动化", 编程: "编程与开源", 开源: "编程与开源" };
const stableTitle = (value: string) => stableDomains.find((domain) => normalized(domain) === normalized(value)) ?? stableAliases[normalized(value)] ?? value.trim();
export const stableId = (prefix: string, value: string) => `${prefix}-${[...normalized(value)].reduce((hash, character) => Math.imul(hash ^ character.codePointAt(0)!, 16777619) >>> 0, 2166136261).toString(36)}`;

export function planCanvases(profiles: ConversationSemanticProfile[], existing: KnowledgeCanvas[], now = Date.now()): KnowledgeCanvas[] {
  const existingByTitle = new Map(existing.map((canvas) => [normalized(canvas.title), canvas]));
  const counts = new Map<string, number>();
  for (const profile of profiles) for (const raw of profile.domains) {
    const title = stableTitle(raw);
    if (!title || /其他|杂项|待进一步|unknown/i.test(title)) continue;
    counts.set(title, (counts.get(title) ?? 0) + 1);
  }
  const candidates = [...counts].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([title]) => title);
  return candidates.map((title) => existingByTitle.get(normalized(title)) ?? {
    id: stableId("canvas-ai", title), title, description: `${title}中的概念、关系与对话来源`,
    type: "topic", origin: "ai", userEdited: false, createdAt: now, updatedAt: now,
  });
}
