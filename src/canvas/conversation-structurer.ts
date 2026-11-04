import type { Conversation, ConversationChapter, ConversationMessage, QuestionRelation } from "../shared/types";
import type { EpisodePlan } from "../ai/context-episodes";

export interface ConversationStructure {
  chapters: ConversationChapter[];
  episodePlans?: EpisodePlan[];
  questionRelations: QuestionRelation[];
  bridges?: Array<{ fromOrder: number; toOrder: number; explanation: string; questionIds: string[] }>;
  freeCards?: Array<{ afterOrder: number; type: "insight" | "draft"; title: string; body?: string; questionIds: string[] }>;
}

export interface ConversationStructurer {
  buildChapters(conversation: Conversation, messages: ConversationMessage[]): Promise<ConversationStructure>;
}

const themes = [
  { title: "示波器实验准备", signal: /示波器.*(实验|准备)|实验.*示波器|oscilloscope.*(lab|experiment)/i },
  { title: "实验图示与装置", signal: /图\s*[一二12]|图示|装置.*区别|实验图|diagram.*experiment/i },
  { title: "示波器初始调节", signal: /示波器.*(调|设置|校准)|咋调|怎么调|oscilloscope.*(adjust|setup)/i },
  { title: "信号发生器设置", signal: /发生器.*(设置|调|频率|幅值)|signal generator/i },
  { title: "产品定位", signal: /产品定位|目标用户|用户需求|商业模式|定位|愿景|product strategy|positioning/i },
  { title: "Canvas 架构", signal: /canvas|画布|节点|卡片|连线|结构|布局|topic card/i },
  { title: "导入与同步", signal: /导入|同步|历史对话|web session|连接失败|zip|import|sync|session/i },
  { title: "AI 自动整理", signal: /自动整理|分章|分类|聚类|主题识别|organize|categor/i },
  { title: "交互优化", signal: /交互|体验|侧边栏|按钮|视觉|界面|ux|ui|design/i },
  { title: "知识关系", signal: /知识关系|知识图谱|依赖关系|问题关系|knowledge graph|semantic relation/i },
  { title: "工程实现", signal: /代码|函数|实现|报错|调试|python|typescript|react|api|debug/i },
  { title: "课程学习规划", signal: /学习|课程|考试|研究|数学|物理|learn|study|research/i },
  { title: "生活与兴趣", signal: /生活|旅行|健康|饮食|家庭|travel|health|food/i },
];

export function questionDisplayTitle(original: string): string {
  const text = original.replace(/^(?:\s*@[\p{L}\p{N}_-]+\s*)+/u, "").replace(/\s+/gu, " ").trim();
  const cleaned = text
    .replace(/^(?:(?:请|麻烦|能否|可以|请问|帮我|你帮我|给我|帮忙|我想|我希望)\s*)+/u, "")
    .replace(/^(?:分析|解释|讨论|整理|总结|看看|说说)(?:一下|下)?\s*/u, "")
    .replace(/^(?:一下|一下子|关于|我关于)\s*/u, "").trim();
  const layout = cleaned.match(/(界面|画布|面板|区域|按钮).{0,20}(太小|太大|偏左|偏右|不居中|尺寸|布局)/u);
  if (layout && /优化|改进|调整|怎么|如何|方案/u.test(cleaned)) return `${layout[1]}${/偏左|偏右|不居中/u.test(layout[2]) ? "对齐" : "尺寸与布局"}优化`;
  const clause = cleaned.split(/[。！？?!；;\n]/u)[0].split(/，(?=.{18})/u)[0].replace(/(?:怎么做|如何做|是什么|怎么办|可以吗|行不行)[吗呢]?[？?]?$/u, "").trim();
  const title = clause || text || "未命名问题";
  return [...title].length > 24 ? `${[...title].slice(0, 23).join("")}…` : title;
}

function themeOf(text: string): string | null {
  return themes.find((theme) => theme.signal.test(text))?.title ?? null;
}

function terms(text: string): Set<string> {
  const normalized = text.toLocaleLowerCase().replace(/\s+/g, " ");
  const words = normalized.match(/[a-z][a-z0-9_-]{2,}/g) ?? [];
  const han = normalized.match(/[\p{Script=Han}]{2,}/gu) ?? [];
  return new Set([...words, ...han.flatMap((phrase) => [...phrase].slice(0, -1).map((_, index) => phrase.slice(index, index + 2)))]);
}

function similarity(a: string, b: string): number {
  const left = terms(a);
  const right = terms(b);
  if (!left.size || !right.size) return 0;
  return [...left].filter((term) => right.has(term)).length / Math.min(left.size, right.size);
}

const genericChapterTitle = /^(其他|杂项|学习研究|继续讨论|阶段主题|阶段主题梳理|一些问题|问题|这个怎么做|继续|other|misc|general|continued discussion)$/iu;
const questionLikeChapterTitle = /[？?]$|^(你|我|我们|这个|那个|有没有|能不能|是否|如何|怎么|为什么|请问|可以|能否)/u;

export function cleanChapterTitle(rawTitle: string, context = ""): string {
  let title = rawTitle.replace(/^\s*\d+[.、：:\s-]*/u, "").replace(/[？?。.!！]+$/u, "").trim();
  if (!title || genericChapterTitle.test(title) || questionLikeChapterTitle.test(title)) title = themeOf(context) ?? questionDisplayTitle(context || title);
  title = title.replace(/^(你|我|我们|这个|那个|有没有|能不能|是否|如何|怎么|为什么|请问|可以|能否)/u, "").replace(/(怎么做|如何做|有什么|是什么|吗|呢)$/u, "").trim();
  if (!title || genericChapterTitle.test(title) || [...title].length < 2) title = themeOf(context) ?? "讨论要点";
  return [...title].slice(0, 12).join("");
}

function chapterKey(title: string, context: string): string {
  const themed = themeOf(`${title} ${context}`);
  return (themed ?? title).toLocaleLowerCase().replace(/[\s·—_\-与和及、，,:：]/gu, "").replace(/(相关|主题|方案|设计|实现)$/u, "");
}

function conciseChapterSummary(title: string, contexts: string[], provided?: string): string {
  const summaries: Record<string, string> = {
    "产品定位": "讨论产品目标、目标用户、竞品差异与核心使用场景。",
    "产品定位与竞品差异": "讨论产品目标、竞品差异与核心使用场景。",
    "Canvas 架构": "梳理画布的信息层级、节点结构与交互布局。",
    "导入与同步": "聚焦历史对话导入、同步状态与异常恢复。",
    "AI 自动整理": "聚焦自动分章、主题归纳与结构质量控制。",
    "交互优化": "改善信息层级、导航效率与界面可读性。",
    "知识关系": "梳理知识节点之间的重要关系与演进路径。",
    "工程实现": "覆盖核心功能实现、调试与工程验证。",
  };
  const cleanProvided = provided?.replace(/\s+/gu, " ").trim();
  if (cleanProvided && !/^本阶段围绕/u.test(cleanProvided) && cleanProvided !== title) return cleanProvided.slice(0, 120);
  if (summaries[title]) return summaries[title];
  const labels = [...new Set(contexts.map(questionDisplayTitle).filter(Boolean))].slice(0, 2);
  return labels.length ? `${labels.join("、")}。` : `${title}的关键问题与结论。`;
}

export interface ChapterGroupDraft {
  title: string;
  summary?: string;
  questionIds: string[];
}

/** Keep chapters in the original reading order; merge only contiguous neighbors. */
export function refineChapterGroups(groups: ChapterGroupDraft[], questionContexts: Map<string, string>, options: { minimumGroups?: number } = {}): ChapterGroupDraft[] {
  const questionOrder = new Map([...questionContexts.keys()].map((id, index) => [id, index]));
  const merged: Array<ChapterGroupDraft & { key: string; contexts: string[] }> = [];
  groups.forEach((group, groupIndex) => {
    const questionIds = [...new Set(group.questionIds)].filter((id) => questionContexts.has(id));
    if (!questionIds.length) return;
    const contexts = questionIds.map((id) => questionContexts.get(id) ?? "");
    const context = contexts.join(" ");
    const title = cleanChapterTitle(group.title, context);
    const key = chapterKey(title, context);
    const remainingGroups = groups.length - groupIndex - 1;
    const mayMerge = merged.length + remainingGroups >= (options.minimumGroups ?? 1);
    const candidate = merged.at(-1);
    const adjacent = candidate && (questionOrder.get(questionIds[0]) ?? -1) === (questionOrder.get(candidate.questionIds.at(-1) ?? "") ?? -2) + 1;
    const existing = mayMerge && adjacent ? [candidate].find((candidate) => {
      const candidateNumbers = candidate.title.match(/\d+/gu)?.join(",") ?? "";
      const titleNumbers = title.match(/\d+/gu)?.join(",") ?? "";
      const distinctNumberedTopics = candidateNumbers && titleNumbers && candidateNumbers !== titleNumbers;
      return candidate.key === key || !distinctNumberedTopics && similarity(candidate.title, title) >= .72;
    }) : undefined;
    if (existing) {
      existing.questionIds = [...new Set([...existing.questionIds, ...questionIds])];
      existing.contexts.push(...contexts);
      existing.title = cleanChapterTitle(existing.title, existing.contexts.join(" "));
      existing.key = chapterKey(existing.title, existing.contexts.join(" "));
    } else merged.push({ title, summary: group.summary, questionIds, key, contexts });
  });
  merged.forEach((group) => group.questionIds.sort((a, b) => (questionOrder.get(a) ?? Number.MAX_SAFE_INTEGER) - (questionOrder.get(b) ?? Number.MAX_SAFE_INTEGER)));
  merged.sort((a, b) => (questionOrder.get(a.questionIds[0]) ?? Number.MAX_SAFE_INTEGER) - (questionOrder.get(b.questionIds[0]) ?? Number.MAX_SAFE_INTEGER));
  return merged.map((group) => ({ title: group.title, summary: conciseChapterSummary(group.title, group.contexts, group.summary), questionIds: group.questionIds }));
}

function maxChapterCount(questionCount: number): number {
  if (questionCount <= 12) return 4;
  if (questionCount <= 25) return 6;
  return 9;
}

function minChapterCount(questionCount: number): number {
  if (questionCount <= 12) return 2;
  if (questionCount <= 25) return 3;
  return 5;
}

function groupAffinity(left: { theme: string | null; questions: ConversationMessage[] }, right: { theme: string | null; questions: ConversationMessage[] }): number {
  const themeBonus = left.theme && left.theme === right.theme ? 2 : 0;
  const lexical = similarity(left.questions.map((item) => item.content).join(" "), right.questions.map((item) => item.content).join(" "));
  const singletonBonus = left.questions.length === 1 || right.questions.length === 1 ? 0.75 : 0;
  return themeBonus + lexical + singletonBonus - (left.questions.length + right.questions.length) * 0.015;
}

function mergeBestNeighbors(groups: Array<{ theme: string | null; questions: ConversationMessage[] }>): void {
  if (groups.length < 2) return;
  let best = 0;
  let bestScore = -Infinity;
  for (let index = 0; index < groups.length - 1; index += 1) {
    const score = groupAffinity(groups[index], groups[index + 1]);
    if (score > bestScore) { best = index; bestScore = score; }
  }
  const right = groups[best + 1];
  groups[best].questions.push(...right.questions);
  if (!groups[best].theme || groups[best].questions.length - right.questions.length < right.questions.length) groups[best].theme = right.theme ?? groups[best].theme;
  groups.splice(best + 1, 1);
}

function chapterTitle(group: { theme: string | null; questions: ConversationMessage[] }): string {
  const text = group.questions.map((item) => item.content).join(" ");
  const contextualTheme = themeOf(text);
  if (contextualTheme) return contextualTheme;
  let title = questionDisplayTitle(group.questions[0]?.content ?? "").replace(/^(咋|怎么|如何|请问|这个|那个)/u, "").replace(/(怎么|如何|有什么)?[吗呢？?]$/u, "").trim();
  title = title.split(/[，,:：]/u)[0].trim();
  if (!title || /^(其他|继续讨论|一些问题|问题|调)$/u.test(title)) title = "阶段主题梳理";
  const characters = [...title];
  if (characters.length < 4) title = `${title}相关设置`;
  if ([...title].length > 12) title = [...title].slice(0, 12).join("");
  return title;
}

/** Deterministic local fallback; categories and lexical overlap find topic shifts, never time buckets. */
export function buildConversationStructure(conversation: Conversation, messages: ConversationMessage[], now = Date.now()): ConversationStructure {
  const questions = messages.filter((message) => message.role === "user").sort((a, b) => a.messageIndex - b.messageIndex);
  if (questions.length <= 3) return { chapters: [], questionRelations: [] };
  const groups: Array<{ theme: string | null; questions: ConversationMessage[] }> = [];
  for (const question of questions) {
    const theme = themeOf(question.content);
    const latest = groups.at(-1);
    const related = latest && (theme ? latest.theme === theme : !latest.theme && similarity(question.content, latest.questions.map((item) => item.content).join(" ")) >= .34) ? latest : undefined;
    if (related) related.questions.push(question);
    else groups.push({ theme, questions: [question] });
  }
  // A return to an earlier topic is a new reading stage, preserving the path of discussion.
  const maximum = maxChapterCount(questions.length);
  while (groups.length > maximum || groups.length > 1 && groups.some((group) => group.questions.length === 1) && groups.length > Math.ceil(questions.length / 4)) mergeBestNeighbors(groups);
  const minimum = minChapterCount(questions.length);
  while (groups.length < minimum) {
    const index = groups.reduce((largest, group, position) => group.questions.length > groups[largest].questions.length ? position : largest, 0);
    const group = groups[index];
    if (group.questions.length < 2) break;
    const splitAt = Math.ceil(group.questions.length / 2);
    groups.splice(index, 1, { theme: group.theme, questions: group.questions.slice(0, splitAt) }, { theme: group.theme, questions: group.questions.slice(splitAt) });
  }
  const questionContexts = new Map(questions.map((question) => [`conversation-message-${question.id}`, question.content]));
  const refinedGroups = refineChapterGroups(groups.map((group) => ({
    title: chapterTitle(group),
    questionIds: group.questions.map((question) => `conversation-message-${question.id}`),
  })), questionContexts, { minimumGroups: minimum });
  const chapters = refinedGroups.map<ConversationChapter>((group, order) => ({
    id: `conversation-chapter-${conversation.id}-${order + 1}`,
    conversationId: conversation.id,
    title: group.title,
    summary: group.summary,
    questionIds: group.questionIds,
    order,
    collapsed: true,
    source: "auto",
    createdAt: now,
    updatedAt: now,
  }));
  const questionRelations: QuestionRelation[] = [];
  for (const group of groups) for (let index = 1; index < group.questions.length; index += 1) {
    const question = group.questions[index];
    const previous = group.questions[index - 1];
    const earlier = group.questions.slice(0, index - 1).find((item) => /回到|再说|之前|back to|return to/i.test(question.content) && similarity(item.content, question.content) >= 0.3);
    if (earlier) questionRelations.push({ sourceId: `conversation-message-${earlier.id}`, targetId: `conversation-message-${question.id}`, type: "return" });
    else if (/换个|另一种|分支|另外|alternatively|branch/i.test(question.content)) questionRelations.push({ sourceId: `conversation-message-${previous.id}`, targetId: `conversation-message-${question.id}`, type: "branch" });
    else if (/继续|接着|然后|那|这个|上面|continue|then/i.test(question.content) && similarity(previous.content, question.content) >= 0.18) questionRelations.push({ sourceId: `conversation-message-${previous.id}`, targetId: `conversation-message-${question.id}`, type: "continue" });
  }
  return { chapters, questionRelations };
}

export class DeterministicConversationStructurer implements ConversationStructurer {
  async buildChapters(conversation: Conversation, messages: ConversationMessage[]): Promise<ConversationStructure> {
    return buildConversationStructure(conversation, messages);
  }
}
