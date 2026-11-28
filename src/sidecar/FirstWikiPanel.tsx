import { BookOpen, ChevronDown, Pause, Play, ScrollText } from "lucide-react";
import { useId, useState } from "react";
import { createPortal } from "react-dom";
import { DecisionSteps } from "../canvas/components/DecisionSteps";
import { WikiChapterBody } from "../canvas/components/WikiChapterOverview";
import type { WikiKnowledgeLedger } from "../shared/wiki-knowledge";
import type { FocusSession } from "../shared/focus-session";
import { discardSidecarDraft, sidecarFirstRunActive, updateSidecarFirstRun, type SidecarUpdateDraft } from "../storage/sidecar-update-drafts";
import { commandFirstWiki, wikiStageLabel } from "./first-wiki-client";
import { ProjectUpdateLog } from "./ProjectUpdateLog";
import { projectUpdateIssue } from "./project-update-state";
import "./first-wiki-progress.css";

export function FirstWikiPanel({ draft, zh, actionsHost, saving, stale, onSave, onSaved, onSettings }: {
  draft: SidecarUpdateDraft; zh: boolean; actionsHost?: HTMLElement | null; saving?: boolean; stale?: boolean;
  onSave?: () => void; onSaved?: (session: FocusSession) => void; onSettings: () => void;
}) {
  const [chapterId, setChapterId] = useState<string>();
  const [logOpen, setLogOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [error, setError] = useState("");
  const initial = draft.initialRun;
  const ready = draft.initialDocument;
  const active = sidecarFirstRunActive(draft);
  const t = (cn: string, en: string) => zh ? cn : en;
  const progress = initial?.progress;
  const document = ready?.document ?? initial?.partial;
  const controlId = useId();
  const locked = busy || saving;
  const label = ready ? t("首版文档待保存", "First document ready to save") : initial?.state === "confirming" && active ? t("等待写作前确认", "Waiting for confirmation")
    : !active ? t("首版整理已暂停", "First document paused") : progress ? wikiStageLabel[progress.stage][zh ? 0 : 1] : t("正在准备首版文档…", "Preparing the first document…");
  const decide = async (apply: (ledger: WikiKnowledgeLedger) => WikiKnowledgeLedger) => {
    if (!initial) return;
    try {
      await updateSidecarFirstRun(draft.id, initial.id, run => {
        if (run.state !== "confirming" || run.confirmed || !run.ledger) return {};
        return { initialRun: { ...run, ledger: apply(run.ledger), confirmed: true } };
      });
      void chrome.runtime.sendMessage({ type: "ATLAS_FIRST_WIKI_CHANGED", projectId: draft.projectId }).catch(() => undefined);
    } catch { setError(t("回答未保存，请重试。", "Could not save the answer. Try again.")); }
  };
  const runAction = async (action: "start" | "pause" | "save" | "discard") => {
    setBusy(true); setError("");
    try {
      if (action === "save") {
        const { applySidecarFirstDocument } = await import("./project-increment");
        const saved = await applySidecarFirstDocument(draft, zh, new AbortController().signal);
        onSaved?.(saved);
        void chrome.runtime.sendMessage({ type: "ATLAS_FIRST_WIKI_CHANGED", projectId: draft.projectId, savedSessionId: saved.id }).catch(() => undefined);
      } else if (action === "discard") {
        await discardSidecarDraft(draft);
        void chrome.runtime.sendMessage({ type: "ATLAS_FIRST_WIKI_CHANGED", projectId: draft.projectId }).catch(() => undefined);
      } else await commandFirstWiki(draft.id, action === "pause");
    } catch (failure) {
      const issue = projectUpdateIssue(failure, action === "save" ? "saving" : "analyzing", zh);
      setError(action === "discard" ? t("草稿已有变化，请重试。", "The draft changed. Try again.") : issue.message);
      if (issue.action === "settings") onSettings();
    } finally { setBusy(false); }
  };
  const footerActions = !active && (confirmDiscard ? <>
    <button type="button" disabled={locked} onClick={() => setConfirmDiscard(false)}>{t("取消", "Cancel")}</button>
    <button type="button" disabled={locked} onClick={() => void runAction("discard")}>{t("确认丢弃", "Discard draft")}</button>
  </> : <>
    <button type="button" disabled={locked} onClick={() => setConfirmDiscard(true)}>{t("丢弃草稿", "Discard draft")}</button>
    {ready ? <button className="primary" type="button" disabled={locked || stale}
      onClick={onSave ?? (() => void runAction("save"))}>{t("保存首版", "Save first document")}</button>
      : initial?.input && <button type="button" className="primary" disabled={locked} onClick={() => void runAction("start")}>
        <Play size={14} aria-hidden="true"/>{t("继续整理", "Resume generation")}
      </button>}
  </>);
  return <section className="first-wiki-progress" aria-label={ready ? t("首版文档预览", "First document preview") : t("首版整理进度", "First document progress")}>
    <header>
      <BookOpen size={16} aria-hidden="true"/><strong>{label}</strong>
      {active && initial?.input && <button type="button" disabled={locked} className="first-wiki-pause" aria-label={t("暂停整理", "Pause generation")}
        title={t("暂停整理", "Pause generation")} onClick={() => void runAction("pause")}>
        <Pause size={15} aria-hidden="true"/><span>{t("暂停整理", "Pause generation")}</span>
      </button>}
      <button type="button" aria-label={t("生成日志", "Generation log")} title={t("生成日志", "Generation log")} aria-expanded={logOpen}
        aria-controls={logOpen ? controlId + "-log" : undefined} onClick={() => setLogOpen(value => !value)}><ScrollText size={16} aria-hidden="true"/></button>
    </header>
    {active && initial?.state !== "confirming" && <div className="first-wiki-meter">
      <progress value={progress?.total ? progress.done : undefined} max={progress?.total || undefined} aria-label={label}/>
      {progress && progress.total > 0 && <small>{progress.done} / {progress.total}</small>}
    </div>}
    {error || initial?.error ? <p role="alert">{error || initial?.error}</p> : null}
    {stale && <p role="status">{t("项目有新版本，首版草稿已保留。", "The project has a newer version. This draft is kept.")}</p>}
    {initial?.state === "confirming" && active && !initial.confirmed && initial.ledger && <DecisionSteps key={initial.id} ledger={initial.ledger} zh={zh} onDone={(_counts, apply) => void decide(apply)}/>}
    {logOpen && <ProjectUpdateLog entries={draft.initialLog ?? []} zh={zh} id={controlId + "-log"}/>}
    {document && document.sections.length > 0 && <div className="first-wiki-chapters">
      <h3>{t("已写章节", "Written chapters")} <small>{document.sections.length}</small></h3>
      <ul>{document.sections.map((section, index) => {
        const expanded = section.id === chapterId;
        const id = `${controlId}-chapter-${index}`;
        const title = section.wikiDisplayTitle || section.title;
        const evidenceIds = expanded ? new Set([...section.evidenceIds, ...(section.claims ?? []).flatMap(claim => claim.evidenceIds)]) : undefined;
        const sources = evidenceIds ? document.evidence.filter(ref => evidenceIds.has(ref.id)) : [];
        return <li key={section.id}>
          <button type="button" className="first-wiki-chapter-toggle" aria-expanded={expanded} aria-controls={id}
            onClick={() => setChapterId(expanded ? undefined : section.id)}>
            <span>{title}</span><ChevronDown size={15} aria-hidden="true"/>
          </button>
          <div id={id} className="first-wiki-chapter" hidden={!expanded}>
            {expanded && <WikiChapterBody section={section} zh={zh} hideProposalStatus statusInHeading hideVersionCards sourceTexts={sources.map(ref => ref.excerpt)}/>}
          </div>
        </li>;
      })}</ul>
    </div>}
    {footerActions && (actionsHost === undefined ? <footer className="first-wiki-actions">{footerActions}</footer>
      : actionsHost && createPortal(footerActions, actionsHost))}
  </section>;
}
