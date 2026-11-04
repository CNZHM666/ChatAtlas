import { createContext } from "react";
import type { FocusEvidence, FocusSession, FocusSection } from "../shared/focus-session";
import type { ConversationMessage } from "../shared/types";
import type { ProjectKnowledge } from "../context/types";

/** Isolated sample readers. Production components keep their normal storage readers. */
export const ProjectExampleContext = createContext<{
  diagram?: (section:FocusSection)=>FocusSection;
  message: (ref: FocusEvidence) => ConversationMessage | undefined;
  knowledge: (session: FocusSession) => ProjectKnowledge;
} | undefined>(undefined);
