import { chatGPTComposer } from "./chatgpt-adapter";
import { handoffPageMatches } from "../shared/handoff-page";

export type ComposerResult = { ok: boolean; reason?: "draft" | "unavailable" | "changed" | "failed" };

/** The text as the input box shows it once inserted: a rich editor turns Markdown into formatting as it is typed
 * ("## " a heading, "> " a quote, "- " a list) and a paragraph may show its line breaks as spaces, so markers and
 * spacing are not compared, only the words. */
const words = (text: string) => text.replace(/(^|\s)(?:#{1,6}|>|[-*+]|\d+[.)])(?=[ \t])/gmu, "$1").replace(/[*_`~\u200b-\u200d\ufeff]|\s+/gu, "");
export const insertedAsText = (shown: string, text: string) => { const own = words(shown), wanted = words(text); return own === wanted || own.length >= wanted.length * .97 && own.slice(0, 200) === wanted.slice(0, 200); };

const frame = () => new Promise<void>(resolve => typeof requestAnimationFrame === "function" ? requestAnimationFrame(() => resolve()) : setTimeout(resolve, 16));
const report = (step: string, detail: Record<string, unknown> = {}) => console.warn("[ChatAtlas] insert", step, detail);

/** Explicit user action only. Never overwrite a draft, click Send or emulate Enter. Rich editors (ProseMirror,
 * Lexical) may handle an insertion themselves and render it a frame later, so success is judged by what the input
 * box finally shows, not by the browser's return value. */
export async function fillProjectComposer(text: string, conversationId: string, url = location.href, findComposer:()=>HTMLElement|null|undefined=chatGPTComposer): Promise<ComposerResult> {
  const address=location.href;
  if (!handoffPageMatches(url, conversationId)) return { ok: false, reason: "changed" };
  if (typeof text !== "string" || !text.trim() || text.length > 1_000_000) return { ok: false, reason: "failed" };
  const composer = findComposer();
  if (!composer) { report("no input box", { url }); return { ok: false, reason: "unavailable" }; }
  const current = () => composer instanceof HTMLTextAreaElement ? composer.value : composer.innerText || composer.textContent || "";
  if (current().trim()) return { ok: false, reason: "draft" };
  composer.focus();
  if(location.href!==address)return {ok:false,reason:"changed"};
  if (!composer.isConnected || current().trim()) return { ok: false, reason: "draft" };
  // Something now shows: accept it only when it is this text, after the editor had a frame to render.
  const settled = async (step: string): Promise<ComposerResult> => {
    if (composer.isConnected && insertedAsText(current(), text)) return { ok: true };
    await frame(); await frame();
    if (composer.isConnected && insertedAsText(current(), text)) return { ok: true };
    report("text differs", { step, shown: current().slice(0, 120), length: current().length, wanted: text.length });
    return { ok: false, reason: "failed" };
  };
  if (composer instanceof HTMLTextAreaElement) {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
    setter.call(composer, text);
    composer.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
    return settled("textarea");
  }
  // Native editing integrates with rich editor state and undo when available.
  const select = () => { const selection = window.getSelection(), range = document.createRange(); range.selectNodeContents(composer); selection?.removeAllRanges(); selection?.addRange(range); };
  select();
  const inserted = typeof document.execCommand === "function" && document.execCommand("insertText", false, text);
  if (inserted || current().trim()) return settled(inserted ? "insertText" : "editor handled");
  // A paste is what rich editors handle most reliably when the page itself does not have keyboard focus.
  if (typeof DataTransfer === "function" && typeof ClipboardEvent === "function") {
    const data = new DataTransfer(); data.setData("text/plain", text);
    select();
    const pasted = !composer.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: data }));
    if (pasted || current().trim()) return settled("paste");
  }
  const accepted = composer.dispatchEvent(new InputEvent("beforeinput", { bubbles: true, cancelable: true, inputType: "insertText", data: text }));
  if (current().trim()) return settled("beforeinput");
  // An editor that cancelled the insertion keeps its own state; never write around it.
  // A cancelled insertion may still be the editor inserting through its own state, a frame later.
  if (!accepted || !composer.isConnected) return settled("editor cancelled");
  const paragraph = document.createElement("p"); paragraph.textContent = text; composer.replaceChildren(paragraph);
  composer.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
  return settled("paragraph");
}
