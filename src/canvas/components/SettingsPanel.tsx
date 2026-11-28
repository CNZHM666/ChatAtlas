import { generationFailureReason } from "../generation-notice";
import "../settings-panel.css";
import { createAtlasAI } from "../../ai/atlas-ai";
import { ArrowUpRight, Check, CheckCircle2, ChevronDown, Database, Eye, EyeOff, Info, ListChecks, LoaderCircle, RefreshCw, ShieldCheck, SlidersHorizontal, Sparkles, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { AISettings } from "../../shared/types";
import { AI_PROVIDER_PRESETS, canonicalModelId, discoveredModelId, embeddingModelsOf, listAvailableModels, recommendedEmbeddingModel, providerModelsUrl, requestProviderPermission, type AvailableAIModel } from "../../ai/provider";
import { aiConnectionKey, getAISettings, removeAIConnection, saveAISettings } from "../../storage/knowledge-graph";
import { aiMode } from "../../ai/ai-mode";
import { resolveEmbeddingProvider } from "../../ai/embedding-provider";
import { usePreferences } from "../preferences";
import { UsageLedger } from "./UsageLedger";
import { ModelPickerPopover, type ModelPickerItem } from "./ModelPickerPopover";
import { formatModelDisplayName } from "../../shared/model-display-name";
import { createAtlasBackup, downloadAtlasBackup, parseAtlasBackup, restoreAtlasBackup, type AtlasBackup } from "../../storage/atlas-backup";

const emptySettings: Omit<AISettings, "id" | "updatedAt"> = {
  mode: "byok", provider: "openai", baseUrl: "https://api.openai.com/v1", apiKey: "", model: "", economyModel: "", analysisMode: "balanced",
};

const formatModelOptionText = (item: ModelPickerItem) =>
  item.ariaLabel ?? (item.subtitle && item.subtitle !== item.label ? `${item.label} · ${item.subtitle}` : item.label);

export function SettingsPanel({ onClose, initialTab = "ai", installUrl }: { onClose: () => void; initialTab?: "ai" | "data"; installUrl?: string }) {
  const { locale, t } = usePreferences();
  const zh = locale === "zh-CN";
  const readOnly = Boolean(installUrl);
  const [tab, setTab] = useState<"ai" | "data" | "usage">(initialTab);
  const [settings, setSettings] = useState(emptySettings);
  const [showKey, setShowKey] = useState(false);
  const providerDrafts = useRef(new Map<string, Pick<typeof emptySettings, "baseUrl" | "apiKey" | "model" | "economyModel" | "embeddingModel" | "streaming">>());
  const [status, setStatus] = useState<"idle" | "testing" | "connected" | "failed">("idle");
  const [modelStatus, setModelStatus] = useState<"idle" | "loading" | "loaded" | "failed">("idle");
  const [models, setModels] = useState<AvailableAIModel[]>([]);
  const modelLoad = useRef<AbortController | null>(null);
  const [message, setMessage] = useState<{ key: Parameters<typeof t>[0] } | { raw: string; code?: string }>();
  const [saving, setSaving] = useState(false);
  const panel = useRef<HTMLElement>(null);
  const fieldId = useId();
  const notifyError = (error: unknown, fallback: Parameters<typeof t>[0]) => setMessage(error instanceof Error ? {raw:error.message,code:"code" in error ? String(error.code) : undefined} : {key:fallback});
  const messageText = message ? "key" in message ? t(message.key) : generationFailureReason(message.raw,message.code,zh) : "";
  const [rebuildRequired, setRebuildRequired] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);
  const backupInput = useRef<HTMLInputElement>(null);
  const [pendingBackup, setPendingBackup] = useState<AtlasBackup | null>(null);
  const [backupStatus, setBackupStatus] = useState<"downloaded" | {raw:string}>();
  const [backupBusy, setBackupBusy] = useState(false);

  const exportBackup = async () => {
    if (import.meta.env.VITE_ATLAS_STATIC_DEMO) return;
    setBackupBusy(true);
    try { downloadAtlasBackup(await createAtlasBackup()); setBackupStatus("downloaded"); }
    catch (error) { setBackupStatus({raw:error instanceof Error ? error.message : String(error)}); }
    finally { setBackupBusy(false); }
  };
  const inspectBackup = async (file: File) => {
    if (import.meta.env.VITE_ATLAS_STATIC_DEMO) return;
    try { setPendingBackup(parseAtlasBackup(await file.text())); setBackupStatus(undefined); }
    catch (error) { setPendingBackup(null); setBackupStatus({raw:error instanceof Error ? error.message : String(error)}); }
  };
  const applyBackup = async () => {
    if (import.meta.env.VITE_ATLAS_STATIC_DEMO) return;
    if (!pendingBackup) return;
    setBackupBusy(true);
    try { await restoreAtlasBackup(pendingBackup); window.location.reload(); }
    catch (error) { setBackupStatus({raw:error instanceof Error ? error.message : String(error)}); setBackupBusy(false); }
  };

  // Check semantic index rebuild lazily & debounced only when embedding-relevant fields actually change,
  // avoiding expensive IndexedDB / dynamic-import work on every keystroke.
  const hasApiKey = Boolean(settings.apiKey);
  useEffect(() => {
    if (import.meta.env.VITE_ATLAS_STATIC_DEMO || readOnly || tab !== "ai") return;
    if (!settings.embeddingModel) {
      setRebuildRequired(false);
      return;
    }
    let active = true;
    const timer = window.setTimeout(() => {
      const current = {
        ...emptySettings,
        provider: settings.provider,
        baseUrl: settings.baseUrl,
        apiKey: settings.apiKey,
        embeddingModel: settings.embeddingModel,
        embeddingVersion: settings.embeddingVersion,
        id: "ai-settings" as const,
        updatedAt: Date.now(),
      };
      void resolveEmbeddingProvider(current).then(async (embedding) => {
        const required = embedding ? await (await import("../../search/semantic-index")).semanticIndexRebuildRequired(embedding) : false;
        if (active) setRebuildRequired(required);
      }).catch(() => { if (active) setRebuildRequired(false); });
    }, 220);
    return () => { active = false; window.clearTimeout(timer); };
  }, [tab, readOnly, settings.provider, settings.baseUrl, settings.embeddingModel, settings.embeddingVersion, hasApiKey, settings.apiKey]);

  useEffect(() => {
    if (!readOnly) void getAISettings().then((value) => { if (value) setSettings(value); }).catch(() => undefined);
  }, [readOnly]);

  useEffect(() => {
    modelLoad.current?.abort();
    setModels((prev) => (prev.length ? [] : prev));
    setModelStatus((prev) => (prev === "idle" ? prev : "idle"));
    return () => { modelLoad.current?.abort(); };
  }, [settings.provider, settings.baseUrl, settings.apiKey]);

  const normalizedSettings = () => ({ ...settings, model: canonicalModelId(settings), economyModel: settings.economyModel ? canonicalModelId({ ...settings, model: settings.economyModel }) : "" });

  const save = async () => {
    if(saving) return;
    if (aiMode(settings as AISettings) === "byok" && (!settings.baseUrl || !settings.apiKey || !settings.model)) { setStatus("failed"); setMessage({key:"fillAISettings"}); return; }
    setSaving(true);
    try {
      if (aiMode(settings as AISettings) === "byok") {
        if (!await requestProviderPermission(settings.baseUrl, providerModelsUrl(settings))) throw new Error(t("providerPermissionDenied"));
      }
      await saveAISettings(normalizedSettings());
      setStatus("idle"); setMessage({key:"settingsSaved"});
      window.setTimeout(() => setMessage(undefined), 1500);
    } catch (error) { setStatus("failed"); notifyError(error,"connectionFailed"); } finally { setSaving(false); }
  };

  const loadModels = async () => {
    modelLoad.current?.abort();
    const controller = new AbortController();
    modelLoad.current = controller;
    setModelStatus("loading"); setMessage(undefined); setStatus("idle");
    try {
      if (!settings.baseUrl || !settings.apiKey) throw new Error(t("fillAISettings"));
      if (!await requestProviderPermission(settings.baseUrl, providerModelsUrl(settings))) throw new Error(t("providerPermissionDenied"));
      controller.signal.throwIfAborted();
      const available = await listAvailableModels({ ...settings, id: "ai-settings", updatedAt: Date.now() }, controller.signal);
      if (controller.signal.aborted) return;
      if (!available.length) throw new Error(t("noModelsFound"));
      setModels(available);
      setSettings((current) => ({ ...current, model: discoveredModelId(current.model, available, current), economyModel: discoveredModelId(current.economyModel ?? "", available, current) }));
      setModelStatus("loaded");
    } catch (error) {
      if (controller.signal.aborted) return;
      setModelStatus("failed");
      notifyError(error,"modelLoadFailed");
    }
  };

  const test = async () => {
    if (import.meta.env.VITE_ATLAS_STATIC_DEMO) return;
    setStatus("testing"); setMessage(undefined);
    try {
      if (!settings.baseUrl || !settings.apiKey || !settings.model) throw new Error(t("fillAISettings"));
      if (!await requestProviderPermission(settings.baseUrl, providerModelsUrl(settings))) throw new Error(t("providerPermissionDenied"));
      const candidate: AISettings = { ...normalizedSettings(), id: "ai-settings", updatedAt: Date.now() };
      const diagnosticRunId=`connection-${crypto.randomUUID()}`;
      await createAtlasAI(candidate,undefined,diagnosticRunId).testConnection();
      if (candidate.economyModel && candidate.economyModel !== candidate.model) await createAtlasAI({ ...candidate, model: candidate.economyModel },undefined,diagnosticRunId).testConnection();
      setStatus("connected"); setMessage({key:"connectionSuccess"});
    } catch (error) {
      setStatus("failed"); notifyError(error,"connectionFailed");
    }
  };

  useEffect(() => {
    const previous = document.activeElement;
    panel.current?.focus();
    return () => { if(previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, []);

  const l = (cn: string, en: string) => zh ? cn : en;

  const mainModelItems = useMemo<ModelPickerItem[]>(() => {
    const list: ModelPickerItem[] = [];
    if (settings.model && !models.some((model) => model.id === settings.model)) {
      const display = formatModelDisplayName(settings.model);
      list.push({
        value: settings.model,
        label: display,
        subtitle: display !== settings.model ? settings.model : undefined,
        ariaLabel: settings.model,
      });
    }
    for (const model of models) {
      const rawName = model.name || model.id;
      const display = formatModelDisplayName(rawName);
      list.push({
        value: model.id,
        label: display,
        subtitle: display !== model.id ? model.id : undefined,
        ariaLabel: model.name && model.name !== model.id ? `${model.name} · ${model.id}` : model.id,
        searchText: `${display} ${rawName} ${model.id}`,
      });
    }
    return list;
  }, [models, settings.model]);

  const economyModelItems = useMemo<ModelPickerItem[]>(() => {
    const list: ModelPickerItem[] = [{ value: "", label: zh ? "与主模型相同" : "Same as main" }];
    if (settings.economyModel && !models.some((model) => model.id === settings.economyModel)) {
      const display = formatModelDisplayName(settings.economyModel);
      list.push({
        value: settings.economyModel,
        label: display,
        subtitle: display !== settings.economyModel ? settings.economyModel : undefined,
        ariaLabel: settings.economyModel,
      });
    }
    for (const model of models) {
      const rawName = model.name || model.id;
      const display = formatModelDisplayName(rawName);
      list.push({
        value: model.id,
        label: display,
        subtitle: display !== model.id ? model.id : undefined,
        ariaLabel: model.name && model.name !== model.id ? `${model.name} · ${model.id}` : model.id,
        searchText: `${display} ${rawName} ${model.id}`,
      });
    }
    return list;
  }, [models, settings.economyModel, zh]);

  const embeddingCandidates = useMemo(() => embeddingModelsOf(models), [models]);
  const activePreset = useMemo(() => AI_PROVIDER_PRESETS.find((item) => item.id === settings.provider), [settings.provider]);
  const recommendedEmbedding = useMemo(() => recommendedEmbeddingModel(settings.provider), [settings.provider]);

  const currentKey = settings.baseUrl && settings.model ? aiConnectionKey(settings) : "";
  const saved = useMemo(() => (settings.connections ?? []).filter((item) => item.baseUrl && item.model), [settings.connections]);
  const switchConnection = async (connection: NonNullable<AISettings["connections"]>[number]) => {
    setStatus("idle"); setMessage(undefined);
    try {
      if (!await requestProviderPermission(connection.baseUrl, providerModelsUrl({ ...settings, ...connection }))) throw new Error(t("providerPermissionDenied"));
      const stored = await saveAISettings({ ...settings, ...connection, mode: "byok" });
      setSettings(stored); setModels([]); setModelStatus("idle"); setMessage({ raw: l(`已切换到 ${connection.model}`, `Switched to ${connection.model}`) });
    } catch (error) { setStatus("failed"); notifyError(error, "connectionFailed"); }
  };
  const forgetConnection = async (key: string) => {
    const stored = await removeAIConnection(key).catch(() => undefined);
    if (stored) setSettings((current) => ({ ...current, connections: stored.connections }));
  };

  const isConfigured = Boolean(settings.baseUrl && settings.apiKey && settings.model);
  const step1Done = Boolean(settings.baseUrl && settings.apiKey);
  const step2Done = Boolean(settings.model);
  const step3Done = Boolean(settings.embeddingModel);
  const supportsEmbeddings = activePreset?.protocol === "openai";
  const selectedMainDisplay = settings.model ? (mainModelItems.find((item) => item.value === settings.model)?.label ?? formatModelDisplayName(settings.model)) : "";
  const selectedEconomyDisplay = settings.economyModel
    ? (economyModelItems.find((item) => item.value === settings.economyModel)?.label ?? formatModelDisplayName(settings.economyModel))
    : l("与主模型相同", "Same as main");

  return <><div className="settings-backdrop" onClick={onClose} aria-hidden="true" /><aside ref={panel} tabIndex={-1} className="settings-panel" aria-label={t("settings")} onKeyDown={event=>{if(event.key === "Escape" && !event.defaultPrevented){event.stopPropagation();onClose();}}}>
    <header className="settings-heading"><div className="settings-heading-title"><h2>{t("settings")}</h2>{isConfigured ? <span className={`settings-connection-pill${status === "connected" ? " is-verified" : ""}`} title={settings.model}><span className="settings-connection-dot" aria-hidden="true" />{formatModelDisplayName(settings.model)}</span> : null}</div><button className="icon-button" onClick={onClose} aria-label={t("close")}><X size={18}/></button></header>
    <nav className="settings-tabs" aria-label={t("settings")}>
      <button className={tab === "ai" ? "active" : ""} aria-current={tab === "ai" ? "page" : undefined} onClick={() => setTab("ai")}><SlidersHorizontal size={15}/>{l("AI 连接", "AI connection")}</button>
      <button className={tab === "data" ? "active" : ""} aria-current={tab === "data" ? "page" : undefined} onClick={() => setTab("data")}><Database size={15}/>{l("本地数据", "Local data")}</button>
      <button className={tab === "usage" ? "active" : ""} aria-current={tab === "usage" ? "page" : undefined} onClick={() => setTab("usage")}><ListChecks size={15}/>{l("使用记录", "Usage history")}</button>
    </nav>
    {installUrl ? <div className="settings-demo-notice">
      <Info size={15} aria-hidden="true" />
      <p>{l("演示设置仅供查看", "Demo settings are read-only")}</p>
      <a href={installUrl}>{l("安装扩展", "Install extension")}<ArrowUpRight size={13} aria-hidden="true" /></a>
    </div> : null}
    {tab === "usage" ? <div key="usage" className="settings-usage"><UsageLedger locale={locale} readOnly={readOnly}/></div> : null}
    {tab === "data" ? <div key="data" className="settings-data"><section className="settings-privacy-card"><header><Database size={18} aria-hidden="true" /><h3>{t("dataPrivacy")}</h3></header><dl>
      <div><dt>{zh ? "保存位置" : "Storage"}</dt><dd>{zh ? "保存在此设备的浏览器中" : "This browser on this device"}</dd></div>
      <div><dt>{zh ? "AI 处理" : "AI processing"}</dt><dd>{zh ? "任务所需内容直接发送至所选服务商" : "Task content is sent directly to your chosen provider"}</dd></div>
      <div><dt>{zh ? "本地备份" : "Local backup"}</dt><dd>{zh ? "由你手动下载或恢复" : "Download or restore manually"}</dd></div>
    </dl><details className="settings-privacy-more"><summary>{zh ? "了解数据如何处理" : "How data is handled"}</summary><p>{t("dataPrivacyDescription")} {t("cloudOptInDescription")}</p></details></section><section className="settings-backup"><h3>{zh ? "本地知识备份" : "Local knowledge backup"}</h3><p>{zh ? "包含对话正文、知识结构、笔记、阅读路线和阅读位置；不包含 API 密钥。请妥善保存文件。" : "Includes conversations, knowledge, notes, reading paths and positions. API keys are excluded. Keep the file private."}</p><div><button type="button" className="import-button" disabled={readOnly || backupBusy} onClick={() => void exportBackup()}>{zh ? "下载备份" : "Download backup"}</button><button type="button" className="import-button" disabled={readOnly || backupBusy} onClick={() => backupInput.current?.click()}>{zh ? "选择备份文件" : "Choose backup file"}</button></div><input ref={backupInput} type="file" accept=".json,application/json" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) void inspectBackup(file); event.currentTarget.value = ""; }} />{pendingBackup ? <div className="settings-backup-confirm"><p>{zh ? `备份时间 ${pendingBackup.createdAt}，包含 ${pendingBackup.stores.conversations.length} 条对话。恢复会替换本机现有的 ChatAtlas 知识数据。` : `Backup from ${pendingBackup.createdAt}, with ${pendingBackup.stores.conversations.length} conversations. Restore replaces this device's ChatAtlas knowledge.`}</p><button type="button" className="import-button" disabled={backupBusy} onClick={() => void applyBackup()}>{zh ? "确认恢复" : "Restore backup"}</button><button type="button" className="import-button" onClick={() => setPendingBackup(null)}>{zh ? "取消" : "Cancel"}</button></div> : null}{backupStatus ? <p role="status">{backupStatus === "downloaded" ? zh ? "备份已下载。" : "Backup downloaded." : generationFailureReason(backupStatus.raw,undefined,zh)}</p> : null}</section></div> : tab === "ai" ? <div key="ai" className="ai-settings-form">
      <fieldset className="settings-preview-fields" disabled={readOnly}>
      <section className="settings-form-group settings-step">
        <div className="settings-group-heading">
          <span className={`settings-step-number${step1Done ? " is-done" : ""}`} aria-hidden="true">{step1Done ? <Check size={12} strokeWidth={2.6} /> : "1"}</span>
          <h3>{l("连接服务商", "Connect a provider")}</h3>
        </div>
        <div className="settings-field">
          <label htmlFor={`${fieldId}-provider`}>{t("providerLabel")}</label>
          <div className="settings-select-wrap">
            <select id={`${fieldId}-provider`} value={settings.provider} onChange={(event) => {
              const provider = event.target.value as AISettings["provider"];
              const preset = AI_PROVIDER_PRESETS.find((item) => item.id === provider)!;
              if (settings.apiKey || settings.model) {
                providerDrafts.current.set(settings.provider, {
                  baseUrl: settings.baseUrl, apiKey: settings.apiKey, model: settings.model,
                  economyModel: settings.economyModel, embeddingModel: settings.embeddingModel, streaming: settings.streaming,
                });
              }
              const remembered = providerDrafts.current.get(provider);
              setSettings({
                ...settings, provider,
                baseUrl: remembered?.baseUrl ?? preset.baseUrl,
                apiKey: remembered?.apiKey ?? "",
                model: remembered?.model ?? "",
                economyModel: remembered?.economyModel ?? "",
                embeddingModel: remembered?.embeddingModel ?? "",
                streaming: remembered?.streaming,
              });
              setShowKey(false);
              setStatus("idle"); setMessage(undefined);
            }}>{AI_PROVIDER_PRESETS.map((provider) => <option key={provider.id} value={provider.id}>{provider.id === "openai-compatible" ? t("customEndpoint") : locale === "en" ? provider.labelEn ?? provider.label : provider.label}</option>)}</select>
            <ChevronDown size={15} className="settings-select-chevron" aria-hidden="true" />
          </div>
        </div>
        {settings.provider === "openai-compatible" ? <label>{t("baseUrlLabel")}<input value={settings.baseUrl} placeholder="https://api.openai.com/v1" onChange={(event) => { setSettings({ ...settings, baseUrl: event.target.value, apiKey: "", model: "", economyModel: "", embeddingModel: "" }); setStatus("idle"); }} /></label> : null}
        <div className="settings-field">
          <label htmlFor={`${fieldId}-apikey`}>{t("apiKeyLabel")}</label>
          <div className="settings-password-field">
            <input id={`${fieldId}-apikey`} type={showKey ? "text" : "password"} value={settings.apiKey} placeholder="sk-••••••••••••••••" autoComplete="off" spellCheck={false} onChange={(event) => { setSettings({ ...settings, apiKey: event.target.value, model: "", economyModel: "" }); setStatus("idle"); }} />
            <button type="button" className="settings-password-toggle" aria-label={showKey ? l("隐藏 API Key", "Hide API Key") : l("显示 API Key", "Show API Key")} title={showKey ? l("隐藏密钥", "Hide key") : l("显示密钥", "Show key")} onClick={() => setShowKey(value => !value)}>{showKey ? <EyeOff size={15} aria-hidden="true" /> : <Eye size={15} aria-hidden="true" />}</button>
          </div>
        </div>
        <p className="settings-inline-hint settings-privacy-note"><ShieldCheck size={13} aria-hidden="true" /><span>{l("密钥只保存在本机，请求直接发送至所选服务商。", "Your key stays on this device. Requests go directly to your provider.")}</span></p>
      </section>

      <section className="settings-form-group settings-step">
        <div className="settings-group-heading">
          <span className={`settings-step-number${step2Done ? " is-done" : ""}`} aria-hidden="true">{step2Done ? <Check size={12} strokeWidth={2.6} /> : "2"}</span>
          <h3>{l("选择模型", "Choose a model")}</h3>
          {models.length > 0 ? <span className="settings-meta-pill" aria-hidden="true">{l(`已读取 ${models.length} 个`, `${models.length} loaded`)}</span> : null}
        </div>
        {/* Models load only on a click: the provider permission it asks for needs one. */}
        {!models.length && !settings.model ? <button type="button" className="import-button settings-load-primary" onClick={() => void loadModels()} disabled={modelStatus === "loading" || !settings.apiKey}>{modelStatus === "loading" ? <LoaderCircle className="spin" size={14} /> : <RefreshCw size={14} />}{settings.apiKey ? t("loadModels") : l("先填写 API 密钥", "Enter the API key first")}</button>
        : <div className="settings-field">
            <label htmlFor={`${fieldId}-main`}>{l("模型", "Model")}</label>
            <div className="model-select-row">
              <ModelPickerPopover
                items={mainModelItems}
                value={settings.model}
                displayValue={selectedMainDisplay}
                placeholder={t("selectModel")}
                ariaLabel={l("模型", "Model")}
                zh={zh}
                disabled={modelStatus === "loading"}
                variant="settings"
                searchable={mainModelItems.length >= 5}
                headerTitle={l("选择主模型", "Choose main model")}
                searchPlaceholder={l("搜索模型名称或 ID…", "Search model name or ID…")}
                syncedSelect={{
                  id: `${fieldId}-main`,
                  placeholderOption: t("selectModel"),
                  optionText: formatModelOptionText,
                }}
                emptyAction={{
                  label: models.length ? l("重新拉取模型列表", "Refresh model list") : l("从服务商拉取全部模型", "Fetch all provider models"),
                  onClick: () => void loadModels(),
                  loading: modelStatus === "loading",
                }}
                onChange={(value) => { setSettings({ ...settings, model: value }); setStatus("idle"); }}
              />
              <button type="button" className="settings-load-models" onClick={() => void loadModels()} disabled={modelStatus === "loading"} aria-label={t("refreshModels")} title={t("refreshModels")}>{modelStatus === "loading" ? <LoaderCircle className="spin" size={14} /> : <RefreshCw size={14} />}</button>
            </div>
            <small>{l("用于整理对话和撰写章节。", "Organizes conversations and writes chapters.")}</small>
          </div>}
        <details className="settings-manual-models">
          <summary><ChevronDown size={14} className="settings-disclosure-chevron" aria-hidden="true" /><span>{l("更多模型选项", "More model options")}</span></summary>
          <div className="settings-more-models">
            <div className="settings-field">
              <label htmlFor={`${fieldId}-economy`}>{l("经济模型", "Economy model")}</label>
              <ModelPickerPopover
                items={economyModelItems}
                value={settings.economyModel ?? ""}
                displayValue={selectedEconomyDisplay}
                placeholder={l("与主模型相同", "Same as main")}
                ariaLabel={l("经济模型", "Economy model")}
                zh={zh}
                disabled={modelStatus === "loading" || (!models.length && !settings.economyModel)}
                variant="settings"
                searchable={economyModelItems.length >= 6}
                headerTitle={l("选择经济模型", "Choose economy model")}
                searchPlaceholder={l("搜索更快、更便宜的模型…", "Search faster, cheaper models…")}
                syncedSelect={{
                  id: `${fieldId}-economy`,
                  optionText: formatModelOptionText,
                }}
                onChange={(value) => setSettings({ ...settings, economyModel: value })}
              />
              <small>{l("初读原文等轻量任务，可选更快更便宜的模型。", "Light tasks such as reading sources; pick a faster, cheaper model.")}</small>
            </div>
            <div className="settings-field"><span id={`${fieldId}-depth`} className="settings-field-label">{l("整理强度", "Analysis depth")}</span><div className="settings-segmented" role="radiogroup" aria-labelledby={`${fieldId}-depth`}>{(["fast", "balanced", "deep"] as const).map((mode) => <button key={mode} type="button" role="radio" aria-checked={(settings.analysisMode ?? "balanced") === mode} onClick={() => setSettings({ ...settings, analysisMode: mode })}>{mode === "fast" ? l("快速", "Fast") : mode === "balanced" ? l("均衡", "Balanced") : l("深入", "Deep")}</button>)}</div><small>{l("越深入，处理的内容和请求通常越多。", "Deeper analysis usually processes more content and requests.")}</small></div>
            <div className="settings-model-grid">
              <label>{l("主模型 ID", "Main model ID")}<input value={settings.model} onChange={(event) => { setSettings({ ...settings, model: event.target.value }); setStatus("idle"); }} /></label>
              <label>{l("经济模型 ID", "Economy model ID")}<input value={settings.economyModel ?? ""} placeholder={l("留空与主模型相同", "Empty = same as main")} onChange={(event) => setSettings({ ...settings, economyModel: event.target.value })} /></label>
            </div><small>{l("接口不提供模型列表时，填写服务商文档中的 API ID，例如 qwen3.8-flash。", "Use the documented API ID when the provider has no model list, e.g. qwen3.8-flash.")}</small>
          </div>
        </details>
      </section>

      {/* Strongly recommended: dramatic improvement in cross-conversation deduplication and meaning-based search. */}
      <section className={`settings-form-group settings-step settings-semantic-card${step3Done ? " is-semantic-on" : supportsEmbeddings ? " is-semantic-featured" : ""}`}>
        <div className="settings-group-heading">
          <span className={`settings-step-number${step3Done ? " is-done" : ""}`} aria-hidden="true">{step3Done ? <Check size={12} strokeWidth={2.6} /> : "3"}</span>
          <h3>{l("语义理解", "Semantic understanding")}</h3>
          <span className="settings-recommended-badge"><Sparkles size={12} aria-hidden="true" />{l("强烈推荐开启", "Strongly recommended")}</span>
        </div>
        <p className="settings-inline-hint">{l("整理章节时自动合并换了说法的重复内容，搜索时按意思精准查找。单次调用成本极低，开启后整理质量显著提升。", "Merges reworded repeats when organizing chapters and finds conversations by meaning. Very low cost, noticeably better results.")}</p>
        {supportsEmbeddings ? (
          <div className="settings-semantic-benefits" aria-hidden="true">
            <span>{l("跨对话同义合并", "Cross-chat deduplication")}</span>
            <span>{l("按语义精准检索", "Meaning-based search")}</span>
            <span>{l("成本极低", "Ultra-low cost")}</span>
          </div>
        ) : null}
        {!supportsEmbeddings ? <small>{l("当前服务商不提供这项能力。", "This provider does not offer it.")}</small> : <>
          {settings.embeddingModel ? <div className="settings-embedding-on"><CheckCircle2 size={15} aria-hidden="true" /><span>{l(`已开启 · ${settings.embeddingModel}`, `On · ${settings.embeddingModel}`)}</span><button type="button" className="settings-load-models" aria-label={l("关闭语义理解", "Turn off semantic understanding")} onClick={() => setSettings({ ...settings, embeddingModel: "" })}>{l("关闭", "Turn off")}</button></div>
          : recommendedEmbedding ? <button type="button" className="import-button settings-load-primary settings-semantic-enable" onClick={() => setSettings({ ...settings, embeddingModel: recommendedEmbedding })}><Sparkles size={14} aria-hidden="true" />{l(`开启（使用 ${recommendedEmbedding}）`, `Turn on (${recommendedEmbedding})`)}</button> : null}
          <details className="settings-manual-models" open={!settings.embeddingModel && !recommendedEmbedding}>
            <summary><ChevronDown size={14} className="settings-disclosure-chevron" aria-hidden="true" /><span>{l("使用其他向量模型", "Use another embedding model")}</span></summary>
            <label>{l("向量模型 ID", "Embedding model ID")}<input list={`${fieldId}-embeddings`} value={settings.embeddingModel ?? ""} onChange={(event) => setSettings({ ...settings, embeddingModel: event.target.value })} placeholder={recommendedEmbedding ?? l("服务商文档中的向量模型 ID", "The embedding model ID in your provider's docs")} /></label>
            <datalist id={`${fieldId}-embeddings`}>{embeddingCandidates.map((model) => <option key={model.id} value={model.id} />)}</datalist>
            <small>{l("需服务商提供向量（embeddings）接口。", "Your provider must offer an embeddings endpoint.")}</small>
          </details>
        </>}
      </section>

      {saved.length > 1 ? <section className="settings-form-group settings-connections" aria-label={l("已保存的连接", "Saved connections")}><div className="settings-group-heading"><ListChecks size={16}/><h3>{l("已保存的连接", "Saved connections")}</h3></div><ul>{saved.map((connection) => { const key = aiConnectionKey(connection), current = key === currentKey; let host = connection.baseUrl; try { host = new URL(connection.baseUrl).hostname; } catch { /* keep the raw address */ } return <li key={key}><div><strong>{connection.model}{connection.economyModel && connection.economyModel !== connection.model ? ` + ${connection.economyModel}` : ""}</strong><small>{host}</small></div>{current ? <span className="settings-current">{l("当前", "Current")}</span> : <span className="settings-connection-actions"><button type="button" onClick={() => void switchConnection(connection)}>{l("使用", "Use")}</button><button type="button" aria-label={l(`删除 ${connection.model}`, `Remove ${connection.model}`)} onClick={() => void forgetConnection(key)}>{l("删除", "Remove")}</button></span>}</li>; })}</ul></section> : null}

      <details className="ai-settings-advanced"><summary>{l("高级设置 · 可选", "Advanced settings · optional")}<ChevronDown size={15} /></summary><div className="ai-settings-advanced-fields">
        <div className="settings-field">
          <label htmlFor={`${fieldId}-delivery`}>{zh ? "响应接收方式" : "Response delivery"}</label>
          <div className="settings-select-wrap">
            <select id={`${fieldId}-delivery`} value={settings.streaming === false ? "complete" : "stream"} onChange={(event) => setSettings({ ...settings, streaming: event.target.value === "stream" })}><option value="stream">{zh ? "逐步接收（推荐）" : "Streaming (recommended)"}</option><option value="complete">{zh ? "完整响应（兼容模式）" : "Complete response (compatibility)"}</option></select>
            <ChevronDown size={15} className="settings-select-chevron" aria-hidden="true" />
          </div>
          <small>{zh ? "如果自己的 API 不支持逐步返回，可切换兼容模式。两种方式都会校验完整结果。" : "Use compatibility mode if your API does not support streaming. Both modes validate the complete result."}</small>
        </div>
        {settings.provider !== "openai-compatible" ? <label>{t("baseUrlLabel")}<input value={settings.baseUrl} placeholder="https://api.openai.com/v1" onChange={(event) => { setSettings({ ...settings, baseUrl: event.target.value, apiKey: "", model: "", economyModel: "", embeddingModel: "" }); setStatus("idle"); }} /></label> : null}
        {settings.embeddingModel ? <label>{zh ? "语义索引版本" : "Semantic index version"}<input value={settings.embeddingVersion ?? "1"} onChange={(event) => setSettings({ ...settings, embeddingVersion: event.target.value })} /><small>{zh ? "仅在模型输出方式变化、需要重新建立索引时修改。" : "Change only when the model output changes and the index must be rebuilt."}</small></label> : null}
      {rebuildRequired ? <div className="settings-rebuild-notice"><p>{zh ? "Embedding 模型已变化。语义索引需要重新建立；在此之前仍可使用关键词搜索。" : "The embedding model changed. Rebuild the semantic index when ready; keyword search remains available."}</p><button type="button" className="import-button" disabled={rebuilding} onClick={() => { setRebuilding(true); void (async () => {
        if (aiMode(settings as AISettings) === "byok") {
          if (!settings.baseUrl || !settings.apiKey || !settings.model) throw new Error(t("fillAISettings"));
          if (!await requestProviderPermission(settings.baseUrl)) throw new Error(t("providerPermissionDenied"));
        }
        await saveAISettings(settings);
        await (await import("../../search/semantic-index")).rebuildSemanticIndex();
        setRebuildRequired(false);
      })().catch(() => setMessage({key:"connectionFailed"})).finally(() => setRebuilding(false)); }}>{rebuilding ? zh ? "重建中…" : "Rebuilding…" : zh ? "重建语义索引" : "Rebuild semantic index"}</button></div> : null}
      </div></details></fieldset>
    </div> : null}
    {tab === "ai" ? <footer className="settings-save-bar"><div className="ai-settings-actions">
        <button className="import-button" onClick={() => void test()} disabled={readOnly || status === "testing" || saving || !settings.model}>{status === "testing" ? <LoaderCircle className="spin" size={15} /> : status === "connected" ? <CheckCircle2 size={15} /> : null}{t("testConnection")}</button>
        <button className="import-button primary" disabled={readOnly || saving || status === "testing"} onClick={() => void save()}>{saving ? <LoaderCircle className="spin" size={15}/> : null}{t("saveSettings")}</button>
      </div>{messageText ? <p role={status === "failed" ? "alert" : "status"} className={status === "failed" ? "settings-feedback error" : "settings-feedback"}>{messageText}</p> : null}</footer> : null}
  </aside></>;
}
