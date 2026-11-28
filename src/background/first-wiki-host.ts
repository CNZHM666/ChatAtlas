import { getAISettings } from "../storage/knowledge-graph";
import type { AtlasMessage } from "../shared/messages";

let creating: Promise<void> | undefined;

async function ensureDocument() {
  const path = "first-wiki.html";
  const contexts = await chrome.runtime.getContexts({ contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT], documentUrls: [chrome.runtime.getURL(path)] });
  if (contexts.length) return;
  creating ??= chrome.offscreen.createDocument({ url: path, reasons: [chrome.offscreen.Reason.LOCAL_STORAGE],
    justification: "Keep user-initiated Wiki generation independent of the side panel, with access to the Wiki writer’s local calibration and preferences." }).finally(() => { creating = undefined; });
  await creating;
}

export async function firstWikiCommand(draftId: string, pause: boolean) {
  if (!pause) {
    const settings = await getAISettings();
    if (!settings?.apiKey?.trim() || !settings.model?.trim() || !settings.baseUrl?.trim()) return { ok: false, code: "SIDECAR_AI_NOT_CONFIGURED" };
    const url = new URL(settings.baseUrl);
    if (!await chrome.permissions.contains({ origins: [`${url.protocol}//${url.host}/*`] })) return { ok: false, code: "SIDECAR_AI_NOT_AUTHORIZED" };
    await ensureDocument();
  }
  return await chrome.runtime.sendMessage({ type: pause ? "ATLAS_FIRST_WIKI_STOP_EXECUTION" : "ATLAS_FIRST_WIKI_EXECUTE", draftId } satisfies AtlasMessage);
}
