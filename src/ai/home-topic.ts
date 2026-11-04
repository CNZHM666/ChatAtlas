import { historyRequest } from "../search/home-history";
import { planMessageQuery } from "../search/message-query";

const generic = new Set("ai llm gpt project product discussion history summary summarize create organize review explain learn learning what how why previous final latest about all selected please want help me my the a an of to in work completion decision plan system model 我 想 要 之前 以前 有关 关于 历史 讨论 对话 总结 回顾 整理 创建 新建 项目 产品 系统 模型 学习 复习 知识 问题 内容 方案 设计 架构 路线 方法 步骤 方式 分析 解释 完成 继续 推荐 最终 最后 选择 决策 全部 所有 已选 所选 做 成 一个 学过 帮忙 准备 理解 验证 检查 部分 只 仅 一下 把 根据 具体 说明 展开 到 中 过 还 是否 目前 能够 可以 使用".split(" "));
// Technical aliases retain the subject; generic "AI" is never a hardware alias.
const equivalents = [
  ["硬件", "hardware", "电气", "电路", "gpio", "esp32", "arduino", "hardwareir"],
  ["自动化", "automation"], ["控制", "control", "反馈", "传递函数"],
  ["电气", "electrical", "gpio", "供电", "电压"], ["衰减", "decay"],
];
const normalize = (text: string) => text.normalize("NFKC").toLocaleLowerCase();
export interface HomeTopic { query: string; anchors: string[][] }
export function homeTopic(goal: string): HomeTopic {
  const query = historyRequest(goal.split(/\n追问[:：]/u)[0]).query.replace(/(?:总结)?历史讨论|我(?:想|要)?|(?:找回|总结|整理|创建|复习)(?:一下)?|(?:的)?(?:相关)?(?:对话|讨论)|[：:？?]/gu, " ").trim();
  const plan = planMessageQuery(query);
  const terms = [...plan.terms, ...plan.phrases].filter(term => !generic.has(term) && (term.length > 1 || /[a-z\d]/u.test(term)));
  return { query, anchors: terms.map(term => equivalents.find(group => group[0] === term || group[1] === term) ?? [term]) };
}
export function homeTopicMatches(topic: HomeTopic, text: string): boolean {
  const normalized = normalize(text);
  return topic.anchors.every(group => group.some(term => /[\p{Script=Han}]/u.test(term)
    ? normalized.includes(term) : new RegExp(`(?<![a-z0-9_])${term.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}(?![a-z0-9_])`, "u").test(normalized)));
}
/** Keep the original subject in retrieval even when a model proposes generic alternatives. */
export function groundedHomeQueries(goal: string, queries: string[]): string[] {
  const topic = homeTopic(goal);
  if (!topic.anchors.length) return queries;
  return [...new Set([topic.query, ...queries.filter(query => homeTopicMatches(topic, query))].filter(Boolean))].slice(0, 3);
}
export function explicitAllHomeSources(goal: string, sourceCount: number): boolean {
  return !/关于|有关|围绕|\babout\b/iu.test(goal) && /(?:全部|所有)(?:的)?(?:已选|所选)(?:的)?(?:对话|讨论|材料|来源)|\ball\s+(?:selected\s+)?(?:conversations?|discussions?|sources?|material)\b/iu.test(goal)
    || sourceCount === 1 && /(?:整条|完整|全文|整个).{0,12}(?:对话|讨论)|\b(?:entire|whole|full)\s+(?:conversation|discussion)\b/iu.test(goal) && !/关于|有关|\babout\b/iu.test(goal);
}
