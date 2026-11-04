import type { ConversationMessage } from "../shared/types";
import type { FocusSession } from "../shared/focus-session";
import { buildKnowledgeIndex, knowledgeRevision } from "../shared/knowledge-index";
import { getDatabase } from "./db";
export async function loadKnowledgeIndex(session: FocusSession, messages: ConversationMessage[]) {
  const db = await getDatabase();
  // Raw revisions are part of validity, including role and order changes.
  const fresh = buildKnowledgeIndex(session, messages), saved = await db.get("knowledgeIndexes", session.id);
  if (saved?.revision === knowledgeRevision(session) && JSON.stringify(saved.facts) === JSON.stringify(fresh.facts)) return saved;
  await db.put("knowledgeIndexes", fresh);
  return fresh;
}
