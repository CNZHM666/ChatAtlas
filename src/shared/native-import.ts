import type { WebCapturePlatform } from "./web-capture";

export type HistoryPlatform = "chatgpt" | WebCapturePlatform;
export interface NativeImportSource {
  id: string;
  platform: HistoryPlatform;
  origin: string;
  tabId: number;
  label: string;
  account?: string;
  cursor?: string;
  done?: boolean;
  error?: string;
}
export interface NativeImportState {
  version: 1;
  sources: NativeImportSource[];
  /** Only explicit terminal pages count as a complete inventory. */
  inventoryComplete: boolean;
}
export interface NativeHistoryPage {
  conversations: import("./types").Conversation[];
  next?: string;
}
export interface NativeRequest {
  path: string;
  body?: unknown;
  rpc?: "MaZiqc" | "hNvQHb";
}
export interface NativeReply { data: unknown; account: string }
export type NativeTransport = (source: NativeImportSource, request: NativeRequest) => Promise<NativeReply>;
