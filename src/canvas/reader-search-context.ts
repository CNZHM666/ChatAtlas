import type { ConversationMessage } from "../shared/types";
import type { ReaderSearchContext, ReaderSearchHit } from "../shared/message-location";
import { sourceMessageSignature } from "../shared/source-signature";

export function validReaderHits(context: ReaderSearchContext | undefined, messages: ConversationMessage[]): ReaderSearchHit[] {
  const byId = new Map(messages.map(message => [message.id, message]));
  const seen = new Set<string>();
  return (context?.hits ?? []).filter(hit => {
    const message = byId.get(hit.messageId);
    if (!message || seen.has(hit.messageId) || hit.sourceSignature && hit.sourceSignature !== sourceMessageSignature(message.content)) return false;
    seen.add(hit.messageId); return true;
  });
}

