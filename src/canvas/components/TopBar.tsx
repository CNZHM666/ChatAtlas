import { Languages, Moon, Plus, Redo2, Settings, Sun, Undo2 } from "lucide-react";
import { ReaderToolbarSlot } from "./ReaderToolbar";
import type { CanvasMode } from "../views/ConversationCanvas";
import { usePreferences } from "../preferences";
import type { ReactNode } from "react";
import { BrandMark } from "../../shared/BrandMark";

export type PrimaryView = "canvas" | "conversations";

interface TopBarProps {
  syncStatus?: ReactNode;
  generationProgressRef?: (element: HTMLDivElement | null) => void;
  onHome?: () => void;
  structureView?: boolean;
  onStructureChange?: (value: boolean) => void;
  view: PrimaryView;
  onNewCard: () => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  mode: CanvasMode;
  onModeChange: (mode: CanvasMode) => void;
  minimal?: boolean;
  onSettings: () => void;
  allowEdit?: boolean;
  organizeProgress?: { label: string; detail: string } | null;
  onCancelOrganize?: () => void;
}

export function TopBar(props: TopBarProps) {
  const { locale, setLocale, theme, setTheme, t } = usePreferences();
  const canvasStatus = t("canvasHint");
  return (
    <header className="topbar">
      <button type="button" className="brand brand-home" onClick={props.onHome} aria-label={locale === "zh-CN" ? "ChatAtlas 首页" : "ChatAtlas home"}>
        <BrandMark className="brand-mark" />
        <span>ChatAtlas</span>
      </button>
      {!props.minimal && props.view === "canvas" && props.allowEdit !== false ? <div className="topbar-canvas-status" title={canvasStatus}><span>{canvasStatus}</span></div> : null}
      <div className="topbar-actions">
        <ReaderToolbarSlot />
        {props.syncStatus}
        {props.onStructureChange ? <button className="structure-toggle" onClick={() => props.onStructureChange?.(!props.structureView)}>{props.view === "conversations" ? props.structureView ? locale === "zh-CN" ? "连续原文" : "Continuous discussion" : locale === "zh-CN" ? "章节结构" : "Chapter structure" : props.structureView ? locale === "zh-CN" ? "阅读目录" : "Reading contents" : locale === "zh-CN" ? "知识关系" : "Knowledge map"}</button> : null}
        {props.organizeProgress ? <div className="topbar-organize-progress" role="status" aria-live="polite"><span>{props.organizeProgress.label}<small>{props.organizeProgress.detail}</small></span><button onClick={props.onCancelOrganize} aria-label={t("organizeCancel")} title={t("organizeCancel")}>×</button></div> : null}
        {!props.minimal ? <>{props.allowEdit !== false ? <div className="mode-switch" aria-label={t("canvasMode")}>
          <button className={props.mode === "browse" ? "active" : ""} onClick={() => props.onModeChange("browse")}>{t("browseMode")}</button>
          <button className={props.mode === "edit" ? "active" : ""} onClick={() => props.onModeChange("edit")}>{t("editMode")}</button>
        </div> : null}
        {props.allowEdit !== false ? <><button className="icon-button history-button" onClick={props.onUndo} disabled={!props.canUndo} title={`${t("undo")} (Ctrl/Cmd + Z)`}><Undo2 size={17} /></button>
        <button className="icon-button history-button" onClick={props.onRedo} disabled={!props.canRedo} title={`${t("redo")} (Ctrl/Cmd + Shift + Z)`}><Redo2 size={17} /></button></> : null}
        {props.allowEdit !== false && props.mode === "edit" ? <button className="icon-button primary" onClick={props.onNewCard} title={t("newCard")}><Plus size={18} /></button> : null}
        </> : null}
        <div className="topbar-generation-slot" ref={props.generationProgressRef} />
        <button className="icon-button" onClick={props.onSettings} title={t("settings")} aria-label={t("settings")}><Settings size={17} /></button>
        <button className="icon-button" onClick={() => setLocale(locale === "en" ? "zh-CN" : "en")} title={locale === "en" ? t("switchChinese") : t("switchEnglish")}><Languages size={17} /></button>
        <button className="icon-button" onClick={() => setTheme(theme === "light" ? "dark" : "light")} title={theme === "light" ? t("darkMode") : t("lightMode")}>{theme === "light" ? <Moon size={17} /> : <Sun size={17} />}</button>
      </div>
    </header>
  );
}
