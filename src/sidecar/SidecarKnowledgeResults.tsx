import { useState } from "react";
import { BookMarked, CornerDownLeft } from "lucide-react";
import type { FocusSession } from "../shared/focus-session";
import type { NavigationResponse } from "../shared/messages";
import { sendSidecarMessage } from "./host";
import { knowledgeInsertText, type KnowledgeHit } from "./knowledge-search";

/** Organized knowledge first: a matching Wiki chapter is already the reviewed
 * answer to "where did we discuss this". Opening continues in the workspace;
 * inserting fills the AI input box and never sends or replaces a draft. */
export function SidecarKnowledgeResults({ hits, projects, conversationId, canInsert, zh }: { hits: KnowledgeHit[]; projects: FocusSession[]; conversationId: string; canInsert: boolean; zh: boolean }) {
  const l = (cn: string, en: string) => zh ? cn : en;
  const [notice, setNotice] = useState<{ text: string; failed: boolean }>();
  const open = async (hit: KnowledgeHit) => {
    setNotice(undefined);
    try { const result = await sendSidecarMessage({ type: "ATLAS_OPEN_REVIEW", sessionId: hit.sessionId, sectionId: hit.sectionId }) as NavigationResponse; if (!result?.ok) throw new Error(); }
    catch { setNotice({ text: l("无法打开工作台，请重试。", "Could not open the workspace. Try again."), failed: true }); }
  };
  const insert = async (hit: KnowledgeHit) => {
    const session = projects.find(item => item.id === hit.sessionId);
    if (!session) return;
    setNotice(undefined);
    try {
      const result = await sendSidecarMessage({ type: "ATLAS_SIDECAR_HANDOFF", conversationId, text: knowledgeInsertText(session, hit.sectionId, zh) }) as { ok?: boolean; reason?: string; error?: string };
      if (!result?.ok) throw new Error(result?.reason ?? result?.error);
      setNotice({ text: l("已填入输入框，确认后再发送。", "Added to the input box. Review before sending."), failed: false });
    } catch (failure) {
      const reason = failure instanceof Error ? failure.message : "";
      const text = reason === "draft" ? l("输入框已有内容，未覆盖。请清空后再插入。", "The input box has a draft; it was not replaced.")
        : reason === "unavailable" ? l("没有找到可用的输入框。请确认页面已加载完成，且该平台的网页适配未在设置中暂停。", "No usable input box was found. Make sure the page has loaded and this site is not paused in settings.")
        : reason === "changed" ? l("页面已切换到其他对话，请在当前页面重新插入。", "The page switched to another chat. Insert again on this page.")
        : reason && !["failed"].includes(reason) ? reason : l("未能填入输入框，请重试。", "Could not fill the input box. Try again.");
      setNotice({ text, failed: true });
    }
  };
  // The card opens the chapter in the workspace; one icon inserts it into the AI's input box.
  return <div className="memory-knowledge-list">
    <small>{l("已整理的知识", "Organized knowledge")} · {hits.length}</small>
    {hits.map(hit => <article className="memory-knowledge-card" key={`${hit.sessionId}:${hit.sectionId}`}>
      <button type="button" className="memory-knowledge-main" aria-label={l(`在工作台打开：${hit.chapter}`, `Open in workspace: ${hit.chapter}`)} onClick={() => void open(hit)}>
        <span><BookMarked size={13} aria-hidden="true" /><strong title={hit.chapter}>{hit.chapter}</strong><small title={hit.project}>{hit.project}</small></span>
        <p>{hit.excerpt}</p>
      </button>
      {canInsert ? <button type="button" className="memory-knowledge-insert" aria-label={l(`插入输入框：${hit.chapter}`, `Insert: ${hit.chapter}`)} title={l("插入输入框，不会自动发送", "Insert into the input box; nothing is sent")} onClick={() => void insert(hit)}><CornerDownLeft size={14} aria-hidden="true" /></button> : null}
    </article>)}
    {notice ? <p role={notice.failed ? "alert" : "status"} className="memory-result-notice">{notice.text}</p> : null}
  </div>;
}
