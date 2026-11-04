import { createContext } from "react";
import type { FocusSession } from "../shared/focus-session";
import type { MatterRef } from "../shared/project-knowledge-links";
export const ProjectKnowledgeActions = createContext<{save:(update:(current:FocusSession)=>FocusSession)=>Promise<void>;read:(id:string)=>void;matter:(ref:MatterRef)=>void}|undefined>(undefined);
