import type { AtlasMessage } from "../shared/messages";
import { handoffPageMatches } from "../shared/handoff-page";
import { acceptsProjectFile, AUTO_FILE_LIMIT, decodeProjectChunk, encodeProjectChunk, PROJECT_FILE_CHUNK, PROJECT_FILE_DRAG, PROJECT_FILE_LIMIT, projectFileAttachMessage, supportedProjectFile, type ProjectFileAttachResult, type ProjectFileInfo } from "../shared/project-files";

type FileProject = { id: string; name: string; auto: boolean };
type Packet = Extract<AtlasMessage, { type: "ATLAS_PROJECT_FILE_RECEIVE" }>;
type DragPacket = Extract<AtlasMessage, { type: "ATLAS_PROJECT_FILE_DRAG_READY" }>;
const send = (message: AtlasMessage) => chrome.runtime.sendMessage(message);
const infoOf = ({ name, size, type }: File): ProjectFileInfo => ({ name, size, type });

async function collectFile(file: File, conversationId: string, projectId: string, manual: boolean) {
  const start = await send({ type: "ATLAS_PROJECT_FILE_START", conversationId, projectId, manual, info: infoOf(file) });
  if (!start?.ok) throw new Error("File collection unavailable");
  for (let offset = 0; offset < file.size; offset += PROJECT_FILE_CHUNK) {
    if (!handoffPageMatches(location.href, conversationId)) throw new Error("Chat changed");
    const bytes = new Uint8Array(await file.slice(offset, offset + PROJECT_FILE_CHUNK).arrayBuffer());
    if (!(await send({ type: "ATLAS_PROJECT_FILE_CHUNK", token: start.token, offset, data: encodeProjectChunk(bytes) }))?.ok) throw new Error("File transfer interrupted");
  }
  if (!(await send({ type: "ATLAS_PROJECT_FILE_FINISH", token: start.token }))?.ok) throw new Error("File could not be saved");
}

const scopeOf = (composer: HTMLElement) => composer.closest("form,[data-type='unified-composer'],[data-testid='chat_input']") ?? composer.parentElement?.parentElement;
const filePicker = 'input[type="file"]:not(:disabled)';
const nativePickers = `${filePicker}:is(#upload-files,#upload-photos,[data-testid="file-upload-input"])`;
const detachedPickers = `${filePicker}:is(#file-upload,#file-upload-input,[data-testid="upload-file-input"],[data-testid="composer-file-input"],[data-testid*="upload"],[data-testid*="file-input"],[aria-label*="upload" i],[aria-label*="上传"])`;
const NON_CHAT_CONTAINERS = "form,aside,nav,[role='dialog'],header";

function hasExplicitComposerPicker(scope?: Element | null): boolean {
  if (!scope) return false;
  if (scope.querySelector(filePicker)) return true;
  if (scope instanceof HTMLFormElement && [...document.querySelectorAll<HTMLInputElement>(filePicker)].some(input => input.form === scope)) return true;
  return false;
}

function composerFilePicker(target: Element, scope?: Element | null): target is HTMLInputElement {
  if (!(target instanceof HTMLInputElement) || target.type !== "file") return false;
  if (target.matches(nativePickers) || scope?.contains(target)) return true;
  if (scope && (target.form === scope || [...target.labels ?? []].some(label => scope.contains(label)))) return true;
  if (target.closest(NON_CHAT_CONTAINERS)) return false;
  if (target.matches(detachedPickers)) return true;
  // Modern AI chat UIs (Gemini, Claude, DeepSeek, Kimi, Doubao, Qwen, newer ChatGPT portals)
  // often mount their hidden file picker directly under body/root outside the composer form.
  // Accept a standalone page file input when no explicit composer-scoped picker exists.
  return Boolean(scope && !hasExplicitComposerPicker(scope));
}

export function attachComposerFile(composer: HTMLElement, file: File, droppedOn?: Element): boolean {
  const transfer = new DataTransfer();
  transfer.items.add(file);
  const scope = scopeOf(composer);
  const inputs = new Set([
    ...scope?.querySelectorAll<HTMLInputElement>(filePicker) ?? [],
    ...document.querySelectorAll<HTMLInputElement>(nativePickers),
  ]);
  const compatible = [...inputs].filter(input => !input.files?.length && acceptsProjectFile(input.accept, file));
  const picker = compatible.find(input => input.id === (file.type.startsWith("image/") ? "upload-photos" : "upload-files")) ?? compatible[0];
  if (picker) {
    picker.files = transfer.files;
    picker.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    picker.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
    return true;
  }
  const target = droppedOn?.isConnected && (scope?.contains(droppedOn) || composer.contains(droppedOn)) ? droppedOn : composer;
  const drop = new DragEvent("drop", { dataTransfer: transfer, bubbles: true, cancelable: true, composed: true });
  if (!target.dispatchEvent(drop)) return true;
  // Some chat editors attach pasted files through the editor's clipboard handler.
  return !composer.dispatchEvent(new ClipboardEvent("paste", { clipboardData: transfer, bubbles: true, cancelable: true, composed: true }));
}

export function watchComposerFiles(getConversation: () => string, getComposer: () => HTMLElement | null | undefined, allowed: () => boolean) {
  const zh = () => document.documentElement.lang.toLowerCase().startsWith("zh");
  const t = (cn: string, en: string) => zh() ? cn : en;
  let currentToast: HTMLElement | undefined;
  let toastTimer: number | undefined;
  let active: { token: string; info: ProjectFileInfo; bytes: Uint8Array<ArrayBuffer>; offset: number } | undefined;
  let armedDrag: DragPacket | undefined;
  let droppedOn: { token: string; element: Element } | undefined;
  let pending: { conversationId: string; files: File[] } | undefined;
  const seen = new WeakSet<File>();
  const clearToast = () => { currentToast?.remove(); currentToast = undefined; window.clearTimeout(toastTimer); };
  const toast = (text: string, action?: (bar: HTMLElement) => void, dismiss?: () => void) => {
    clearToast();
    const host = document.createElement("div");
    host.style.cssText = "position:fixed;right:18px;bottom:92px;max-width:calc(100vw - 36px);z-index:2147483647";
    const root = host.attachShadow({ mode: "closed" });
    const style = document.createElement("style");
    style.textContent = `:host{color-scheme:light dark}.bar{display:flex;align-items:center;flex-wrap:wrap;gap:6px 10px;border:1px solid #8884;background:Canvas;color:CanvasText;box-shadow:0 4px 18px #0002;border-radius:9px;padding:6px 8px 6px 11px;font:13px/1.45 system-ui;max-width:360px}button,select{font:inherit;color:inherit;max-width:185px}button{border:0;border-radius:5px;background:transparent;padding:3px 6px;cursor:pointer}button:hover{background:#8882}.save{color:light-dark(#146c43,#8de1ae);font-weight:600}span{overflow-wrap:anywhere}`;
    const bar = document.createElement("div");
    bar.className = "bar";
    const label = document.createElement("span");
    label.setAttribute("role", "status");
    label.textContent = text;
    bar.append(label);
    action?.(bar);
    const close = document.createElement("button");
    close.type = "button";
    close.textContent = "×";
    close.setAttribute("aria-label", t("关闭收纳提示", "Dismiss file notice"));
    close.addEventListener("click", () => { dismiss?.(); clearToast(); });
    bar.append(close);
    root.append(style, bar);
    document.body.append(host);
    currentToast = host;
    if (!action) toastTimer = window.setTimeout(clearToast, 3500);
  };
  const offer = async (files: File[]) => {
    if (!allowed()) return;
    const conversationId = getConversation();
    if (!conversationId) return;
    const response = await send({ type: "ATLAS_PROJECT_FILE_CONTEXT", conversationId });
    if (!allowed() || conversationId !== getConversation()) return;
    if (!response?.ok) throw new Error("Project file context unavailable");
    const projects: FileProject[] = response?.projects ?? [];
    if (!projects.length) return;
    const auto = projects.find(project => project.auto);
    const manual: File[] = [];
    let autoSaved = 0;
    let autoFailed = false;
    for (const file of files) {
      if (auto && file.size <= AUTO_FILE_LIMIT) {
        try { await collectFile(file, conversationId, auto.id, false); autoSaved++; }
        catch { autoFailed = true; manual.push(file); }
      } else manual.push(file);
    }
    if (conversationId !== getConversation()) return;
    if (!manual.length) {
      if (auto && autoSaved > 0) {
        toast(t(`已自动收录 ${autoSaved} 个文件到「${auto.name}」`, `Auto-saved ${autoSaved} ${autoSaved === 1 ? "file" : "files"} to “${auto.name}”`));
      }
      return;
    }
    const filesToReview = [...(pending?.conversationId === conversationId ? pending.files : []), ...manual];
    const scope = { conversationId, files: filesToReview };
    pending = scope;
    const saveable = filesToReview.filter(file => file.size <= PROJECT_FILE_LIMIT);
    const over = saveable.some(file => file.size > AUTO_FILE_LIMIT);
    const label = !saveable.length ? t("文件超过 64 MB，可从原位置使用。", "Files exceed 64 MB. Use the original copies.")
      : over ? t("超过 20 MB，需手动收纳。", "Over 20 MB. Save manually.")
      : autoFailed ? t("自动收录未完成，可重新收纳。", "Auto-save didn’t finish. Save again.")
      : t(`收纳 ${saveable.length} 个文件？`, `Save ${saveable.length} ${saveable.length === 1 ? "file" : "files"}?`);
    toast(label, saveable.length ? bar => {
      const select = document.createElement("select");
      select.setAttribute("aria-label", t("选择项目", "Choose project"));
      for (const project of projects) select.add(new Option(project.name, project.id, false, project === auto));
      if (projects.length > 1) bar.append(select);
      const button = document.createElement("button");
      button.type = "button";
      button.className = "save";
      button.textContent = t("收纳到资料", "Save to files");
      button.addEventListener("click", async event => {
        if (!event.isTrusted) return;
        pending = undefined;
        button.disabled = true;
        let saved = 0;
        const projectId = select.value;
        for (const file of saveable) {
          if (getConversation() !== conversationId || !allowed()) break;
          try { await collectFile(file, conversationId, projectId, true); saved++; }
          catch { break; }
        }
        if (!pending) toast(saved === saveable.length ? t("已收纳到项目资料", "Saved to project files")
          : t(`已收纳 ${saved} 个文件，其余可在侧栏手动添加。`, `Saved ${saved}. Add the remaining files in the sidebar.`));
      });
      bar.append(button);
    } : undefined, () => { if (pending === scope) pending = undefined; });
    if (!saveable.length) pending = undefined;
  };
  const capture = (event: Event) => {
    if (!event.isTrusted || !allowed()) return;
    const target = event.composedPath()[0];
    if (!(target instanceof Element)) return;
    const pickerEvent = event.type === "input" || event.type === "change";
    if (pickerEvent && (!(target instanceof HTMLInputElement) || target.type !== "file")) return;
    const composer = getComposer();
    const scope = composer && scopeOf(composer);
    const path = event.composedPath();
    const insideComposer = Boolean(composer && path.some(node => node === composer || node === scope));
    const insideIgnoredRegion = Boolean(target.closest("aside,nav,[role='dialog'],header"));
    const inChatDropArea = event.type === "drop" && Boolean(composer && !insideIgnoredRegion);
    const inChatPasteArea = event.type === "paste" && Boolean(composer && (insideComposer || !insideIgnoredRegion && !target.closest("input,textarea")));
    const input = pickerEvent && composerFilePicker(target, scope) ? target : undefined;
    const transfer = event.type === "drop" && (insideComposer || inChatDropArea)
      ? (event as DragEvent).dataTransfer
      : event.type === "paste" && inChatPasteArea
        ? (event as ClipboardEvent).clipboardData
        : undefined;
    const transferFile = transfer?.files[0];
    const offeredName = transfer?.getData("DownloadURL").split(":")[1];
    const knownDrag = armedDrag && (offeredName === armedDrag.info.name ||
      transferFile?.name === armedDrag.info.name && transferFile.size === armedDrag.info.size);
    const marker = event.type === "drop" && (transfer?.getData(PROJECT_FILE_DRAG) || (knownDrag && armedDrag?.token));
    if (marker && transferFile?.size) { armedDrag = undefined; return; }
    if (marker) {
      event.preventDefault();
      event.stopImmediatePropagation();
      droppedOn = { token: marker, element: target };
      armedDrag = undefined;
      void send({ type: "ATLAS_PROJECT_FILE_DROP", conversationId: getConversation(), token: marker }).then(result => {
        if (result?.ok) toast(t("文件已交给输入区", "File passed to the composer"));
        else toast(projectFileAttachMessage(result?.reason, zh()));
      }).catch(() => toast(projectFileAttachMessage("transfer-failed", zh()))).finally(() => {
        if (droppedOn?.token === marker) droppedOn = undefined;
      });
      return;
    }
    const files = Array.from((input?.files ?? transfer?.files) ?? []).filter(file => !seen.has(file) && supportedProjectFile(infoOf(file)));
    if (!files.length) return;
    files.forEach(file => seen.add(file));
    const conversationId = getConversation();
    void offer(files).catch(() => {
      if (allowed() && conversationId && getConversation() === conversationId) {
        toast(t("未能收录附件，可在侧栏手动添加。", "Could not save the attachment. Add it from the sidebar."));
      }
    });
  };
  const dragover = (event: DragEvent) => {
    const composer = getComposer();
    if (allowed() && composer && event.target instanceof Node && (scopeOf(composer)?.contains(event.target) || composer.contains(event.target)) &&
      (event.dataTransfer?.types.includes(PROJECT_FILE_DRAG) || armedDrag && event.dataTransfer?.types.some(type => type === "Files" || type.toLowerCase() === "downloadurl"))) {
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    }
  };
  const receive = (packet: Packet): ProjectFileAttachResult => {
    if (!allowed()) return { ok: false, reason: "page-unavailable" };
    if (!handoffPageMatches(location.href, packet.conversationId)) return { ok: false, reason: "chat-changed" };
    if (packet.info && packet.offset === 0 && supportedProjectFile(packet.info) && packet.info.size <= PROJECT_FILE_LIMIT) {
      active = { token: packet.token, info: packet.info, bytes: new Uint8Array(packet.info.size), offset: 0 };
      window.setTimeout(() => { if (active?.token === packet.token) active = undefined; }, 30_000);
    }
    if (!active || active.token !== packet.token || active.offset !== packet.offset) return { ok: false, reason: "transfer-failed" };
    const bytes = decodeProjectChunk(packet.data);
    if (!bytes.length || active.offset + bytes.length > active.info.size) return { ok: false, reason: "transfer-failed" };
    active.bytes.set(bytes, active.offset);
    active.offset += bytes.length;
    if (active.offset < active.info.size) return { ok: true };
    const { bytes: buffer, info } = active;
    active = undefined;
    const composer = getComposer();
    if (!composer) return { ok: false, reason: "no-composer" };
    const target = droppedOn?.token === packet.token ? droppedOn.element : undefined;
    return attachComposerFile(composer, new File([buffer], info.name, { type: info.type }), target) ? { ok: true } : { ok: false, reason: "no-file-target" };
  };
  const arm = (packet: DragPacket): ProjectFileAttachResult => {
    if (!allowed()) return { ok: false, reason: "page-unavailable" };
    if (!handoffPageMatches(location.href, packet.conversationId)) return { ok: false, reason: "chat-changed" };
    armedDrag = packet;
    window.setTimeout(() => { if (armedDrag === packet) armedDrag = undefined; }, 60_000);
    return { ok: true };
  };
  const events = ["input", "change", "drop", "paste"];
  for (const type of events) window.addEventListener(type, capture, true);
  window.addEventListener("dragover", dragover, true);
  window.addEventListener("pagehide", clearToast);
  return { receive, arm, pageChanged: () => {
    if (pending && pending.conversationId !== getConversation()) { pending = undefined; clearToast(); }
    if (armedDrag && armedDrag.conversationId !== getConversation()) armedDrag = undefined;
  }, dispose: () => {
    for (const type of events) window.removeEventListener(type, capture, true);
    window.removeEventListener("dragover", dragover, true);
    window.removeEventListener("pagehide", clearToast);
    clearToast();
    active = undefined;
    pending = undefined;
  } };
}
