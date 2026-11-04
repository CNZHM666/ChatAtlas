import type { AtlasAIProvider } from "./provider";
import type { AnalysisMode } from "./semantic-analysis";
import type { Conversation, ConversationSemanticProfile, QuestionSnapshot } from "../shared/types";
import { estimateTokens } from "../shared/atlas/policy.js";

export const ANALYSIS_VERSION = 1;

const domains = [
  ["数学", /数学|线性代数|微积分|矩阵|特征值|方程|概率|\b(?:math|algebra|calculus|matrix|eigen)\b/i],
  ["英语", /英语|英文|语法|词汇|翻译|\b(?:english|grammar|vocabulary)\b/i],
  ["控制与自动化", /控制理论|控制系统|自动化|状态空间|系统极点|示波器|信号发生器|\b(?:lqr|mpc|control|oscilloscope)\b/i],
  ["编程与开源", /编程|代码|源码|开源|\b(?:python|javascript|typescript|react|numpy|github|api|debug)\b/i],
  ["大学学习", /大学|课程|考试|作业|实验报告|论文|\b(?:course|exam|homework|university)\b/i],
  ["产品开发", /产品定位|产品需求|产品开发|商业模式|路线图|\b(?:roadmap|product|business|project)\b/i],
  ["视觉设计", /视觉|界面|排版|配色|图形设计|\b(?:figma|ui|ux|design)\b/i],
  ["生活与兴趣", /生活|旅行|健康|饮食|健身|\b(?:travel|health|food|fitness)\b/i],
] as const;

export function analyzedVersion(conversation: Conversation): string {
  return `${conversation.sourceUpdatedAt ?? conversation.updatedAt}:${conversation.messageCount}`;
}

function sampleAcrossConversation<T>(items: T[], limit: number): T[] {
  if (items.length <= limit) return items;
  return Array.from({ length: limit }, (_, index) => items[Math.round(index * (items.length - 1) / (limit - 1))]);
}

function localProfile(conversation: Conversation, snapshots: QuestionSnapshot[], now = Date.now()): ConversationSemanticProfile {
  const representative = sampleAcrossConversation(snapshots, 40);
  const evidence = representative.map((snapshot) => [snapshot.summary.slice(0, 120), snapshot.displayTitle, ...snapshot.concepts].join(" "));
  const title = [conversation.title, conversation.summary].filter(Boolean).join(" ");
  const matchedDomains = domains.map(([name, signal]) => ({ name, score: evidence.reduce((count, text) => count + Number(signal.test(text)), 0), titleMatch: signal.test(title) }))
    .filter((item) => item.score >= 2 || item.titleMatch)
    .sort((a, b) => b.score + Number(b.titleMatch) - a.score - Number(a.titleMatch))
    .map((item) => item.name);
  const concepts = [...new Set([...representative.map((snapshot) => snapshot.concepts[0]).filter((concept): concept is string => Boolean(concept)), ...representative.flatMap((snapshot) => snapshot.concepts)])].slice(0, 12);
  const intent = snapshots.find((snapshot) => snapshot.intent)?.intent ?? "学习与探索";
  return {
    conversationId: conversation.id, title: conversation.title,
    summary: conversation.summary ?? (snapshots.slice(0, 3).map((snapshot) => snapshot.summary).join("；") || conversation.title),
    domains: matchedDomains.slice(0, 3), topics: matchedDomains.slice(0, 3), concepts, intent,
    intents: [...new Set(snapshots.map((snapshot) => snapshot.intent).filter((value): value is string => Boolean(value)))],
    questionCount: snapshots.length, analysisVersion: ANALYSIS_VERSION,
    analysisSource: "fallback",
    evidenceRefs: sampleAcrossConversation(snapshots, 4).map((snapshot) => ({ conversationId: conversation.id, questionId: snapshot.questionId, messageId: snapshot.questionId })),
    analyzedVersion: analyzedVersion(conversation), updatedAt: now,
  };
}

function validateProfiles(value: unknown, inputs: Array<{ conversation: Conversation; snapshots: QuestionSnapshot[] }>): ConversationSemanticProfile[] {
  if (!value || typeof value !== "object" || !Array.isArray((value as { profiles?: unknown }).profiles)) throw new Error("Invalid profile response");
  const raw = (value as { profiles: Array<Record<string, unknown>> }).profiles;
  return inputs.map(({ conversation, snapshots }) => {
    const fallback = localProfile(conversation, snapshots);
    const item = raw.find((candidate) => candidate.conversationId === conversation.id);
    if (!item) return fallback;
    const strings = (key: string) => Array.isArray(item[key]) ? (item[key] as unknown[]).filter((entry): entry is string => typeof entry === "string" && Boolean(entry.trim())).map((entry) => entry.trim()).slice(0, 12) : [];
    const domains = strings("domains");
    const topics = strings("topics");
    const concepts = strings("concepts");
    return {
      ...fallback,
      analysisSource: typeof item.summary === "string" && item.summary.trim() ? "ai" : "fallback",
      summary: typeof item.summary === "string" && item.summary.trim() ? item.summary.trim().slice(0, 500) : fallback.summary,
      domains: domains.length ? domains.slice(0, 3) : fallback.domains,
      topics: topics.length ? topics.slice(0, 6) : fallback.topics,
      concepts: concepts.length ? concepts : fallback.concepts,
      intent: typeof item.intent === "string" && item.intent.trim() ? item.intent.trim().slice(0, 80) : fallback.intent,
    };
  });
}

export async function profileConversations(
  inputs: Array<{ conversation: Conversation; snapshots: QuestionSnapshot[] }>,
  provider?: AtlasAIProvider,
  onRequest?: (inputCharacters: number, outputCharacters: number, failed?: boolean) => void,
  mode: AnalysisMode = "balanced",
  onProgress?: (completed: number, total: number) => void,
  requireAI = false,
): Promise<ConversationSemanticProfile[]> {
  if (!provider) return inputs.map(({ conversation, snapshots }) => localProfile(conversation, snapshots));
  const profiles: ConversationSemanticProfile[] = [];
  const sampleLimit = mode === "fast" ? 12 : mode === "deep" ? 40 : 24;
  const batchCharacterLimit = mode === "fast" ? 12000 : mode === "deep" ? 26000 : 18000;
  const prepared = inputs.map((input) => {
    const { conversation, snapshots } = input;
    const selected = sampleAcrossConversation(snapshots, sampleLimit);
    return { input, payload: { id: conversation.id, title: conversation.title, concepts: localProfile(conversation, snapshots).concepts, questions: selected.map((snapshot) => ({ title: snapshot.displayTitle, summary: snapshot.summary.slice(0, 160), answer: snapshot.answerKeypoint?.slice(0, 120), concepts: snapshot.concepts.slice(0, 5), intent: snapshot.intent })) } };
  });
  for (let index = 0; index < prepared.length;) {
    const batch: typeof prepared = [];
    let characters = 0;
    while (index < prepared.length && batch.length < 8) {
      const next = prepared[index];
      const nextCharacters = JSON.stringify(next.payload).length;
      if (batch.length && characters + nextCharacters > batchCharacterLimit) break;
      if (batch.length && estimateTokens(JSON.stringify([...batch.map((item) => item.payload), next.payload])) > 15500) break;
      batch.push(next);
      characters += nextCharacters;
      index += 1;
    }
    const originalBatch = batch.map((item) => item.input);
    const prompt = JSON.stringify({ conversations: batch.map((item) => item.payload), schema: { profiles: [{ conversationId: "id", summary: "concise", domains: ["stable domain"], topics: ["topic"], concepts: ["durable concept"], intent: "intent" }] } });
    try {
      const request = {
        taskType: "conversation_profile" as const, conversationIds: batch.map((item) => item.input.conversation.id),
        system: "Profile conversations for a personal knowledge graph using only the cached question snapshots provided. Return strict JSON. Prefer durable concepts and stable domains; never use 'other' or workflow states as domains.",
        prompt, validate: (value: unknown) => validateProfiles(value, originalBatch),
        cacheIf: (result: ConversationSemanticProfile[]) => result.every((profile) => profile.analysisSource === "ai"),
      };
      const result = await (provider.extract?.(request) ?? provider.generateStructured(request));
      if (requireAI && result.some((profile) => profile.analysisSource !== "ai")) throw new Error("AI returned incomplete conversation profiles. Retry this task.");
      onRequest?.(prompt.length, JSON.stringify(result).length);
      profiles.push(...result);
    } catch (error) {
      onRequest?.(prompt.length, 0, true);
      if (requireAI) throw error;
      profiles.push(...originalBatch.map(({ conversation, snapshots }) => localProfile(conversation, snapshots)));
    }
    onProgress?.(profiles.length, inputs.length);
  }
  return profiles;
}
