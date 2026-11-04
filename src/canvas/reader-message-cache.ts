import { getMessagesForConversation } from "../storage/messages";
import { cachedReaderMessages } from "../storage/message-read-cache";
export { invalidateMessageReadCache as invalidateReaderMessages } from "../storage/message-read-cache";

export function readerMessages(conversationId: string) {
  return cachedReaderMessages(conversationId, () => getMessagesForConversation(conversationId, { cache: false }));
}
