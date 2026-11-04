import { createContext } from "react";
import type { EvidencePoint } from "./workspace-evidence-context";

/** Points of the Wiki page being read, for prose markers and the claim list. */
export const WikiClaimMarkerContext = createContext<{ points: EvidencePoint[]; activeKey?: string; open: (key: string) => void; zh: boolean } | undefined>(undefined);
