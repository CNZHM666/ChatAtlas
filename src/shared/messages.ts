import type { MessageSourceRange, ReaderSearchContext } from "./message-location";
import type { ConversationCapture, ImportJob } from "./types";
import type { NavigatorDataResponse } from "./conversation-navigator";
import type { NativeMessageIdentity } from "./native-discussion";

export interface CaptureSummary {
  conversationId: string;
  title: string;
  messageCount: number;
  savedAt: number;
}

export interface CaptureCommandResponse {
  ok: boolean;
  summary?: CaptureSummary;
  error?: string;
}

export interface NavigationResponse {
  ok: boolean;
  error?: string;
}

export type { NavigatorDataResponse };

export type AtlasMessage =
  | { type: "ATLAS_NATIVE_IMPORT_START"; sources: import("./native-import").NativeImportSource[] }
  | { type: "ATLAS_NATIVE_IMPORT_RESUME" }
  | { type: "ATLAS_WEB_CAPTURE_STATUS" }
  | { type: "ATLAS_WEB_CAPTURE_SET"; platform: import("./web-capture").WebCapturePlatform; enabled: boolean }
  | { type: "ATLAS_WEB_CAPTURE_TABS"; platform: import("./web-capture").WebCapturePlatform }
  | { type: "ATLAS_WEB_CAPTURE_TAB"; platform: import("./web-capture").WebCapturePlatform; tabId: number; conversationId: string }
  | { type: "ATLAS_WEB_PAGE_INSPECT" }
  | { type: "ATLAS_WEB_HISTORY_PAGE" }
  | { type: "ATLAS_WEB_HISTORY_LIST"; platform: import("./web-capture").WebCapturePlatform; tabId:number }
  | { type: "ATLAS_WEB_HISTORY_IMPORT"; platform: import("./web-capture").WebCapturePlatform; url:string; conversationId:string }
  | { type: "ATLAS_OPEN_SIDEPANEL" }
  | { type: "ATLAS_OPEN"; prepareId?:string }
  | { type: "ATLAS_OPEN_CONVERSATION"; conversationId: string; messageId?: string; sourceRange?: MessageSourceRange; search?: ReaderSearchContext }
  | { type: "ATLAS_FOCUS_CONVERSATION"; conversationId: string; messageId?: string; sourceRange?: MessageSourceRange; search?: ReaderSearchContext }
  | { type: "ATLAS_OPEN_REVIEW"; sessionId: string; sectionId?: string; query?: boolean }
  | { type: "ATLAS_FOCUS_REVIEW"; sessionId: string; sectionId?: string; query?: boolean }
  | { type: "ATLAS_OPEN_AI_SETTINGS" }
  | { type: "ATLAS_FOCUS_AI_SETTINGS" }
  | { type: "ATLAS_SIDECAR_OPEN_ORIGINAL"; conversationId: string; messageId: string }
  | { type: "ATLAS_SIDECAR_LOCATE"; conversationId: string; messageId: string; platformMessageId?:string }
  | { type: "ATLAS_LOCATE_MESSAGE"; conversationId: string; identity: NativeMessageIdentity }
  | { type: "ATLAS_SIDECAR_SYNC"; conversationId: string }
  | { type: "ATLAS_SIDECAR_CAPTURE"; conversationId: string }
  | { type: "ATLAS_SIDECAR_HANDOFF"; conversationId: string; text: string }
  | { type: "ATLAS_FILL_COMPOSER"; conversationId: string; text: string }
  | { type: "ATLAS_SIDECAR_DATA"; conversationId: string }
  | { type: "ATLAS_NAVIGATOR_DATA"; conversationId: string }
  | { type: "ATLAS_PING" }
  | { type: "ATLAS_CONTENT_READY"; url: string }
  | { type: "ATLAS_CAPTURE_BATCH"; capture: ConversationCapture }
  | { type: "ATLAS_CAPTURE_NOW"; conversationId?: string }
  | { type: "ATLAS_IMPORT_CURRENT" }
  | { type: "ATLAS_CAPTURE_SAVED"; summary: CaptureSummary }
  | { type: "ATLAS_IMPORT_START"; mode: "full" | "incremental" | "failed" | "titles" }
  | { type: "ATLAS_IMPORT_SELECT"; conversationIds: string[]; /** Sync again even when already synced and unchanged. */ force?: boolean }
  | { type: "ATLAS_IMPORT_OPEN_CHATGPT" }
  | { type: "ATLAS_IMPORT_RETRY"; reload?: boolean }
  | { type: "ATLAS_IMPORT_PAUSE" }
  | { type: "ATLAS_IMPORT_STATUS" }
  | { type: "ATLAS_IMPORT_PRIORITY"; conversationId: string }
  | { type: "ATLAS_IMPORT_PROGRESS"; job: ImportJob }
  | { type: "ATLAS_SYNC_LIST"; offset: number; limit: number; archived: boolean }
  | { type: "ATLAS_SYNC_SESSION" }
  | { type: "ATLAS_SYNC_DETAIL"; conversationId: string };
