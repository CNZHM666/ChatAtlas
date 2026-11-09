import { expect, it } from "vitest";
import type { WikiKnowledgeOrganization, WikiKnowledgeUnit } from "../shared/wiki-knowledge";
import { bareSetting, laterSettings, settingsOf } from "./wiki-later-settings";

const unit = (n: number, subject: string, statement: string, role: "user" | "assistant" = "assistant"): WikiKnowledgeUnit => ({ id: `u${n}`, subject, statement, kind: "constraint", details: [], adoption: { status: "proposal" }, delivery: "unknown", evidence: { evidenceId: `e${n}`, conversationId: "c", messageId: `m${n}`, messageIndex: n, role, pasted: false, quote: statement } });
const organization = (units: WikiKnowledgeUnit[]): WikiKnowledgeOrganization => ({ version: 1, generatedAt: 0, status: "complete", subjects: [{ id: "s", name: "界面", aliases: [], unitIds: units.map(item => item.id) }], merged: [], relations: [], report: {}, chapters: [] });
const replaced = (units: WikiKnowledgeUnit[], confirmed?: (id: string) => boolean) => laterSettings(organization(units), new Map(units.map(item => [item.id, item])), {}, confirmed).relations.map(relation => [relation.older, relation.newer, relation.kind]);

it("reads which property a measure sets", () => {
  expect([...settingsOf("中间放置宽约600～720px的输入框，Composer width 100% min-height 100~120px，200ms 左右的过渡")]).toEqual([["width", [[600, 720]]], ["height", [[100, 120]]], ["duration", [[200, 200]]]]);
  expect(bareSetting("padding 16px")).toBe(true);
  expect(bareSetting("title 24~28px")).toBe(true);
  expect(bareSetting("Mobile padding 16px")).toBe(false);
});

it("replaces an earlier value of one setting by the later one, on the same screen", () => {
  const landing = unit(24, "Landing Page", "采用大面积空白和极简Hero，中间放置宽约600～720px的输入框及CTA，下方仅展示三个Example Prompt。");
  const welcome = unit(97, "Welcome Screen", "采用极简设计，单一焦点，圆角极轻边框，无阴影；Desktop宽度100%，max-width 760~800px，min-height 110~130px。");
  const motion = unit(25, "Motion规范", "动画克制，允许hover、panel open等200ms左右的过渡，禁止大规模弹跳、光效、floating animation及gradient animation。");
  const micro = unit(98, "Micro Interactions", "动画必须克制，允许150~220ms的fade/translate及hover效果；严禁大型loading、卡片飞入、粒子、光晕、3D及大量打字机动画。");
  expect(replaced([landing, welcome, motion, micro])).toEqual([[landing.id, welcome.id, "replaces"], [motion.id, micro.id, "replaces"]]);
});

it("keeps apart settings of two screens, two parts, the same value, and the user's own words", () => {
  const toolbar = unit(37, "Top Toolbar", "顶部工具栏高度44~50px，左侧显示Hardware Canvas和项目名，右侧显示保存状态。");
  const header = unit(97, "Header", "高度约56~64px，左侧为Logo/Product name，右侧最多3个高权重action。");
  const composer = unit(98, "Welcome Screen", "采用极简设计，圆角极轻边框，无阴影；border-radius 20~26px，padding 16~20px。");
  const cards = unit(101, "组件卡片样式", "采用Compact Component Rows，边框1px，圆角10~12px，内边距14~16px，无阴影。");
  const mobile = unit(102, "Responsive Design", "Mobile padding 16px，标题24~28px，Chips允许换行。"), again = unit(103, "移动端适配", "Mobile优先可读，padding 16px，title 24~28px。");
  expect(replaced([toolbar, header, composer, cards, mobile, again])).toEqual([]);
  const said = unit(10, "Landing Page", "首页输入框宽约600～720px。", "user"), later = unit(20, "Welcome Screen", "首页 max-width 760~800px。");
  expect(replaced([said, later])).toEqual([]);
  const proposed = unit(11, "Landing Page", "首页输入框宽约600～720px。");
  expect(replaced([proposed, later], id => id === proposed.id)).toEqual([]);
  expect(replaced([proposed, later])).toEqual([[proposed.id, later.id, "replaces"]]);
});

it("replaces an earlier palette of one theme and a small screen served only in part", () => {
  const first = unit(24, "Dark Mode", "Dark 主背景 #0D0D0D，面板 #161616。"), second = unit(101, "Dark Mode", "Dark 背景色 #101011，面板 #151516。");
  const same = unit(120, "Dark Mode", "Dark 背景色 #101011，边框 #27272A。");
  expect(replaced([first, second, same])).toEqual([[first.id, second.id, "replaces"]]);
  const limited = unit(30, "Responsive", "V0.1 Desktop First，手机仅要求 Landing Page 正常。"), served = unit(90, "Mobile 适配", "Welcome/Discovery 优先支持移动端。");
  expect(replaced([limited, served])).toEqual([[limited.id, served.id, "replaces"]]);
});
