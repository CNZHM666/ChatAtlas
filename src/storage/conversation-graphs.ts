import type { ConversationGraph } from "../shared/types";
import { getDatabase } from "./db";

export async function getStoredConversationGraph(conversationId: string): Promise<ConversationGraph | undefined> {
  return (await getDatabase()).get("conversationGraphs", conversationId);
}

export async function saveStoredConversationGraph(graph: ConversationGraph): Promise<void> {
  await (await getDatabase()).put("conversationGraphs", { ...graph, updatedAt: Date.now() });
}
