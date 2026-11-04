import type { Locale } from "./preferences";

const knowledgeCanvasTitles: Record<string, Record<Locale, string>> = {
  "总览": { en: "Overview", "zh-CN": "总览" },
  "My Atlas": { en: "My ChatAtlas", "zh-CN": "我的 ChatAtlas" },
  "My ChatAtlas": { en: "My ChatAtlas", "zh-CN": "我的 ChatAtlas" },
  "数学": { en: "Mathematics", "zh-CN": "数学" },
  "英语": { en: "English", "zh-CN": "英语" },
  "控制与自动化": { en: "Control & Automation", "zh-CN": "控制与自动化" },
  "编程与开源": { en: "Programming & Open Source", "zh-CN": "编程与开源" },
  "大学学习": { en: "University Studies", "zh-CN": "大学学习" },
  "产品开发": { en: "Product Development", "zh-CN": "产品开发" },
  "视觉设计": { en: "Visual Design", "zh-CN": "视觉设计" },
  "生活与兴趣": { en: "Life & Interests", "zh-CN": "生活与兴趣" },
};

export function localizeKnowledgeCanvasTitle(title: string, locale: Locale): string {
  const direct = knowledgeCanvasTitles[title];
  if (direct) return direct[locale];
  const translated = Object.values(knowledgeCanvasTitles).find((value) => value.en === title || value["zh-CN"] === title);
  return translated?.[locale] ?? title;
}

export function shortDomainTitle(label: string, locale: Locale): string {
  const limit = locale === "en" ? 26 : 12;
  const characters = [...label.trim()];
  if (characters.length <= limit) return label;
  const firstClause = label.split(/[与及和/·|]/u)[0].trim();
  if (firstClause.length >= 4 && [...firstClause].length <= limit) return firstClause;
  const initial = characters.slice(0, limit).join("");
  const wordBoundary = locale === "en" ? initial.lastIndexOf(" ") : -1;
  return `${wordBoundary > 12 ? initial.slice(0, wordBoundary) : initial}…`;
}
