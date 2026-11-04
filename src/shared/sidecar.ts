import type { FocusSection } from "./focus-session";

/** Compact saved reading projection. No raw messages, private notes or AI calls. */
export interface SidecarReading {
  id: string;
  sessionId?: string;
  projectTitle?: string;
  title: string;
  preview: boolean;
  sourceCount: number;
  summary: string;
  turningPoints: string[];
  confirmed: string[];
  openQuestions: string[];
  activeSectionId: string;
  sections: Array<{ id: string; title: string; lead: string; transition: string; kind: FocusSection["kind"]; personal: boolean; completed: boolean }>;
}

export interface SidecarData { conversationId: string; title: string; readings: SidecarReading[] }
export interface SidecarDataResponse { ok: boolean; data?: SidecarData; error?: string }
