import { useEffect, useMemo, useState } from "react";
import type { AIConnection, AISettings } from "../../shared/types";
import { getAISettings, saveAISettings } from "../../storage/knowledge-graph";
import { hasAIConnection } from "../../ai/ai-mode";
import { AI_PROVIDER_PRESETS } from "../../ai/provider";
import { Settings2, SlidersHorizontal } from "lucide-react";
import { formatModelDisplayName } from "../../shared/model-display-name";
import { ModelPickerPopover, type ModelPickerItem } from "./ModelPickerPopover";

const connectionKey = (connection: AIConnection) => JSON.stringify([connection.provider, connection.baseUrl, connection.model]);
const label = (connection: AIConnection) => connection.model;
/** The provider a model belongs to, for grouping: a custom endpoint is named by its host. */
const providerName = (connection: AIConnection, zh: boolean) => {
  const preset = connection.provider === "openai-compatible" ? undefined : AI_PROVIDER_PRESETS.find(item => item.id === connection.provider);
  if (preset) return zh ? preset.label : preset.labelEn ?? preset.label;
  try { return new URL(connection.baseUrl).hostname; } catch { return connection.baseUrl; }
};

export function AIQuickSelect({ zh, onConfigure, onBusy, onReady, configureLabel, compact = false, readOnly = false }: { zh: boolean; onConfigure?: () => void; onBusy?: (busy: boolean) => void; onReady?: (ready: boolean) => void; configureLabel?: string; compact?: boolean; readOnly?: boolean }) {
  const [settings, setSettings] = useState<AISettings>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (readOnly) return;
    let active = true;
    const load = () => { void getAISettings().then((value) => { if (active) setSettings(value); }).catch(() => { if (active) setError(zh ? "读取 AI 配置失败" : "Could not load AI settings"); }); };
    const visible = () => { if (!document.hidden) load(); };
    load(); window.addEventListener("atlas-ai-settings-changed", load); window.addEventListener("focus", load); document.addEventListener("visibilitychange", visible);
    return () => { active = false; window.removeEventListener("atlas-ai-settings-changed", load); window.removeEventListener("focus", load); document.removeEventListener("visibilitychange", visible); };
  }, [zh, readOnly]);
  useEffect(() => { onReady?.(hasAIConnection(settings)); }, [settings, onReady]);

  const { connections, items } = useMemo(() => {
    const map = new Map<string, AIConnection>();
    const economyKeys = new Set<string>();
    for (const item of [...settings?.connections ?? [], settings]) {
      if (item?.baseUrl && item.apiKey && item.model) {
        map.set(connectionKey(item), item);
        if (item.economyModel && item.economyModel !== item.model) {
          const economy = { ...item, model: item.economyModel };
          const key = connectionKey(economy);
          if (!map.has(key)) economyKeys.add(key);
          map.set(key, economy);
        }
      }
    }
    const pickerItems: ModelPickerItem[] = [...map.entries()].map(([key, connection]) => {
      const raw = label(connection);
      const display = formatModelDisplayName(raw);
      return {
        value: key,
        label: display,
        ariaLabel: raw,
        group: providerName(connection, zh),
        badge: economyKeys.has(key) ? (zh ? "经济" : "Economy") : undefined,
        searchText: `${display} ${raw} ${providerName(connection, zh)} ${connection.provider}`,
      };
    });
    return { connections: map, items: pickerItems };
  }, [settings, zh]);

  const selected = hasAIConnection(settings) && settings ? connectionKey(settings) : "";
  const selectedRawLabel = selected && settings ? label(settings) : configureLabel ?? (zh ? "连接 AI" : "Connect AI");
  const selectedDisplayLabel = selected && settings ? formatModelDisplayName(selectedRawLabel) : selectedRawLabel;
  const className = `ai-quick-select${compact ? " is-compact" : ""}`;
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

  if (!items.length && onConfigure) return <div className={className}>
    <button type="button" className="ai-quick-connect" onClick={onConfigure}>
      {compact && <Settings2 size={15} aria-hidden="true" />}<span>{selectedDisplayLabel}</span>
    </button>
    {error ? <span role="alert" className="ai-quick-error">{error}</span> : null}
  </div>;

  const manage = zh ? "连接 / 管理 AI" : "Connect / manage AI";
  const name = zh ? "选择生成 AI" : "Choose generation AI";
  const title = selected && settings ? `${providerName(settings, zh)} · ${selectedDisplayLabel}` : selectedDisplayLabel;

  return <div className={className}>
    <ModelPickerPopover
      items={items}
      value={selected}
      displayValue={selectedDisplayLabel}
      ariaValue={selectedRawLabel}
      ariaLabel={name}
      title={title}
      zh={zh}
      busy={busy}
      variant="composer"
      headerTitle={zh ? "切换模型" : "Switch model"}
      searchPlaceholder={zh ? "搜索已连接的模型…" : "Search connected models…"}
      focusOptionOnOpen
      syncedSelect={!compact ? {
        placeholderOption: !selected ? selectedRawLabel : undefined,
        optionText: (item) => item.ariaLabel ?? item.label,
        grouped: true,
      } : undefined}
      footerAction={onConfigure ? {
        label: zh ? "管理或添加 AI 连接…" : "Manage or add AI connections…",
        onClick: onConfigure,
        icon: <SlidersHorizontal size={13} aria-hidden="true" />,
      } : undefined}
      onChange={(value) => void change(value)}
    />
    {onConfigure ? <button type="button" className="ai-quick-manage" aria-label={manage} title={manage} onClick={onConfigure}><Settings2 size={16} aria-hidden="true" /></button> : null}
    {error ? <span role="alert" className="ai-quick-error">{error}</span> : null}
  </div>;
}
