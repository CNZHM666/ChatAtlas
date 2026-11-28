export const AUTO_FILE_LIMIT = 20 * 1024 * 1024;
export const PROJECT_FILE_LIMIT = 64 * 1024 * 1024;
export const PROJECT_FILE_CHUNK = 256 * 1024;
export const PROJECT_FILE_DRAG = "application/x-chatatlas-project-file";
export const PROJECT_FILE_ACCEPT = "image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.rtf,.md,.markdown,.txt,.json,.csv,.tsv,.xml,.yaml,.yml,.toml,.ini,.env,.log,.zip,.svg,.js,.jsx,.ts,.tsx,.mjs,.cjs,.css,.scss,.html,.py,.go,.rs,.java,.kt,.c,.h,.cpp,.hpp,.cs,.rb,.php,.sh,.sql,.swift,.vue,.svelte";

export interface ProjectFileInfo { name: string; type: string; size: number }
export type ProjectFileAttachFailure = "chat-changed" | "page-unavailable" | "no-composer" | "no-file-target" | "drag-expired" | "transfer-failed";
export type ProjectFileAttachResult = { ok: true } | { ok: false; reason: ProjectFileAttachFailure };

export function projectFileAttachMessage(reason: unknown, zh: boolean) {
  switch (reason) {
    case "chat-changed": return zh ? "对话已切换，请在当前页重试。" : "The chat changed. Try again in the current tab.";
    case "page-unavailable": return zh ? "无法连接输入区，刷新 AI 页面后重试。" : "Could not reach the composer. Refresh the AI page and retry.";
    case "no-composer": return zh ? "未找到输入区，等页面加载后重试。" : "The composer is unavailable. Try again after the page loads.";
    case "no-file-target": return zh ? "输入区未接收此文件，可通过网页的附件按钮上传。" : "The composer did not accept this file. Use the site’s attachment button.";
    case "drag-expired": return zh ? "这次拖放已失效，请重新拖入。" : "This drag expired. Drag the file again.";
    default: return zh ? "文件传输未完成，请重试。" : "The file transfer did not finish. Try again.";
  }
}

export function acceptsProjectFile(accept: string, file: ProjectFileInfo) {
  const rules = accept.toLowerCase().split(",").map(rule => rule.trim()).filter(Boolean);
  const name = file.name.toLowerCase(), type = file.type.toLowerCase();
  return !rules.length || rules.some(rule => rule.startsWith(".") ? name.endsWith(rule)
    : rule.endsWith("/*") ? type.startsWith(rule.slice(0, -1))
    : rule === type);
}
export const projectRasterImage = (type: string) => /^image\/(?:png|jpe?g|webp|gif|avif|bmp|x-icon)$/iu.test(type);

export function supportedProjectFile(file: ProjectFileInfo) {
  const extension = file.name.toLowerCase().match(/\.[^.]+$/u)?.[0];
  return Boolean(file.name.trim() && file.name.length <= 255 && file.type.length <= 100 &&
    Number.isSafeInteger(file.size) && file.size > 0 && (file.type.startsWith("image/") ||
    /\.(?:png|jpe?g|webp|gif|avif|bmp|ico|svg|heic|heif|tiff?)$/iu.test(file.name) ||
    extension && PROJECT_FILE_ACCEPT.split(",").includes(extension)));
}

export function encodeProjectChunk(bytes: Uint8Array) {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 8192) binary += String.fromCharCode(...bytes.subarray(index, index + 8192));
  return btoa(binary);
}

export function decodeProjectChunk(data: string) {
  if (data.length > Math.ceil(PROJECT_FILE_CHUNK / 3) * 4) throw new Error("Invalid file chunk");
  return Uint8Array.from(atob(data), character => character.charCodeAt(0));
}
