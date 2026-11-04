import { createContext, useContext } from "react";

interface CanvasNodeActions {
  editable: boolean;
  collapsedIds: Set<string>;
  toggleCollapsed: (id: string) => void;
  openCard: (id: string) => void;
  renameCard: (id: string, title: string) => void;
  attachedConversations: Record<string, Array<{ id: string; title: string; messageCount: number | null }>>;
  expandedAttachments: Set<string>;
  toggleAttachments: (id: string) => void;
  attachConversation: (topicId: string, conversationId: string) => void;
  chooseConversationToAttach: (topicId: string) => void;
  openSources: (topicId: string) => void;
  hoveredTopicId: string | null;
}

export const CanvasNodeContext = createContext<CanvasNodeActions | null>(null);

export function useCanvasNodeActions(): CanvasNodeActions {
  const value = useContext(CanvasNodeContext);
  if (!value) throw new Error("CanvasNodeContext is missing");
  return value;
}
