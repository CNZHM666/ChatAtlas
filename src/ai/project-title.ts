import { historyRequest } from "../search/history-request";

/** What is left of a request asking for a project from the chosen conversations, once it names nothing. */
const SELECTION_WORDS = /把|全部|所有|已选(?:的)?|选中(?:的)?|这些|对话|聊天|讨论|\b(?:a|an|the|all|from|selected|these|chosen|of)\b/giu;

/** A project's title when the run found no name for it. The request text was used: "把全部已选对话整理成一个项目", the
 * workbench's own button, became the project's title. A request naming its topic ("帮我整理成一个项目：专注计时器") gives
 * that topic; one only asking for a project gives the conversation's title, or the first one's and how many more. A goal
 * that is no such request ("番茄钟扩展第一版") stays the title. */
export function fallbackProjectTitle(goal: string, sourceTitles: string[], zh: boolean): string {
  const { intent, query } = historyRequest(goal);
  if (intent !== "project") return goal;
  const topic = query.replace(SELECTION_WORDS, " ").replace(/\s+/gu, " ").trim();
  if (topic.replace(/[\s\p{P}]/gu, "").length >= 2) return query.trim();
  const titles = sourceTitles.map(title => title.trim()).filter(Boolean);
  if (titles.length === 1) return titles[0];
  if (titles.length > 1) return zh ? `${titles[0]} 等 ${titles.length} 个对话` : `${titles[0]} and ${titles.length - 1} more`;
  return goal;
}
