import { generateFocusSession } from "../ai/focus-session";
import { wikiNamedProjects, withAnswersFrom } from "../ai/wiki-writing-questions";
import { wikiPrewritingProjectQuestions } from "../ai/wiki-project-decisions";
import type { AtlasMessage } from "../shared/messages";
import type { WikiProgress } from "../shared/wiki-knowledge";
import { sidecarWritingMode } from "../shared/wiki-writing-modes";
import type { ProjectUpdateLogEntry } from "../sidecar/project-update-log";
import { getDatabase } from "../storage/db";
import { getMessagesForConversation } from "../storage/messages";
import { updateSidecarFirstRun, type SidecarUpdateDraft } from "../storage/sidecar-update-drafts";
import { sourceVersion } from "../storage/source-versions";
import { sidecarProjectHead } from "../storage/sidecar-projects";
import { isDeletedProject } from "../storage/project-deletion";

const running = new Map<string, AbortController>();

function announce(projectId: string) {
  void chrome.runtime.sendMessage({ type: "ATLAS_FIRST_WIKI_CHANGED", projectId } satisfies AtlasMessage).catch(() => undefined);
}

/** Only the offscreen document owns the provider requests. Closing either visible view leaves this run intact. */
export async function runFirstWiki(draftId: string) {
  const existing = running.get(draftId);
  if (existing) return;
  const controller = new AbortController();
  running.set(draftId, controller);
  const { signal } = controller;
  try {
    const db = await getDatabase();
    const saved = await db.get("sidecarUpdateDrafts", draftId);
    const first = saved?.initialRun;
    if (!saved || !first?.input) return;
    const { project, version, zh } = first.input;
    const patch = (update: Parameters<typeof updateSidecarFirstRun>[2]) => updateSidecarFirstRun(draftId, first.id, update).then(next => {
      if (!next) controller.abort();
      return next;
    });
    let queue = Promise.resolve<unknown>(undefined);
    const persist = (update: Parameters<typeof updateSidecarFirstRun>[2]) => {
      const write = queue.then(async () => {
        signal.throwIfAborted();
        const next = await patch(update);
        if (next) announce(saved.projectId);
        return next;
      });
      queue = write.catch(error => { controller.abort(error); });
      return write;
    };
    const log = (draft: SidecarUpdateDraft, ...entries: Array<Omit<ProjectUpdateLogEntry, "at">>) =>
      [...draft.initialLog ?? [], ...entries.map(entry => ({ ...entry, at: Date.now() }))].slice(-240);
    const stages = new Map<WikiProgress["stage"], "started" | "finished">();
    const finishedChapters = new Set(first.partial?.sections.map(section => section.id));
    let phase: ProjectUpdateLogEntry["stage"] = "analyzing";
    let lastProgress = "";
    let lastUpdated = 0;
    const heartbeat = setInterval(() => {
      if (!signal.aborted && Date.now() - lastUpdated > 12_000) void persist(run => ({ initialRun: run })).catch(() => undefined);
    }, 12_000);
    try {
      await persist((run, draft) => ({ initialRun: { ...run, state: "running", error: undefined },
        initialLog: log(draft, { stage: "analyzing", state: "started", code: run.progress || run.partial ? "SIDECAR_RESUMED" : undefined }) }));
      const [source, messages, all, canvas] = await Promise.all([
        db.get("conversations", saved.conversationId), getMessagesForConversation(saved.conversationId, { cache: false }),
        db.getAll("focusSessions"), project.canvasId ? db.get("canvases", project.canvasId) : undefined,
      ]);
      const head = sidecarProjectHead(all, project);
      if (!source || !head || head.id !== project.id || head.updatedAt !== project.updatedAt || sidecarWritingMode(head) !== sidecarWritingMode(project)
        || project.canvasId && (!canvas || isDeletedProject(canvas)) || sourceVersion(source.id, messages, 0).id !== version.id) {
        throw Object.assign(new Error("Source or project changed"), { code: "SIDECAR_PREVIEW_STALE" });
      }
      const t = (cn: string, en: string) => zh ? cn : en;
      const document = await generateFocusSession((project.goal.trim() || project.title).slice(0, 500), "work", [source], zh ? "zh-CN" : "en", signal,
        undefined, undefined, first.id, (_completed, _total, _stage, detail) => {
          const step = detail?.ledger;
          if (!step || signal.aborted) return;
          phase = step.stage === "write" || step.stage === "proofread" ? "writing" : ["extract", "cover", "verify"].includes(step.stage) ? "analyzing" : "organizing";
          const entries: Array<Omit<ProjectUpdateLogEntry, "at">> = [];
          if (!stages.has(step.stage)) entries.push({ stage: phase, state: "started", wikiStage: step.stage, total: step.total });
          if (step.done >= step.total && stages.get(step.stage) !== "finished") {
            entries.push({ stage: phase, state: "finished", wikiStage: step.stage, completed: step.done, total: step.total });
            stages.set(step.stage, "finished");
          } else if (!stages.has(step.stage)) stages.set(step.stage, "started");
          const cursor = `${step.stage}:${step.done}:${step.total}`;
          if (cursor === lastProgress) return;
          lastProgress = cursor;
          lastUpdated = Date.now();
          void persist((run, draft) => ({ initialRun: { ...run, progress: { stage: step.stage, done: step.done, total: step.total } },
            ...(entries.length ? { initialLog: log(draft, ...entries) } : {}) })).catch(() => undefined);
        }, {
          complete: true, firstDocument: !project.sections.length, initialWritingMode: sidecarWritingMode(project), wikiProjectBoundary: { name: project.title, purpose: project.goal || undefined },
          onPartial: partial => {
            const sections = partial.sections.filter(section => finishedChapters.has(section.id) && !section.wikiOutline && section.reviewIssue !== "draft" && section.body.trim());
            if (!sections.length || signal.aborted) return;
            const evidenceIds = new Set(sections.flatMap(section => section.evidenceIds));
            const snapshot = { ...partial, wikiKnowledge: undefined, sections, evidence: partial.evidence.filter(ref => evidenceIds.has(ref.id)) };
            void persist(run => {
              const byId = new Map([...run.partial?.sections ?? [], ...snapshot.sections].map(section => [section.id, section]));
              const ordered = partial.sections.flatMap(section => byId.get(section.id) ?? []);
              const visibleEvidence = new Set(ordered.flatMap(section => section.evidenceIds));
              const evidence = new Map([...run.partial?.evidence ?? [], ...snapshot.evidence].filter(ref => visibleEvidence.has(ref.id)).map(ref => [ref.id, ref]));
              return { initialRun: { ...run, partial: { ...snapshot, sections: ordered, evidence: [...evidence.values()] } } };
            }).catch(() => undefined);
          },
          onWritingEvent: event => {
            if (event.kind === "chapter") finishedChapters.add(event.chapterId);
            void persist((_run, draft) => ({ initialLog: log(draft, { stage: "writing", state: event.kind === "chapter" ? "finished" : "started", writingEvent: event }) })).catch(() => undefined);
          },
          onKeyDecisions: async ledger => {
            const reviewed = first.ledger ? withAnswersFrom(ledger, first.ledger) : ledger;
            if (first.confirmed || !wikiPrewritingProjectQuestions(reviewed, zh).length && !wikiNamedProjects(reviewed).length) return reviewed;
            await persist((run, draft) => ({ initialRun: { ...run, state: "confirming", ledger: reviewed },
              initialLog: log(draft, { stage: "confirming", state: "started" }) }));
            while (!signal.aborted) {
              const latest = (await db.get("sidecarUpdateDrafts", draftId))?.initialRun;
              if (!latest || latest.id !== first.id) { controller.abort(); break; }
              if (latest.confirmed) {
                await persist((run, draft) => ({ initialRun: { ...run, state: "running" }, initialLog: log(draft, { stage: "confirming", state: "finished" }) }));
                return latest.ledger ?? reviewed;
              }
              await new Promise(resolve => setTimeout(resolve, 700));
            }
            signal.throwIfAborted();
            return reviewed;
          },
        });
      signal.throwIfAborted();
      if (!document.sections.some(section => section.body.trim())) throw new Error(t("首版没有可写入的正文。", "The first draft has no document text."));
      const organized = document.wikiKnowledge?.organization, counts = document.wikiKnowledge?.draft?.report;
      const summary = [
        organized?.report.source_structure_used ? t("目录沿用原文结构", "Directory follows the source structure")
          : organized?.status === "partial" ? t("部分目录核对待重试", "Some placement checks need a retry") : undefined,
        counts?.research_required ? t(`正文覆盖 ${counts.research_covered}/${counts.research_required}`, `Content coverage ${counts.research_covered}/${counts.research_required}`) : undefined,
        counts?.research_conclusions_required ? t(`设计启示 ${counts.research_conclusions_covered}/${counts.research_conclusions_required}`, `Takeaways ${counts.research_conclusions_covered}/${counts.research_conclusions_required}`) : undefined,
        counts?.write_supplements ? t(`补写请求 ${counts.write_supplements} 次`, `${counts.write_supplements} follow-up writing requests`) : undefined,
      ].filter(Boolean).join(" · ");
      await persist((_run, draft) => ({ initialRun: undefined, initialDocument: { project, version, document },
        initialLog: log(draft, { stage: "writing", state: "finished", code: "SIDECAR_FIRST_PREVIEW_READY", ...(summary ? { reason: summary } : {}) }) }));
    } catch (error) {
      await queue;
      const paused = signal.aborted && (signal.reason instanceof DOMException && signal.reason.name === "AbortError");
      const code = error && typeof error === "object" && "code" in error && typeof error.code === "string" && /^[A-Za-z_0-9:-]{1,90}$/u.test(error.code) ? error.code : undefined;
      const label = paused ? undefined : code === "SIDECAR_PREVIEW_STALE"
        ? (zh ? "原始对话或项目已有变化。请从当前对话重新准备首版。" : "The source or project changed. Prepare a new draft from the current chat.")
        : (zh ? "整理未完成。已保存的进度和章节可继续查看。" : "Generation stopped. Saved progress and chapters are available.");
      if (await patch((run, draft) => ({ initialRun: { ...run, state: paused ? "paused" : "failed", error: label },
        initialLog: log(draft, { stage: phase, state: paused ? "partial" : "failed", code: paused ? "SIDECAR_PAUSED" : code, reason: label }) }))) announce(saved.projectId);
    } finally { clearInterval(heartbeat); }
  } finally { running.delete(draftId); }
}

chrome.runtime.onMessage.addListener((message: AtlasMessage, sender, reply) => {
  if (message.type !== "ATLAS_FIRST_WIKI_EXECUTE" && message.type !== "ATLAS_FIRST_WIKI_STOP_EXECUTION") return false;
  if (sender.id !== chrome.runtime.id || sender.url && !sender.url.startsWith(chrome.runtime.getURL(""))) return false;
  if (message.type === "ATLAS_FIRST_WIKI_EXECUTE") {
    void runFirstWiki(message.draftId).catch(() => undefined);
    reply({ ok: true });
  } else if (message.type === "ATLAS_FIRST_WIKI_STOP_EXECUTION") {
    running.get(message.draftId)?.abort();
    reply({ ok: true });
  }
  return false;
});
