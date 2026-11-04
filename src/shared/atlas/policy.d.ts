export const POLICY_VERSION: string;
export const TOKEN_ESTIMATE_VERSION: string;
export const MAX_FOCUS_PASSAGES: number;
export interface GenerationProfile { parameters: Record<string, unknown>; reasoningReserve: number; tokenParameter: string; omitTemperature: boolean; jsonMode: boolean }
export function generationProfile(baseUrl: string, modelId?: string): GenerationProfile;
export function estimateTokens(value: unknown, modelId?: string): number;
export function estimateMessageTokens(messages: Array<{ content: string }>, modelId?: string, legacy?: boolean): number;
export function focusStrategy(intent?: string, mode?: string): "answer" | "review" | "work";
export function taskPolicy(taskType: string, data?: Record<string, unknown>, modelId?: string, baseUrl?: string): { maxInputTokens: number; maxOutputTokens: number };
export function economyTask(taskType: string, data?: Record<string, unknown>): boolean;
