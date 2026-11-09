import { useEffect, useState } from "react";
import type { AIConnection, AISettings } from "../../shared/types";
import { getAISettings, saveAISettings } from "../../storage/knowledge-graph";
import { hasAIConnection } from "../../ai/ai-mode";
import { AI_PROVIDER_PRESETS } from "../../ai/provider";
import { Settings2 } from "lucide-react";

const connectionKey = (connection: AIConnection) => JSON.stringify([connection.provider, connection.baseUrl, connection.model]);
const label = (connection: AIConnection) => connection.model;
/** The provider a model belongs to, for grouping: a custom endpoint is named by its host. */
const providerName = (connection: AIConnection, zh: boolean) => {
  const preset = connection.provider === "openai-compatible" ? undefined : AI_PROVIDER_PRESETS.find(item => item.id === connection.provider);
  if (preset) return zh ? preset.label : preset.labelEn ?? preset.label;
  try { return new URL(connection.baseUrl).hostname; } catch { return connection.baseUrl; }
};

export function AIQuickSelect({ zh, onConfigure, onBusy, onReady, configureLabel }: { zh: boolean; onConfigure?: () => void; onBusy?: (busy: boolean) => void; onReady?: (ready: boolean) => void; configureLabel?: string }) {
  const [settings, setSettings] = useState<AISettings>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    const load = () => { void getAISettings().then((value) => { if (active) setSettings(value); }).catch(() => { if (active) setError(zh ? "读取 AI 配置失败" : "Could not load AI settings"); }); };
    const visible = () => { if (!document.hidden) load(); };
    load(); window.addEventListener("atlas-ai-settings-changed", load); window.addEventListener("focus", load); document.addEventListener("visibilitychange", visible);
    return () => { active = false; window.removeEventListener("atlas-ai-settings-changed", load); window.removeEventListener("focus", load); document.removeEventListener("visibilitychange", visible); };
  }, [zh]);
  useEffect(() => { onReady?.(hasAIConnection(settings)); }, [settings, onReady]);
  const connections = new Map<string, AIConnection>();
  for (const item of [...settings?.connections ?? [], settings]) if (item?.baseUrl && item.apiKey && item.model) {
    connections.set(connectionKey(item), item);
    if (item.economyModel && item.economyModel !== item.model) {
      const economy = { ...item, model: item.economyModel };
      connections.set(connectionKey(economy), economy);
    }
  }
  const options = [...connections.entries()];
  const selected = hasAIConnection(settings) && settings ? connectionKey(settings) : "";
  const selectedLabel = selected && settings ? label(settings) : configureLabel ?? (zh ? "连接 AI" : "Connect AI");
  const change = async (value: string) => {
    setBusy(true); onBusy?.(true); setError("");
    try {
      const current = await getAISettings() ?? { id: "ai-settings", updatedAt: 0, provider: "openai" as const, baseUrl: "https://api.openai.com/v1", apiKey: "", model: "", analysisMode: "balanced" as const };
      const connection = connections.get(value);
      if (!connection) throw Error(zh ? "请先连接这个 AI" : "Connect this AI first");
      setSettings(await saveAISettings({ ...current, ...connection, mode: "byok" }));
    } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); }
    finally { setBusy(false); onBusy?.(false); }
  };
  if (!options.length && onConfigure) return <div className="ai-quick-select"><button type="button" className="ai-quick-connect" onClick={onConfigure}>{selectedLabel}</button>{error ? <span role="alert" className="ai-quick-error">{error}</span> : null}</div>;
  // Models are grouped by provider once there is more than one, so two providers' models are told apart. Managing
  // connections is its own button: as an option of this list it was a choice that opened a panel instead.
  const groups = new Map<string, [string, AIConnection][]>();
  for (const entry of options) { const name = providerName(entry[1], zh); groups.set(name, [...groups.get(name) ?? [], entry]); }
  const optionsOf = (entries: [string, AIConnection][]) => entries.map(([key, connection]) => <option key={key} value={key}>{label(connection)}</option>);
  const manage = zh ? "连接 / 管理 AI" : "Connect / manage AI";
  return <div className="ai-quick-select">
    <label><select aria-label={zh ? "选择生成 AI" : "Choose generation AI"} title={selected && settings ? `${providerName(settings, zh)} · ${selectedLabel}` : selectedLabel} style={{ width: `${Math.min(25, selectedLabel.length + 5)}ch` }} value={selected} disabled={busy} onChange={(event) => void change(event.target.value)}>
      {!selected ? <option value="" disabled>{selectedLabel}</option> : null}
      {groups.size > 1 ? [...groups].map(([name, entries]) => <optgroup key={name} label={name}>{optionsOf(entries)}</optgroup>) : optionsOf(options)}
    </select></label>
    {onConfigure ? <button type="button" className="ai-quick-manage" aria-label={manage} title={manage} onClick={onConfigure}><Settings2 size={17} aria-hidden="true" /></button> : null}
    {error ? <span role="alert" className="ai-quick-error">{error}</span> : null}
  </div>;
}
