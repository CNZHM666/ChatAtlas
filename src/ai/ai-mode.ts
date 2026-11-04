import type { AISettings } from "../shared/types";

/** The public extension supports user-owned API connections only. */
export function aiMode(_settings?: AISettings | null): "demo" | "byok" {
  void _settings; // Keep the legacy call signature for imported settings.
  return "byok";
}

export function effectiveAISettings(settings?: AISettings | null): AISettings {
  if (settings) return { ...settings, mode: "byok", model: settings.model === "atlas-demo" ? "" : settings.model };
  return { id: "ai-settings", mode: "byok", provider: "openai", baseUrl: "https://api.openai.com/v1", apiKey: "", model: "", economyModel: "", analysisMode: "balanced", updatedAt: 0 };
}

export function hasAIConnection(settings?: AISettings | null): boolean {
  const value = effectiveAISettings(settings);
  return Boolean(value.baseUrl.trim() && value.apiKey.trim() && value.model.trim());
}
