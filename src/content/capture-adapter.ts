export interface DetectedConversation { id: string; url: string; title: string }
export interface ParsedChatMessage {
  uiParts?: Array<{ ordinal: number; raw: string; fallbackText?: string; truncated?: boolean }>;
  stableId?: string; index: number; role: "user" | "assistant"; text: string; element: HTMLElement;
}
export interface CaptureAdapter {
  platform?: string;
  detectConversation(): DetectedConversation | null;
  parseMessages(): ParsedChatMessage[];
}
