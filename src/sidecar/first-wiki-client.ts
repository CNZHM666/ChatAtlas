import { useEffect, useState } from "react";
import type { AtlasMessage, NavigationResponse } from "../shared/messages";
import type { WikiProgress } from "../shared/wiki-knowledge";
import { listSidecarDrafts, sidecarFirstRunActive, type SidecarUpdateDraft } from "../storage/sidecar-update-drafts";

export const wikiStageLabel: Record<WikiProgress["stage"], [string, string]> = {
  extract: ["抽取知识点", "Extract knowledge"], cover: ["检查材料覆盖", "Check source coverage"], verify: ["核对引用", "Verify citations"],
  name: ["整理项目边界", "Identify project scope"], attach: ["匹配章节", "Match chapters"], split: ["拆分主题", "Split topics"],
  same: ["核对重复内容", "Identify duplicates"], merge: ["合并重复内容", "Merge duplicates"], group: ["归组相关主题", "Group related topics"],
  plan: ["规划目录", "Plan the outline"], write: ["按章写作", "Write chapters"], proofread: ["全文校对", "Proofread the document"],
};

export async function commandFirstWiki(draftId: string, pause = false) {
  const reply = await chrome.runtime.sendMessage({ type: pause ? "ATLAS_FIRST_WIKI_PAUSE" : "ATLAS_FIRST_WIKI_START", draftId } satisfies AtlasMessage) as (NavigationResponse & { code?: string }) | undefined;
  if (!reply?.ok) throw Object.assign(new Error("First Wiki command failed"), { code: reply?.code ?? "SIDECAR_BACKGROUND_UNAVAILABLE" });
}

export function useFirstWikiDraft(projectId?: string) {
  const [draft, setDraft] = useState<SidecarUpdateDraft>();
  useEffect(() => {
    if (!projectId) return;
    let live = true, revision = 0;
    const load = () => {
      const request = ++revision;
      void listSidecarDrafts(projectId).then(async drafts => {
        let next = drafts.find(item => item.initialRun?.input || item.initialDocument);
        if (next?.initialRun && sidecarFirstRunActive(next) && typeof globalThis.chrome?.runtime?.getContexts === "function") {
          const contexts = await chrome.runtime.getContexts({ contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
            documentUrls: [chrome.runtime.getURL("first-wiki.html")] }).catch(() => undefined);
          if (contexts && !contexts.length) next = { ...next, initialRun: { ...next.initialRun, state: "paused" } };
        }
        if (live && request === revision) setDraft(next);
      }).catch(() => undefined);
    };
    const changed = (message: AtlasMessage) => { if (message.type === "ATLAS_FIRST_WIKI_CHANGED" && message.projectId === projectId) load(); };
    load();
    const timer = window.setInterval(() => { if (!document.hidden) load(); }, 7000);
    window.addEventListener("focus", load);
    globalThis.chrome?.runtime?.onMessage?.addListener(changed);
    return () => {
      live = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", load);
      globalThis.chrome?.runtime?.onMessage?.removeListener(changed);
    };
  }, [projectId]);
  return draft?.projectId === projectId ? draft : undefined;
}
