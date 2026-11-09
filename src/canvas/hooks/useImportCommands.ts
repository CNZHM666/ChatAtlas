import { startTransition, useRef, useState } from "react";
import type { ImportJob } from "../../shared/types";
import type { AtlasMessage } from "../../shared/messages";
import { importChatGPTExportInBackground } from "../../sync/export-import-background";
import { clearFailedImportTasks } from "../../storage/import-jobs";
import { rebuildStoredMessageSearchIndex } from "../../storage/messages";
import { usePreferences } from "../preferences";
import type { NativeImportSource } from "../../shared/native-import";
import { nativeImportSources } from "../../shared/native-import-sources";

export function useImportCommands({ flash, refreshConversations }: { flash: (message: string) => void; refreshConversations: () => void }) {
  const { t } = usePreferences();
  const [importJob, setImportJob] = useState<ImportJob | null>(null);
  const [importSource, setImportSource] = useState<"web" | "zip">("web");
  const fileImporting = useRef(false);
  const selecting = useRef(new Set<string>());
  const scanRequested = useRef(false);
  const [importChoices, setImportChoices] = useState<NativeImportSource[]>();

  const commandLegacyImport = async (mode: "full" | "incremental" | "failed" | "titles") => {
    if (typeof chrome === "undefined" || !chrome.runtime?.id) { flash(t("extensionOnly")); return; }
    if (fileImporting.current || scanRequested.current) return;
    scanRequested.current = true;
    setImportSource("web");
    setImportJob((previous) => {
      if (mode === "failed" && previous) return { ...previous, status: "connecting", phase: "connecting", lastError: undefined, diagnostic: undefined, connectionStep: "finding_chatgpt_tab" };
      const now = Date.now(); const sessionId = crypto.randomUUID();
      return { id: "chatgpt-history", sessionId, status: "connecting", phase: "discovering", retryScope: mode, connectionStep: "finding_chatgpt_tab", scope: "active", offset: 0, discovered: 0, discoveredIds: [], persisted: 0, persistedIds: [], hydrated: 0, completed: 0, failed: 0, syncedMessages: 0, pendingIds: [], failedIds: [], startedAt: now, updatedAt: now, lastSyncedAt: previous?.lastSyncedAt, checkpoint: { sessionId, discoveredIds: [], persistedIds: [], failedIds: [], pendingIds: [], lastCursor: "0", startedAt: now, updatedAt: now } };
    });
    try {
      const response = await chrome.runtime.sendMessage({ type: "ATLAS_IMPORT_START", mode } satisfies AtlasMessage) as ImportJob | { error: string };
      if ("error" in response) { setImportJob(current => current ? { ...current, status: "failed", lastError: response.error, updatedAt: Date.now() } : null); flash(response.error); }
      else { setImportSource("web"); setImportJob(response); }
    } catch { setImportJob((previous) => previous ? { ...previous, status: "unavailable", lastError: t("connectFailed") } : null); flash(t("connectFailed")); }
    finally { scanRequested.current = false; }
  };

  const chooseImportSources = async (sources: NativeImportSource[]) => {
    if (!sources.length || fileImporting.current || scanRequested.current) return;
    setImportChoices(undefined); scanRequested.current = true;
    const now = Date.now(), sessionId = crypto.randomUUID();
    setImportSource("web");
    setImportJob({ id: "chatgpt-history", sessionId, status: "connecting", phase: "discovering", retryScope: "titles", offset: 0, discovered: 0, discoveredIds: [], persisted: 0, persistedIds: [], hydrated: 0, completed: 0, failed: 0, pendingIds: [], failedIds: [], startedAt: now, updatedAt: now, native: { version: 1, sources, inventoryComplete: false }, checkpoint: { sessionId, discoveredIds: [], persistedIds: [], failedIds: [], pendingIds: [], lastCursor: "", startedAt: now, updatedAt: now } });
    try {
      const response = await chrome.runtime.sendMessage({ type: "ATLAS_NATIVE_IMPORT_START", sources } satisfies AtlasMessage) as ImportJob | { error: string };
      if (!response || "error" in response) throw Error(response && "error" in response ? response.error : t("importFailed"));
      setImportJob(current => current && current.sessionId === response.sessionId && current.updatedAt > response.updatedAt ? current : response);
    } catch (error) {
      const message = error instanceof Error ? error.message : t("importFailed");
      setImportJob(current => current ? { ...current, status: "failed", lastError: message, updatedAt: Date.now() } : current); flash(message);
    }
    finally { scanRequested.current = false; }
  };
  const commandImport = async (mode: "full" | "incremental" | "failed" | "titles") => {
    if (typeof chrome === "undefined" || !chrome.runtime?.id) { flash(t("extensionOnly")); return; }
    if (fileImporting.current || scanRequested.current) return;
    if (mode === "failed") {
      if (importJob?.native) { await commandHydrate(importJob.failedIds); return; }
      return commandLegacyImport(mode);
    }
    scanRequested.current = true;
    let sources: NativeImportSource[];
    try { sources = nativeImportSources(await chrome.tabs.query({})); }
    catch { flash(t("connectFailed")); return; }
    finally { scanRequested.current = false; }
    if (sources.length === 1) await chooseImportSources(sources);
    else setImportChoices(sources);
  };

  /** force: sync again conversations already synced, after a failed or partial read kept the saved copy. */
  const commandHydrate = async (conversationIds: string[], force = false) => {
    const ids = [...new Set(conversationIds)].filter(id => !selecting.current.has(id));
    if (!ids.length || fileImporting.current) return false;
    if (typeof chrome === "undefined" || !chrome.runtime?.id) { flash(t("extensionOnly")); return false; }
    ids.forEach(id => selecting.current.add(id));
    try {
      const response = await chrome.runtime.sendMessage({ type: "ATLAS_IMPORT_SELECT", conversationIds: ids, ...(force ? { force: true } : {}) } satisfies AtlasMessage) as ImportJob | { error: string };
      if ("error" in response) { flash(response.error); return false; }
      setImportSource("web");
      setImportJob(current => current && current.sessionId === response.sessionId && current.updatedAt > response.updatedAt ? current : response);
      refreshConversations();
      return true;
    } catch { flash(t("connectFailed")); return false; }
    finally { ids.forEach(id => selecting.current.delete(id)); }
  };

  const requestJob = async (message: AtlasMessage): Promise<ImportJob> => {
    const response = await chrome.runtime.sendMessage(message) as ImportJob | { error: string } | undefined;
    if (!response || "error" in response || !("status" in response)) throw new Error(response && "error" in response ? response.error : t("connectFailed"));
    return response;
  };
  const openChatGPTForImport = async () => {
    if (importJob?.native) {
      try { setImportJob(await requestJob({ type: "ATLAS_NATIVE_IMPORT_RESUME" })); }
      catch (error) { flash(error instanceof Error ? error.message : t("connectFailed")); }
      return;
    }
    try { setImportJob(await requestJob({ type: "ATLAS_IMPORT_OPEN_CHATGPT" })); }
    catch { setImportJob((current) => current ? { ...current, status: "unavailable", diagnostic: { stage: "tab", success: false, code: "REQUEST_FAILED" } } : current); }
  };
  const retryImportConnection = async (reload: boolean) => {
    try { setImportJob(await requestJob({ type: "ATLAS_IMPORT_RETRY", reload })); }
    catch { setImportJob((current) => current ? { ...current, status: "unavailable", diagnostic: { stage: "bridge", success: false, code: "REQUEST_FAILED" } } : current); }
  };
  const pauseImport = async () => {
    try { setImportJob(await requestJob({ type: "ATLAS_IMPORT_PAUSE" })); }
    catch { flash(t("connectFailed")); }
  };
  const resumeImport = async () => {
    if (importSource !== "web" || !importJob) return;
    if (importJob.native) {
      try { setImportJob(await requestJob({ type: "ATLAS_NATIVE_IMPORT_RESUME" })); }
      catch (error) { flash(error instanceof Error ? error.message : t("connectFailed")); }
      return;
    }
    if (importJob.retryScope === "selected") await commandHydrate(importJob.pendingIds);
    else await commandLegacyImport(importJob.retryScope === "titles" ? "titles" : "full");
  };

  const importZip = async (file: File) => {
    if (fileImporting.current) return [];
    fileImporting.current = true;
    let job: ImportJob | null = null;
    try {
      const now = Date.now(); const sessionId = crypto.randomUUID();
      job = { id: "chatgpt-history", sessionId, status: "syncing", phase: "syncing", offset: 0, discovered: 0, discoveredIds: [], persisted: 0, persistedIds: [], hydrated: 0, completed: 0, failed: 0, syncedMessages: 0, pendingIds: [], failedIds: [], startedAt: now, updatedAt: now, checkpoint: { sessionId, discoveredIds: [], persistedIds: [], failedIds: [], pendingIds: [], lastCursor: "0", startedAt: now, updatedAt: now } };
      setImportSource("zip"); setImportJob({ ...job });
      let lastUiUpdate = 0;
      let lastLibraryRefresh = 0;
      let lastStage = "";
      const result = await importChatGPTExportInBackground(file, (progress) => {
        if (!job) return;
        job.discovered = progress.total;
        job.phase = progress.stage === "reading" ? "discovering" : "syncing";
        job.hydrated = progress.added + progress.updated + progress.unchanged;
        job.persisted = job.hydrated;
        job.completed = job.hydrated;
        job.failed = progress.failed;
        job.failedIds = progress.failedIds;
        job.syncedMessages = progress.messages;
        const now = Date.now();
        if (progress.stage !== lastStage || now - lastUiUpdate >= 1000) {
          lastStage = progress.stage;
          lastUiUpdate = now;
          const snapshot = { ...job };
          startTransition(() => setImportJob(snapshot));
        }
        if (progress.stage === "saving" && now - lastLibraryRefresh >= 3000) {
          lastLibraryRefresh = now;
          refreshConversations();
        }
      });
      const finalStatus = result.scanned === 0 ? "unavailable" : result.failed === 0 ? "completed" : result.added + result.updated + result.unchanged > 0 ? "completed_with_warnings" : "failed";
      setImportJob({ ...job, status: finalStatus, lastError: result.scanned === 0 ? t("zipEmpty") : undefined, bulkReport: { added: result.added, updated: result.updated, unchanged: result.unchanged, failed: result.failed } } as ImportJob);
      refreshConversations();
      return result.importedIds;
    } catch (error) {
      const detail = error instanceof Error ? error.message : "";
      const message = /ZIP|JSON|conversations\.json|export/i.test(detail) ? t("invalidChatGPTExport") : detail || t("importFailed");
      if (job) setImportJob({ ...job, status: job.hydrated > 0 ? "partial" : "failed", lastError: message });
      flash(message);
      return [];
    } finally { fileImporting.current = false; }
  };

  const rebuildSearchIndex = async () => {
    try { const count = await rebuildStoredMessageSearchIndex(); flash(t("searchIndexRebuilt", { count })); }
    catch { flash(t("importFailed")); }
  };
  const clearFailedTasks = async () => {
    const job = await clearFailedImportTasks();
    if (job) setImportJob(job);
    flash(t("failedTasksCleared"));
  };
  return { importJob, setImportJob, importSource, setImportSource, fileImporting, commandImport, commandHydrate, openChatGPTForImport, retryImportConnection, pauseImport, resumeImport, importZip, rebuildSearchIndex, clearFailedTasks, importChoices, chooseImportSources, closeImportChoices: () => setImportChoices(undefined) };
}
