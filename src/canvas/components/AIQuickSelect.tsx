import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import type { AIConnection, AISettings } from "../../shared/types";
import { getAISettings, saveAISettings } from "../../storage/knowledge-graph";
import { hasAIConnection } from "../../ai/ai-mode";
import { AI_PROVIDER_PRESETS } from "../../ai/provider";
import { Check, ChevronDown, Settings2 } from "lucide-react";

const connectionKey = (connection: AIConnection) => JSON.stringify([connection.provider, connection.baseUrl, connection.model]);
const label = (connection: AIConnection) => connection.model;
/** The provider a model belongs to, for grouping: a custom endpoint is named by its host. */
const providerName = (connection: AIConnection, zh: boolean) => {
  const preset = connection.provider === "openai-compatible" ? undefined : AI_PROVIDER_PRESETS.find(item => item.id === connection.provider);
  if (preset) return zh ? preset.label : preset.labelEn ?? preset.label;
  try { return new URL(connection.baseUrl).hostname; } catch { return connection.baseUrl; }
};

function ModelMenu({ name, title, current, selected, groups, busy, onChange }: {
  name: string; title: string; current: string; selected: string;
  groups: Map<string, [string, AIConnection][]>; busy: boolean; onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null);
  const popupId = useId();
  useLayoutEffect(() => {
    if (!open) return;
    const menu = root.current;
    const option = menu?.querySelector<HTMLButtonElement>('[aria-selected="true"]') ?? menu?.querySelector<HTMLButtonElement>('[role="option"]');
    option?.focus();
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !menu?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);

  const close = () => { setOpen(false); trigger.current?.focus({ preventScroll: true }); };
  const move = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); return; }
    if (event.key === "Tab") { close(); return; }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const options = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="option"]'));
    if (!options.length) return;
    const index = options.findIndex(option => option === document.activeElement);
    const next = event.key === "Home" ? 0 : event.key === "End" ? options.length - 1
      : (index + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length;
    event.preventDefault(); options[next].focus();
  };
  return <div className="ai-model-picker" ref={root} onBlur={event => {
    if (!event.relatedTarget || !event.currentTarget.contains(event.relatedTarget)) setOpen(false);
  }}>
    <button ref={trigger} className="ai-model-trigger" type="button" aria-label={`${name} · ${current}`} title={title}
      aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? popupId : undefined} aria-disabled={busy || undefined}
      onClick={() => { if (!busy) setOpen(!open); }} onKeyDown={event => {
        if (!busy && (event.key === "ArrowDown" || event.key === "ArrowUp")) { event.preventDefault(); setOpen(true); }
      }}><span>{current}</span><ChevronDown size={14} aria-hidden="true" /></button>
    {open ? <div className="ai-model-menu" id={popupId} role="listbox" aria-label={name} onKeyDown={move}>
      {[...groups].map(([provider, entries], index) => <div key={provider} role="group" aria-labelledby={`${popupId}-${index}`}>
        <div className="ai-model-provider" id={`${popupId}-${index}`}>{provider}</div>
        {entries.map(([key, model]) => <button key={key} type="button" role="option" aria-selected={key === selected} tabIndex={-1}
          title={label(model)} onClick={() => { close(); if (key !== selected) onChange(key); }}>
          <span>{label(model)}</span>{key === selected ? <Check size={14} aria-hidden="true" /> : null}
        </button>)}
      </div>)}
    </div> : null}
  </div>;
}

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
  if (!options.length && onConfigure) return <div className={className}>
    <button type="button" className="ai-quick-connect" onClick={onConfigure}>
      {compact && <Settings2 size={15} aria-hidden="true" />}<span>{selectedLabel}</span>
    </button>
    {error ? <span role="alert" className="ai-quick-error">{error}</span> : null}
  </div>;
  // Models are grouped by provider once there is more than one, so two providers' models are told apart. Managing
  // connections is its own button: as an option of this list it was a choice that opened a panel instead.
  const groups = new Map<string, [string, AIConnection][]>();
  for (const entry of options) { const name = providerName(entry[1], zh); groups.set(name, [...groups.get(name) ?? [], entry]); }
  const optionsOf = (entries: [string, AIConnection][]) => entries.map(([key, connection]) => <option key={key} value={key}>{label(connection)}</option>);
  const manage = zh ? "连接 / 管理 AI" : "Connect / manage AI";
  const name = zh ? "选择生成 AI" : "Choose generation AI";
  const title = selected && settings ? `${providerName(settings, zh)} · ${selectedLabel}` : selectedLabel;
  return <div className={className}>
    {compact && options.length ? <ModelMenu name={name} title={title} current={selectedLabel} selected={selected} groups={groups} busy={busy} onChange={value => void change(value)}/>
      : <label><select aria-label={name} title={title} style={{ width: `${Math.min(25, selectedLabel.length + 5)}ch` }} value={selected} disabled={busy} onChange={(event) => void change(event.target.value)}>
      {!selected ? <option value="" disabled>{selectedLabel}</option> : null}
      {groups.size > 1 ? [...groups].map(([name, entries]) => <optgroup key={name} label={name}>{optionsOf(entries)}</optgroup>) : optionsOf(options)}
    </select></label>}
    {onConfigure ? <button type="button" className="ai-quick-manage" aria-label={manage} title={manage} onClick={onConfigure}><Settings2 size={17} aria-hidden="true" /></button> : null}
    {error ? <span role="alert" className="ai-quick-error">{error}</span> : null}
  </div>;
}
