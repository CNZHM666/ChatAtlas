import { useEffect, useRef, useState } from "react";
import { ChevronDown, Dices, Download, FilePen, LayoutList, Network, Play, Plus, RefreshCw, ScanText, Trash2 } from "lucide-react";
import { ledgerPipelineEnabled, WIKI_LEGACY_PIPELINE_FLAG } from "../../ai/wiki-ledger-document";
import { reextractSessionKnowledge, updateSessionKnowledge } from "../../ai/wiki-knowledge-session";
import { organizeLedger } from "../../ai/wiki-knowledge-organize";
import { writeLedgerDraft } from "../../ai/wiki-knowledge-write";
import { embeddingsFor } from "../../ai/embedding-provider";
import { createAtlasAI } from "../../ai/atlas-ai";
import { analyzeOrganizationRuns, organizationAnalysisCsv } from "../../ai/usage-analysis";
import { listAnalysisDiagnostics } from "../../ai/semantic-analysis";
import { wikiDraftMarkdown, wikiLedgerUnits, type WikiKnowledgeLedger, type WikiProgress } from "../../shared/wiki-knowledge";
import type { FocusSession } from "../../shared/focus-session";
import { wikiStageCount, wikiStageName } from "../../shared/wiki-progress-labels";
import type { Conversation } from "../../shared/types";
import { deleteLedgerTestSession, listFocusSessions, listLedgerTestSessions, saveFocusSession } from "../../storage/focus-sessions";
import { getAISettings } from "../../storage/knowledge-graph";
import { getConversation, listConversations } from "../../storage/conversations";
import { getMessagesForConversation } from "../../storage/messages";
import { listAIUsage } from "../../storage/ai-usage";
import { listOrganizationRuns, saveOrganizationRun } from "../../storage/organization-runs";

// rewrite: writing again without the stored model answers, a fresh sample to compare runs with.
// replan: organizing without keeping the earlier directory, so a changed planning rule takes effect.
type Step = "all" | "update" | "extract" | "organize" | "replan" | "write" | "rewrite";

/** Wiki generation tests: ledger tests made straight from picked conversations,
 * and documents that keep a ledger, each rerunnable from the step whose rules
 * changed and exportable for evaluation. Steps here never change a document's
 * own sections; the earlier pipeline stays behind a fallback switch. */
export function DeveloperKnowledgeUnits({ zh }: { zh: boolean }) {
  const l = (cn: string, en: string) => zh ? cn : en;
  // New documents are written from the ledger; this fallback writes them with the earlier pipeline instead.
  const [legacy, setLegacy] = useState(() => !ledgerPipelineEnabled());
  const [sessions, setSessions] = useState<FocusSession[]>([]);
  const [busy, setBusy] = useState<{ id: string; step: Step | "export" }>(), [error, setError] = useState("");
  const [progress, setProgress] = useState<WikiProgress>();
  const abort = useRef<AbortController>(undefined);
  // Ledger tests made from picked conversations, then documents with a ledger.
  const load = () => Promise.all([listFocusSessions(), listLedgerTestSessions()]).then(([documents, tests]) => setSessions([...tests, ...documents.filter(item => item.wikiKnowledge)])).catch(() => setSessions([]));
  // A ledger test: conversations picked here, read straight into a ledger, with no document generated first.
  const [picking, setPicking] = useState(false), [conversations, setConversations] = useState<Conversation[]>([]), [chosen, setChosen] = useState<string[]>([]), [query, setQuery] = useState(""), [testTitle, setTestTitle] = useState("");
  const openPicker = () => { setPicking(true); setChosen([]); setQuery(""); setTestTitle(""); void listConversations().then(items => setConversations(items.filter(item => (item.messageCount ?? 0) > 0))).catch(() => setConversations([])); };
  useEffect(() => { void load(); return () => abort.current?.abort(); }, []);
  const toggleLegacy = (value: boolean) => { try { if (value) localStorage.setItem(WIKI_LEGACY_PIPELINE_FLAG, "1"); else localStorage.removeItem(WIKI_LEGACY_PIPELINE_FLAG); } catch { /* Storage blocked: the ledger pipeline stays on. */ } setLegacy(!ledgerPipelineEnabled()); };
  const save = (text: string, name: string, type: string) => {
    const url = URL.createObjectURL(new Blob([text], { type })), link = document.createElement("a");
    link.href = url; link.download = name; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 0);
  };
  // Everything an evaluation needs at once: the draft, the ledger and this document's run CSV.
  const exportAll = async (session: FocusSession) => {
    setBusy({ id: session.id, step: "export" }); setError("");
    try {
      // A ledger test's id starts with a fixed prefix: its end tells tests apart.
      const ledger = session.wikiKnowledge!, tag = session.ledgerTest ? session.id.slice(-8) : session.id.slice(0, 8);
      if (ledger.draft) {
        // Titles and full original messages, so each footnote quotes enough to check its paragraph.
        const titles = Object.fromEntries((await Promise.all(session.sourceConversationIds.map(id => getConversation(id)))).flatMap(item => item ? [[item.id, item.title]] : []));
        const messages = Object.fromEntries((await Promise.all(session.sourceConversationIds.map(id => getMessagesForConversation(id).catch(() => [])))).flat().map(message => [message.id, message.content]));
        save(wikiDraftMarkdown(ledger, session.title, session.locale ?? "zh-CN", titles, messages), `knowledge-draft-${tag}.md`, "text/markdown;charset=utf-8");
      }
      save(JSON.stringify({ title: session.title, runId: session.runId, ledger }, null, 2), `knowledge-units-${tag}.json`, "application/json");
      const [runs, events, diagnostics, focus] = await Promise.all([listOrganizationRuns(), listAIUsage(), listAnalysisDiagnostics(), listFocusSessions()]);
      const row = analyzeOrganizationRuns(runs, events, diagnostics, focus).find(item => item.run.id === session.runId);
      if (row) save(organizationAnalysisCsv([row]), `ai-organization-analysis-${tag}.csv`, "text/csv;charset=utf-8");
      else setError(l("账本已导出；这份文档没有可导出的任务记录", "Ledger exported; this document has no run record to export"));
    } catch { setError(l("导出失败，请重试", "Export failed; retry")); }
    finally { setBusy(undefined); }
  };
  // Steps on the saved document, without regenerating the Wiki: P1 extracts, P2 organizes, P3 writes.
  const run = async (session: FocusSession, step: Step, confirmed = false) => {
    // A full reading pass that also discards the organization and draft built from the old units.
    if (step === "extract" && !window.confirm(l("重新抽取会再读一遍全部原文（约一次完整阅读的用量），并清除现有的整理结果和草稿。继续吗？", "Extracting again reads every original once more (about one full reading pass) and clears the current organization and draft. Continue?"))) return;
    if (step === "all" && !confirmed && !window.confirm(l("一键运行会依次重新抽取、整理和写作：再读一遍全部原文并替换现有的整理结果和草稿，用量约为三步之和。继续吗？", "Run all extracts, organizes and writes again in turn: every original is read once more and the current organization and draft are replaced, costing about the three steps together. Continue?"))) return;
    abort.current?.abort(); const controller = new AbortController(); abort.current = controller;
    setBusy({ id: session.id, step }); setError(""); setProgress(undefined);
    const started = Date.now();
    // The step that failed, for the message; one-click runs pass through all three.
    let failing: Step = step;
    try {
      const runId = session.runId ?? session.id, settings = await getAISettings();
      if (!settings) throw new Error("no AI settings");
      // Each stage reports requests done of its total; the bar shows the current stage.
      const common = { ai: createAtlasAI(settings, controller.signal, runId), ...embeddingsFor(settings, runId), locale: session.locale ?? "zh-CN", signal: controller.signal, runId, progress: (next: WikiProgress) => { if (abort.current === controller) setProgress(next); } };
      let ledger: WikiKnowledgeLedger;
      const names = [session.wikiProjectBoundary?.name, session.title, session.goal.length <= 32 ? session.goal : undefined];
      // The directory a reorganization keeps while its subjects still fall into it, so chapters stay put.
      const directory = session.wikiKnowledge?.organization;
      if (step === "all") {
        // Each finished step is saved, so a later failure keeps what was done and its own button resumes.
        failing = "extract"; ledger = await reextractSessionKnowledge(session, common.ai, controller.signal, undefined, common.progress);
        await saveFocusSession({ ...session, wikiKnowledge: ledger }); await load();
        failing = "organize"; ledger = await organizeLedger(ledger, { ...common, conversations: session.sourceConversationIds.length, names, directory });
        if (!ledger.organization || ledger.lastFailure?.step === "organize") throw new Error("organization failed");
        await saveFocusSession({ ...session, wikiKnowledge: ledger }); await load();
        failing = "write"; ledger = await writeLedgerDraft(ledger, { ...common, project: session.wikiProjectBoundary?.name });
        if (!ledger.draft) throw new Error("writing failed");
      } else if (step === "update") ledger = await updateSessionKnowledge(session, common.ai, controller.signal, { names, project: session.wikiProjectBoundary?.name, progress: common.progress });
      else if (step === "extract") ledger = await reextractSessionKnowledge(session, common.ai, controller.signal, undefined, common.progress);
      else if (step === "organize" || step === "replan") {
        ledger = await organizeLedger(session.wikiKnowledge!, { ...common, conversations: session.sourceConversationIds.length, names, ...(step === "organize" ? { directory } : { fresh: true }) });
        if (!ledger.organization) throw new Error("organization failed");
      } else {
        ledger = await writeLedgerDraft(session.wikiKnowledge!, { ...common, project: session.wikiProjectBoundary?.name, fresh: step === "rewrite" });
        if (!ledger.draft) throw new Error("writing failed");
      }
      // A step that produced nothing usable kept the earlier result; it is saved with the mark and named.
      await saveFocusSession({ ...session, wikiKnowledge: ledger }); await load();
      const failed = ledger.lastFailure && ledger.lastFailure.at >= started ? ledger.lastFailure.step : undefined;
      if (failed && !controller.signal.aborted) setError(failed === "organize" ? l("整理没有得到目录（请求失败），已保留上一版整理结果；检查网络后再试", "Organizing produced no directory (requests failed); the earlier organization was kept. Check the connection and retry") : l("写作没有写出任何段落（请求失败），已保留上一版草稿；检查网络后再试", "Writing produced no paragraph (requests failed); the earlier draft was kept. Check the connection and retry"));
    } catch { if (!controller.signal.aborted) setError({ update: l("更新失败，请检查原文和 AI 设置后重试", "Update failed; check the sources and AI settings, then retry"), extract: l("抽取失败，请检查原文和 AI 设置后重试", "Extraction failed; check the sources and AI settings, then retry"), organize: l("整理失败，请检查 AI 设置后重试", "Organizing failed; check AI settings and retry"), replan: l("整理失败，请检查 AI 设置后重试", "Organizing failed; check AI settings and retry"), write: l("写作失败，请检查 AI 设置后重试", "Writing failed; check AI settings and retry"), rewrite: l("写作失败，请检查 AI 设置后重试", "Writing failed; check AI settings and retry"), all: "" }[failing]); }
    finally { if (abort.current === controller) { setBusy(undefined); setProgress(undefined); } }
  };
  // The test is saved first, with an empty ledger and its own run record (the CSV export reads it), then run.
  const startTest = async () => {
    const picked = conversations.filter(item => chosen.includes(item.id));
    if (!picked.length || busy) return;
    const now = Date.now(), title = testTitle.trim() || picked[0].title || l("知识点测试", "Ledger test"), runId = `focus-${crypto.randomUUID()}`, locale = zh ? "zh-CN" as const : "en" as const;
    const session: FocusSession = { id: `ledger-test:${crypto.randomUUID()}`, ledgerTest: true, status: "preview", goal: title, mode: "work", locale, title, runId, sourceConversationIds: picked.map(item => item.id), evidence: [], sections: [], activeSectionId: "", completedSectionIds: [], notes: "", createdAt: now, updatedAt: now,
      wikiKnowledge: { version: 1, generatedAt: now, status: "partial", materials: 0, batches: [] } };
    try {
      await saveOrganizationRun({ id: runId, title, targetType: "conversation", targetIds: session.sourceConversationIds, startedAt: now, updatedAt: now, status: "completed", stage: "proposal_ready", progress: 1, events: [] });
      await saveFocusSession(session);
    } catch { setError(l("测试账本创建失败，请重试", "Could not create the ledger test; retry")); return; }
    setPicking(false); await load();
    await run(session, "all", true);
  };
  const removeTest = async (session: FocusSession) => {
    if (!window.confirm(l(`删除测试账本“${session.title}”？对话本身不受影响。`, `Delete the ledger test "${session.title}"? The conversations are unaffected.`))) return;
    try { await deleteLedgerTestSession(session.id); await load(); } catch { setError(l("删除失败，请重试", "Delete failed; retry")); }
  };
  const shown = query.trim() ? conversations.filter(item => item.title.toLowerCase().includes(query.trim().toLowerCase())) : conversations;
  const working: Record<Step | "export", string> = { all: l("正在一键运行…", "Running all steps…"), update: l("正在增量更新…", "Updating…"), extract: l("正在抽取…", "Extracting…"), organize: l("正在整理…", "Organizing…"), replan: l("正在重新规划目录…", "Planning the directory again…"), write: l("正在写作…", "Writing…"), rewrite: l("正在不用缓存重写…", "Rewriting without stored answers…"), export: l("正在导出…", "Exporting…") };
  // The step menu closes once a step is chosen.
  const closeMenu = (event: { currentTarget: HTMLElement }) => event.currentTarget.closest("details")?.removeAttribute("open");
  return <section className="developer-units" aria-label={l("Wiki 生成测试", "Wiki generation tests")}>
    <div className="developer-units-heading"><div><strong>{l("Wiki 生成测试", "Wiki generation tests")}</strong>
      <small>{l("从对话直接新建测试，按步骤重跑并导出评测文件；不影响项目文档。", "Start a test straight from conversations, rerun any step and export files for evaluation; project documents are unaffected.")}</small></div>
      {picking ? null : <button type="button" className="developer-units-new" disabled={Boolean(busy)} onClick={openPicker}><Plus size={14} aria-hidden="true" />{l("新建测试", "New test")}</button>}</div>
    {picking ? <div className="developer-units-picker">
      <input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder={l("搜索对话标题", "Search conversation titles")} aria-label={l("搜索对话标题", "Search conversation titles")} />
      <ul aria-label={l("选择要抽取的对话", "Conversations to extract")}>{shown.slice(0, 200).map(item => <li key={item.id}><label><input type="checkbox" checked={chosen.includes(item.id)} onChange={event => setChosen(event.target.checked ? [...chosen, item.id] : chosen.filter(id => id !== item.id))} /><span>{item.title || l("未命名对话", "Untitled")}</span><small>{item.platform} · {l(`${item.messageCount} 条`, `${item.messageCount} messages`)}</small></label></li>)}</ul>
      <input type="text" value={testTitle} onChange={event => setTestTitle(event.target.value)} placeholder={l("测试名称（默认用第一个对话的标题）", "Test name (defaults to the first conversation's title)")} aria-label={l("测试名称", "Test name")} />
      <div className="developer-units-picker-actions"><small>{l(`已选 ${chosen.length} 个对话`, `${chosen.length} selected`)}</small>
        <button type="button" onClick={() => setPicking(false)}>{l("取消", "Cancel")}</button>
        <button type="button" className="primary" disabled={!chosen.length || Boolean(busy)} onClick={() => void startTest()}>{l("抽取、整理并写作", "Extract, organize and write")}</button></div>
    </div> : null}
    {sessions.length ? <ul className="developer-units-list">{sessions.map(session => {
      const ledger = session.wikiKnowledge!, units = wikiLedgerUnits(ledger), failed = ledger.batches.filter(batch => batch.status === "failed").length, plan = ledger.organization, draft = ledger.draft;
      const summary = plan ? l(` · ${plan.subjects.length} 个主题 · ${plan.chapters.length} 章`, ` · ${plan.subjects.length} subjects · ${plan.chapters.length} chapters`) : "";
      // A draft older than the organization was written from the previous directory.
      const stale = Boolean(draft && plan && draft.generatedAt < plan.generatedAt);
      // A draft that ran to the end is not yet one that passed: the warning line says what still fails.
      const quality = draft?.quality, unchecked = Boolean(draft && !stale && quality && (!quality.passed || quality.uncovered));
      const checks = quality ? l(`未通过检查：${[quality.critical ? `${quality.critical} 项关键问题` : "", quality.failedBatches ? "原文不完整" : "", quality.organization === "partial" ? "整理不完整" : "", quality.uncovered ? `${quality.uncovered} 条原话未抽出` : ""].filter(Boolean).join("、")}`, `checks failing: ${[quality.critical ? `${quality.critical} key problems` : "", quality.failedBatches ? "sources incomplete" : "", quality.organization === "partial" ? "organizing incomplete" : "", quality.uncovered ? `${quality.uncovered} user messages uncovered` : ""].filter(Boolean).join(", ")}`) : "";
      const facts = l(`${units.length} 个知识点${summary}${draft ? stale ? " · 草稿待重写" : " · 有草稿" : ""}`, `${units.length} units${summary}${draft ? stale ? " · draft out of date" : " · draft" : ""}`);
      const warnings = [unchecked ? checks : "", failed ? l(`${failed} 批抽取失败`, `${failed} batches failed`) : "", ledger.lastFailure ? ledger.lastFailure.step === "organize" ? l("上次整理失败，保留上一版", "last organizing failed, earlier kept") : l("上次写作失败，保留上一版", "last writing failed, earlier kept") : ""].filter(Boolean).join(l("；", "; "));
      const mine = busy?.id === session.id, running = mine && progress;
      const status = running ? `${wikiStageName(progress.stage, zh, true)} · ${wikiStageCount(progress, zh)}` : mine ? working[busy.step] : facts;
      const written = Boolean(plan?.chapters.length);
      return <li key={session.id} className={mine ? "is-running" : undefined}>
        <div className="developer-unit-title"><span className="developer-unit-kind">{session.ledgerTest ? l("测试", "Test") : l("文档", "Document")}</span><strong title={session.title}>{session.title}</strong>
          {session.ledgerTest ? <button type="button" className="developer-unit-delete" disabled={Boolean(busy)} aria-label={l(`删除测试账本“${session.title}”`, `Delete the ledger test ${session.title}`)} title={l("删除这个测试", "Delete this test")} onClick={() => void removeTest(session)}><Trash2 size={14} aria-hidden="true" /></button> : null}</div>
        <small className="developer-unit-status" aria-live={mine ? "polite" : undefined}>{status}</small>
        {!mine && warnings ? <small className="developer-unit-warning">{warnings}</small> : null}
        {running ? <progress className="developer-units-progress" value={progress.done} max={Math.max(progress.total, 1)} aria-label={l(`${wikiStageName(progress.stage, zh)}进度`, `${wikiStageName(progress.stage, zh)} progress`)} /> : null}
        <div className="developer-units-actions">
          <button type="button" disabled={Boolean(busy)} aria-label={l(`一键抽取、整理并写作“${session.title}”`, `Extract, organize and write ${session.title} in one go`)} title={l("重新抽取 → 整理 → 写作（调用模型）", "Extract → organize → write again (uses the model)")} onClick={() => void run(session, "all")}><Play size={14} aria-hidden="true" />{l("全部重跑", "Run all")}</button>
          <button type="button" disabled={Boolean(busy)} aria-label={l(`增量更新“${session.title}”`, `Update ${session.title}`)} title={l("只重读、重整理、重写有变化的部分", "Read, organize and write only what changed")} onClick={() => void run(session, "update")}><RefreshCw size={14} aria-hidden="true" />{l("增量更新", "Update")}</button>
          <details className="developer-export-menu developer-unit-steps"><summary aria-disabled={Boolean(busy)}>{l("单步", "One step")}<ChevronDown size={13} aria-hidden="true" /></summary><div>
            <button type="button" disabled={Boolean(busy)} aria-label={l(`重新抽取“${session.title}”的知识点`, `Extract the knowledge units of ${session.title} again`)} onClick={event => { closeMenu(event); void run(session, "extract"); }}><ScanText size={14} aria-hidden="true" /><span>{l("重新抽取", "Extract again")}<small>{l("再读全部原文，清除整理和草稿", "Reads every original; clears organization and draft")}</small></span></button>
            <button type="button" disabled={Boolean(busy)} aria-label={l(`整理“${session.title}”的主题与目录`, `Organize subjects and directory of ${session.title}`)} onClick={event => { closeMenu(event); void run(session, "organize"); }}><Network size={14} aria-hidden="true" /><span>{l("整理", "Organize")}<small>{l("主题与目录，沿用上一版目录", "Subjects and directory, keeping the earlier one")}</small></span></button>
            <button type="button" disabled={Boolean(busy)} aria-label={l(`重新规划“${session.title}”的目录`, `Plan the directory of ${session.title} again`)} onClick={event => { closeMenu(event); void run(session, "replan"); }}><LayoutList size={14} aria-hidden="true" /><span>{l("重新规划目录", "Plan the directory again")}<small>{l("整理时不沿用上一版目录", "Organizes without the earlier directory")}</small></span></button>
            {written ? <button type="button" disabled={Boolean(busy)} aria-label={l(`按目录写“${session.title}”的草稿`, `Write the draft of ${session.title} from the directory`)} onClick={event => { closeMenu(event); void run(session, "write"); }}><FilePen size={14} aria-hidden="true" /><span>{l("写作", "Write")}<small>{l("按当前目录写草稿", "Writes the draft from the directory")}</small></span></button> : null}
            {written ? <button type="button" disabled={Boolean(busy)} aria-label={l(`不用缓存重写“${session.title}”的草稿`, `Rewrite the draft of ${session.title} without stored answers`)} onClick={event => { closeMenu(event); void run(session, "rewrite"); }}><Dices size={14} aria-hidden="true" /><span>{l("不用缓存重写", "Rewrite fresh")}<small>{l("每个请求重新调用模型，用来对比多版", "Calls the model again, to compare drafts")}</small></span></button> : null}
          </div></details>
          <button type="button" disabled={Boolean(busy)} aria-label={l(`导出“${session.title}”的草稿、账本和任务 CSV`, `Export the draft, ledger and run CSV of ${session.title}`)} title={l("草稿 Markdown、账本 JSON 和任务 CSV", "Draft Markdown, ledger JSON and run CSV")} onClick={() => void exportAll(session)}><Download size={14} aria-hidden="true" />{l("导出", "Export")}</button>
        </div></li>;
    })}</ul> : picking ? null : <p className="developer-units-empty">{l("还没有测试。点「新建测试」选几段对话，直接抽取、整理并写作。", "No tests yet. Choose New test to pick conversations and extract, organize and write them.")}</p>}
    {error ? <p className="developer-control-error" role="alert">{error}</p> : null}
    <div className="developer-units-fallback"><span><strong>{l("后备：旧生成流程", "Fallback: earlier pipeline")}</strong><small>{legacy ? l("已开启：新建的项目文档改用旧流程生成", "On: new project documents use the earlier pipeline") : l("关闭时新建文档由知识点账本生成；已有文档不受影响", "Off: new documents are written from the ledger; existing documents are unchanged")}</small></span>
      <button type="button" className="developer-units-switch" role="switch" aria-checked={legacy} aria-label={l("新建文档改用旧生成流程", "Generate new documents with the earlier pipeline")} onClick={() => toggleLegacy(!legacy)}><span /></button></div>
  </section>;
}
