export type HistoryIntent = "find" | "summarize" | "project" | "review";
export function historyRequest(value: string): { intent: HistoryIntent; query: string } {
  const intent: HistoryIntent = /(?:创建|建立|整理成|新建).{0,12}(?:项目|知识库)|(?:create|organize|build).{0,30}(?:project|workspace)/iu.test(value) ? "project"
    : /复习|回顾.{0,8}(?:知识|学习)|练习题|review|revise|quiz/iu.test(value) ? "review"
    : /总结|汇总|重要决定|关键决策|有哪些.{0,8}(?:决定|结论)|summari[sz]e|decisions/iu.test(value) || /(?:之前|以前|历史|跨对话).*(?:是什么|为什么|是否|如何|怎么|哪些)/u.test(value) && !/在哪里|哪条|哪段|找回|查找/u.test(value) ? "summarize" : "find";
  const topic = /(?:关于|有关(?:于)?)(.+?)(?:的(?:讨论|对话|记录)|(?:整理|创建|总结)|[，。？?]|$)/u.exec(value)?.[1]
    ?? /根据(?:我|之前|以前|过去|的|所有|这些|\s)*(.+?)(?:学习记录|学习对话|的讨论|的对话)/u.exec(value)?.[1];
  const personalTopic = /^(?:请)?(?:帮我)?(?:我)?(?:想要?|希望|打算)?(?:继续|完成|推进|做)(?:一下)?(?:我|我们)?(?:的)?(.+?)(?:项目)(?:[，,。？！?！]|$)/u.exec(value.trim())?.[1];
  const query = (topic ?? personalTopic ?? value).replace(/我之前在哪里讨论过|我在哪里讨论过|找回对话|找回|查找|寻找|帮我|给我|请|之前|以前|所有|历史|相关的|关于|有关|跨对话|总结|汇总|复习|整理成一个项目|创建项目|创建一个项目|的重要决定|有哪些重要决定|学习记录|的对话|的讨论/gu, " ")
    .replace(/\b(?:find|my|previous|conversations?|discussions?|summari[sz]e|create|project|review|about)\b/giu, " ").replace(/[，。？！?！：:「」“”]/gu, " ").replace(/\s+/gu, " ").trim().replace(/(?:的|中|过)$/u, "").trim();
  return { intent, query };
}

