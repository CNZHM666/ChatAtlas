import { createContext, useContext } from "react";

interface ConversationCanvasActions {
  editable: boolean;
  collapsedIds: Set<string>;
  toggleCollapsed: (id: string) => void;
  renameNode: (id: string, title: string) => void;
  createBranch: (id: string, kind: "topic" | "bridge") => void;
  deleteNode: (id: string) => void;
  selectNode: (id: string) => void;
}

export const ConversationCanvasContext = createContext<ConversationCanvasActions | null>(null);

export function useConversationCanvasActions(): ConversationCanvasActions {
  const value = useContext(ConversationCanvasContext);
  if (!value) throw new Error("ConversationCanvasContext is missing");
  return value;
}
