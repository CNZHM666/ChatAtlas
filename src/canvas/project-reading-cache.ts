import { createContext, useContext, useRef } from "react";
import { createProjectReadingCache, type ProjectReadingCache } from "../shared/project-reading-cache";

export const ProjectReadingCacheContext = createContext<ProjectReadingCache | undefined>(undefined);
/** Standalone readers still work; the workspace provider also shares results across page unmounts. */
export function useProjectReadingCache() {
  const shared = useContext(ProjectReadingCacheContext), local = useRef<ProjectReadingCache>();
  if (!local.current) local.current = createProjectReadingCache();
  return shared ?? local.current;
}
