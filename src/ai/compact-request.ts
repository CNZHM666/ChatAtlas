import type { StructuredAIRequest } from "./provider";

/** Short wire IDs only. Stored sources and caller validation retain original IDs. */
export function compactRequest<T>(request: StructuredAIRequest<T>): StructuredAIRequest<T> {
  if (!["question_snapshot", "conversation_structure", "chapter_planning"].includes(request.taskType ?? "")) return request;
  let data: Record<string, unknown>;
  try { data = JSON.parse(request.prompt); } catch { return request; }
  if (!Array.isArray(data.questions)) return request;
  const questions = new Map<string, string>();
  const conversations = new Map<string, string>();
  for (const question of data.questions) {
    const id = question.questionId ?? question.id;
    if (typeof id === "string" && !questions.has(id)) questions.set(id, `q${questions.size + 1}`);
    if (typeof question.conversationId === "string" && !conversations.has(question.conversationId)) conversations.set(question.conversationId, `c${conversations.size + 1}`);
  }
  const reverseQuestions = new Map([...questions].map(([id, short]) => [short, id]));
  const reverseConversations = new Map([...conversations].map(([id, short]) => [short, id]));
  const transform = (value: unknown, decode: boolean, key = ""): unknown => {
    if (typeof value === "string") {
      const map = key === "conversationId" ? decode ? reverseConversations : conversations
        : ["id", "questionId", "questionIds", "beforeQuestionId", "nextQuestionId"].includes(key) ? decode ? reverseQuestions : questions : undefined;
      if (decode && key !== "id" && map && !map.has(value)) throw new Error(`Unknown source ID in ${key}`);
      return map?.get(value) ?? value;
    }
    if (Array.isArray(value)) return value.map((item) => transform(item, decode, key));
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([field, item]) => [field, transform(item, decode, field)]));
    return value;
  };
  return { ...request, prompt: JSON.stringify(transform(data, false)), validate: (value) => request.validate(transform(value, true)) };
}
