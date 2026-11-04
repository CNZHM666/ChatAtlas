import { createContentHash, normalizeMessageText, previewMessage } from "./message-identity";
import { chatGPTConversationId,type NativeMessageIdentity } from "../shared/native-discussion";
import { findQuestionBlock, looseText, sameQuestionText } from "./question-text";

import type {DetectedConversation,ParsedChatMessage} from "./capture-adapter";
export type {DetectedConversation,ParsedChatMessage} from "./capture-adapter";
export interface ChatGPTAdapter {
  detectConversation(): DetectedConversation | null;
  parseMessages(): ParsedChatMessage[];
  parseQuestions?(): ParsedChatMessage[];
  cancelLocate?(): void;
  locateMessage(identity: MessageIdentity): Promise<HTMLElement | null>;
  revealMessage?(identity: MessageIdentity): Promise<HTMLElement | null>;
  discussionElements?(element: HTMLElement): HTMLElement[];
  followingAssistant(element: HTMLElement): HTMLElement | null;
  scrollContainer(element: HTMLElement): HTMLElement | Window;
  stickyHeaderBottom(): number;
}

export type MessageIdentity=NativeMessageIdentity;

/** The only module allowed to know ChatGPT selectors and URL conventions. */
export interface ChatGPTAdapter {
  detectConversation(): DetectedConversation | null;
  parseMessages(): ParsedChatMessage[];
  /** Lightweight navigation scan; never snapshots rich assistant replies. */
  parseQuestions?(): ParsedChatMessage[];
  cancelLocate?():void;
  locateMessage(identity: MessageIdentity): Promise<HTMLElement | null>;
  revealMessage?(identity:MessageIdentity):Promise<HTMLElement|null>;
  discussionElements?(element:HTMLElement):HTMLElement[];
  followingAssistant(element: HTMLElement): HTMLElement | null;
  scrollContainer(element: HTMLElement): HTMLElement | Window;
  stickyHeaderBottom(): number;
}

const locateHashes=new WeakMap<HTMLElement,{text:string;role:string;hash:string}>();
// ChatGPT's earlier markup (conversation-turn articles, data-message-author-role, data-message-id) and its current
// one (data-turn-key turns, data-content-search-unit-key "<turn>:<n>:<role>" messages, data-chatgpt-search-message-ids)
// are both recognized.
const TURN_SELECTOR = '[data-testid^="conversation-turn-"], [data-turn-key]';
const USER_SELECTOR = '[data-message-author-role="user"], [data-content-search-unit-key$=":user"]';
const ROLE_SELECTOR = `${USER_SELECTOR}, [data-message-author-role="assistant"], [data-content-search-unit-key$=":assistant"]`;
const MESSAGE_ID_ATTRIBUTES = ["data-message-id", "data-chatgpt-search-message-ids", "data-chatgpt-selection-message-id", "data-dil-message-id"] as const;
const MESSAGE_ID_SELECTOR = MESSAGE_ID_ATTRIBUTES.map(name => `[${name}]`).join(", ");
/** The current markup cannot yet be matched to imported messages reliably: page capture skips it, so it never
 * rewrites a conversation that was imported or synced in full. */
/** How many saved messages away a question may be and still be loaded on the page in reasonable time. */
const FAR_QUESTIONS = 24;
export function usesCurrentChatGPTMarkup(): boolean {
  return !document.querySelector('[data-message-author-role]') && Boolean(document.querySelector('[data-content-search-unit-key]'));
}
function roleOf(element: Element): string | null {
  return element.getAttribute("data-message-author-role") ?? element.getAttribute("data-content-search-unit-key")?.split(":").at(-1) ?? null;
}
function ownMessageId(element: Element | null | undefined): string | undefined {
  for (const name of MESSAGE_ID_ATTRIBUTES) { const value = element?.getAttribute(name)?.trim().split(/\s+/u)[0]; if (value) return value; }
  return undefined;
}
/** Hidden copies (sidebars, previews) never count. An aria-hidden region still counts while it is rendered: the
 * host marks the whole app aria-hidden behind its own overlays and panels. */
function hostHidden(element: HTMLElement): boolean {
  return Boolean(element.closest('[hidden], aside, nav')) || Boolean(element.closest('[aria-hidden="true"]')) && !element.getClientRects().length;
}
/** The thread is not always inside <main>: prefer it when it holds messages, otherwise read the whole page. */
function threadScope(selector: string): ParentNode {
  const main = document.querySelector("main");
  return main?.querySelector(selector) ? main : document;
}
function threadRoles(): HTMLElement[] {
  return Array.from(threadScope(ROLE_SELECTOR).querySelectorAll<HTMLElement>(ROLE_SELECTOR)).filter(role => !hostHidden(role));
}
const THREAD_SELECTOR = `${TURN_SELECTOR}, ${ROLE_SELECTOR}`;
const TEXT_BLOCK_SELECTOR = `${THREAD_SELECTOR}, article, [data-message-id], .whitespace-pre-wrap`;

/** Only the host's actual composer, never a sidebar or an arbitrary editable field. */
export function chatGPTComposer(): HTMLElement | undefined {
  // The input box is not always inside <main>; one inside it wins when there are several.
  const candidates = Array.from(document.querySelectorAll<HTMLElement>('#prompt-textarea, textarea[data-testid="prompt-textarea"], form [contenteditable="true"].ProseMirror'))
    .sort((a, b) => Number(Boolean(b.closest("main"))) - Number(Boolean(a.closest("main"))));
  const found = candidates.find(element => !element.closest('aside, nav, [hidden], [role="dialog"]') && !(element.closest('[aria-hidden="true"]') && !element.getClientRects().length) && !element.hidden && getComputedStyle(element).display !== "none" && getComputedStyle(element).visibility !== "hidden" && (element instanceof HTMLTextAreaElement ? !element.disabled && !element.readOnly : element.getAttribute("contenteditable") === "true"));
  if (!found) console.warn("[ChatAtlas] input box", { candidates: candidates.length, inMain: candidates.filter(element => element.closest("main")).length, main: Boolean(document.querySelector("main")) });
  return found;
}

export function chatGPTEntryVisible(element:HTMLElement):boolean {
  if(element.closest('[hidden], [aria-hidden="true"]'))return false;
  for(let parent:HTMLElement|null=element;parent;parent=parent.parentElement){const style=getComputedStyle(parent);if(style.display==="none"||style.visibility==="hidden"||style.visibility==="collapse"||style.opacity==="0")return false;}
  const rect=element.getBoundingClientRect();
  if(!rect.width||!rect.height)return !document.documentElement.clientWidth;
  if(rect.right<=0||rect.bottom<=0||rect.left>=window.innerWidth||rect.top>=window.innerHeight)return false;
  for(let parent=element.parentElement;parent;parent=parent.parentElement){const style=getComputedStyle(parent),bounds=parent.getBoundingClientRect();if(!bounds.width||!bounds.height)continue;if(/hidden|clip|auto|scroll/u.test(style.overflowX||style.overflow)&& (rect.left>=bounds.right||rect.right<=bounds.left))return false;if(/hidden|clip|auto|scroll/u.test(style.overflowY||style.overflow)&&(rect.top>=bounds.bottom||rect.bottom<=bounds.top))return false;}
  return true;
}
/** Keep host selectors here. Navigation and an edge control cover header-less layouts. */
export function chatGPTEntryAnchor(conversation: boolean): { anchor: HTMLElement; placement: "before" | "after" | "prepend"; variant?: "toolbar" | "navigation" | "edge" } | undefined {
  if (!conversation && window.location.pathname !== "/" && !/^\/g\/[^/]+(?:\/|$)/u.test(window.location.pathname)) return undefined;
  // The current host can put Share in a toolbar without a semantic header.
  // Prefer its left neighbour; never match a share action inside a message or menu.
  const share=Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(button=>{
    if(button.classList.contains("atlas-navigator-trigger")||button.closest('nav, aside, #stage-slideover-sidebar, #stage-sidebar, [data-testid="sidebar"], [role="dialog"], [role="menu"], form, article, [data-message-author-role], [data-testid^="conversation-turn-"]'))return false;
    const labels=[button.getAttribute("aria-label"),button.getAttribute("title"),button.textContent];
    if(!button.matches('[data-testid="share-chat-button"], [data-testid="share-conversation-button"]')&&!labels.some(label=>/^(?:分享(?:聊天|对话)?|share(?: chat| conversation)?)$/iu.test(label?.trim()??"")))return false;
    const rect=button.getBoundingClientRect();return rect.top>=0&&rect.top<100&&chatGPTEntryVisible(button);
  });
  if(share)return {anchor:share,placement:"before",variant:"toolbar"};
  const toolbar = 'header button, #page-header button, [data-testid="conversation-header"] button, [data-testid="page-header"] button, button[data-testid="share-chat-button"], button[data-testid="temporary-chat-button"]';
  const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>(conversation ? toolbar : `${toolbar}, main button`))
    .filter(button => !button.classList.contains("atlas-navigator-trigger") && !button.closest('nav, aside, #stage-slideover-sidebar, #stage-sidebar, [data-testid="sidebar"], [role="dialog"]') && (conversation || !button.closest("form")) && chatGPTEntryVisible(button));
  const model = buttons.find(button => button.getBoundingClientRect().top < 100 && (
    button.matches('[data-testid="model-switcher-dropdown-button"], #model-switcher-dropdown-button') || /^ChatGPT(?:\s+[\w.-]+)?$/iu.test(button.textContent?.trim() ?? "")
  ));
  if (model) return {anchor:model,placement:"after"};
  const action = conversation ? buttons.find(button => {
    const label = `${button.getAttribute("aria-label") ?? ""} ${button.getAttribute("title") ?? ""} ${button.textContent ?? ""}`.trim();
    return (/(^|\s)(分享|Share)(\s|$)/iu.test(label) || button.matches('[data-testid="share-chat-button"]')) && button.getBoundingClientRect().top < 180;
  }) : buttons.filter(button => {
    const rect = button.getBoundingClientRect(), style = getComputedStyle(button);
    return rect.width > 0 && rect.height > 0 && rect.top >= 0 && rect.top < 100 && rect.left >= window.innerWidth * .6 && style.display !== "none" && style.visibility !== "hidden";
  }).sort((a, b) => b.getBoundingClientRect().right - a.getBoundingClientRect().right)[0];
  // Without a model control, use the start of the main header, not the crowded share group.
  const header=action?.closest<HTMLElement>('header, #page-header, [data-testid="conversation-header"], [data-testid="page-header"]');
  if(header)return {anchor:header,placement:"prepend"};
  const newChat=Array.from(document.querySelectorAll<HTMLElement>('a[href="/"], button[data-testid="create-new-chat-button"], [data-testid="create-new-chat-button"]')).find(element=>{
    const label=element.getAttribute("aria-label") || element.textContent?.trim() || "";
    return /^(?:新聊天|新对话|new chat|new conversation)(?:\s|$)/iu.test(label) && !element.closest('[role="dialog"]') && chatGPTEntryVisible(element);
  });
  if(newChat){
    const parent=newChat.parentElement;
    const anchor=parent?.childElementCount===1&&!parent.matches('nav, aside, main, body, #stage-sidebar, #stage-slideover-sidebar, [data-testid="sidebar"]')?parent:newChat;
    return {anchor,placement:"after",variant:"navigation"};
  }
  // Keep the side-panel launch reachable even when host navigation is collapsed/replaced.
  return document.body?{anchor:document.body,placement:"prepend",variant:"edge"}:undefined;
}

function elementText(element: HTMLElement): string {
  const copy = element.cloneNode(true) as HTMLElement;
  copy.querySelectorAll('button, [role="button"], script, style, [hidden], [aria-hidden="true"]').forEach(node => node.remove());
  for (const pre of copy.querySelectorAll("pre")) {
    const code = pre.querySelector("code");
    const text = (code ?? pre).textContent ?? "";
    const language = code?.className.match(/language-([\w-]+)/u)?.[1] ?? "text";
    const longestFence = Math.max(2, ...Array.from(text.matchAll(/`+/gu), match => match[0].length));
    const fence = "`".repeat(longestFence + 1);
    pre.replaceWith(document.createTextNode(`\n\n${fence}${language}\n${text}\n${fence}\n\n`));
  }
  for (const code of copy.querySelectorAll("code")) {
    const text = code.textContent ?? "";
    const ticks = "`".repeat(Math.max(1, ...Array.from(text.matchAll(/`+/gu), match => match[0].length + 1)));
    code.replaceWith(document.createTextNode(`${ticks} ${text} ${ticks}`));
  }
  copy.querySelectorAll("br").forEach(node => node.replaceWith(document.createTextNode("\n")));
  copy.querySelectorAll("p, div, li, h1, h2, h3, h4, blockquote, tr").forEach(node => node.appendChild(document.createTextNode("\n")));
  return copy.textContent || "";
}

function titleFromPage(conversationPath: string): string {
  const title = document.title.replace(/\s*[-–|]\s*ChatGPT\s*$/i, "").trim();
  if (title && title.toLocaleLowerCase() !== "chatgpt") return title;

  const currentLink = Array.from(document.querySelectorAll<HTMLAnchorElement>('nav a[href^="/c/"]'))
    .find((link) => new URL(link.href, location.origin).pathname === conversationPath);
  return currentLink?.textContent?.trim() || "Untitled conversation";
}

function stableMessageId(root: HTMLElement, roleElement: HTMLElement): string | undefined {
  const holder=roleElement.closest<HTMLElement>(MESSAGE_ID_SELECTOR);
  return ownMessageId(roleElement)
    ?? (holder&&root.contains(holder)?ownMessageId(holder):undefined)
    ?? ownMessageId(roleElement.querySelector<HTMLElement>(MESSAGE_ID_SELECTOR))
    ?? ownMessageId(root);
}

function nativeMessageElement(identity:MessageIdentity):HTMLElement|null {
 if(!identity.messageId)return null;
 // A current turn may be keyed by its question's ID: then it can be reached even before its text renders.
 const keyed=document.querySelector<HTMLElement>(`[data-turn-key="${CSS.escape(identity.messageId)}"]`);
 if(keyed&&!hostHidden(keyed)&&identity.role==="user")return keyed;
 const roles=threadRoles();
 const exact=roles.find(role=>{const root=role.closest<HTMLElement>(TURN_SELECTOR)??role;return (!identity.role||roleOf(role)===identity.role)&&(stableMessageId(root,role)===identity.messageId||ownMessageId(root)===identity.messageId);});
 return exact?.closest<HTMLElement>(TURN_SELECTOR)??exact??null;
}

function contentElement(roleElement: HTMLElement, role: "user" | "assistant"): HTMLElement {
  if (role === "assistant") {
    // Rich replies may have several writing/code blocks instead of one Markdown root.
    const blocks = [...roleElement.querySelectorAll<HTMLElement>(`.markdown, pre, [data-atlas-ui-part], ${UI_SELECTOR}`)].filter(block => !block.closest("[hidden],[aria-hidden=true]") && !block.parentElement?.closest(`.markdown, pre, [data-atlas-ui-part], ${UI_SELECTOR}`));
    if (blocks.length === 1) return blocks[0];
    if (blocks.length > 1) { const wrapper = document.createElement("div"); for (const block of blocks) wrapper.append(block.cloneNode(true)); return wrapper; }
    return roleElement;
  }
  return roleElement.querySelector<HTMLElement>(".whitespace-pre-wrap") ?? roleElement;
}

// Recognized source components and semantic image frames. Never infer a UI from TS/JSON code.
const UI_SELECTOR = '[data-testid*="genui"], [data-testid*="widget"], [data-component-type="interactive"], iframe, svg[role="img"]';
const snapshotStyles = "display flex-direction flex-wrap align-items justify-content gap grid-template-columns padding margin border border-radius background-color color font-family font-size font-weight line-height text-align white-space box-shadow".split(" ");

function capturedArticle(element: HTMLElement, role: "user" | "assistant"): { text: string; uiParts?: ParsedChatMessage["uiParts"] } {
  if (role === "user") return { text: normalizeMessageText(elementText(element)) };
  const copy = element.cloneNode(true) as HTMLElement;
  const sourceElements = [element, ...element.querySelectorAll<HTMLElement>("*")];
  const copyElements = [copy, ...copy.querySelectorAll<HTMLElement>("*")];
  const uiParts: NonNullable<ParsedChatMessage["uiParts"]> = [];
  const nonce = `ATLAS_UI_${crypto.randomUUID()}_`;
  let retained = 0;
  for (const source of sourceElements) {
    if (source.closest("pre, code, [hidden], [aria-hidden=true]") || source.parentElement?.closest(UI_SELECTOR) && element.contains(source.parentElement.closest(UI_SELECTOR))) continue;
    const recognized = source.matches(UI_SELECTOR);
    if (!recognized) continue;
    const clone = copyElements[sourceElements.indexOf(source)];
    if (!clone || !copy.contains(clone) && clone !== copy || uiParts.length >= 32) continue;
    const snapshot = source.cloneNode(true) as HTMLElement;
    const descendants = [source, ...source.querySelectorAll<HTMLElement>("*")];
    const snapshotDescendants = [snapshot, ...snapshot.querySelectorAll<HTMLElement>("*")];
    const oversized = descendants.length > 500;
    if (!oversized && source.tagName !== "IFRAME") descendants.forEach((node, index) => {
      const styles = getComputedStyle(node);
      snapshotDescendants[index].setAttribute("style", snapshotStyles.map(property => {
        const value = styles.getPropertyValue(property);
        // Pixel-sized tracks reflect the source viewport, not the reader width.
        // Preserve their proportions while allowing the snapshot to fit its container.
        const columns = property === "grid-template-columns" && /^(?:[\d.]+px\s*)+$/u.test(value) ? value.trim().split(/\s+/u) : undefined;
        const responsive = columns?.length && columns.length <= 6 ? columns.map(column => `minmax(0,${Math.max(1, parseFloat(column))}fr)`).join(" ") : value;
        return `${property}:${responsive}`;
      }).join(";") + ";min-width:0;max-width:100%");
    });
    snapshot.querySelectorAll("script").forEach(node => node.remove());
    const height = source.getBoundingClientRect().height;
    const raw = source.tagName === "IFRAME" ? JSON.stringify({ type: "interactive", title: source.getAttribute("title") ?? "" }) : JSON.stringify({ type: "html", text: oversized ? "" : snapshot.outerHTML, ...(height >= 80 && Number.isFinite(height) ? { height: Math.ceil(height) } : {}) });
    const truncated = oversized || raw.length + retained > 200_000;
    // Temporary tokens are replaced after text normalization, so each occurrence stays stable.
    const fallbackText = source.tagName === "IFRAME" ? "" : normalizeMessageText(elementText(source));
    const marker = document.createElement("span"); marker.textContent = `${nonce}${uiParts.length}_END${fallbackText ? `\n${fallbackText}` : ""}\n`;
    marker.dataset.atlasUiPart = String(uiParts.length);
    if (clone === copy) { copy.replaceChildren(marker); } else clone.replaceWith(marker);
    uiParts.push({ ordinal: 0, raw: truncated ? "" : raw, ...(fallbackText ? { fallbackText } : {}), ...(truncated ? { truncated: true } : {}) });
    retained += truncated ? 0 : raw.length;
  }
  let text = normalizeMessageText(elementText(contentElement(copy, role)));
  uiParts.forEach((part, index) => {
    const marker = `${nonce}${index}_END`, offset = text.indexOf(marker);
    part.ordinal = text.slice(0, offset).split("【原平台交互内容】").length - 1;
    text = text.replace(marker, "【原平台交互内容】");
  });
  return { text, ...(uiParts.length ? { uiParts } : {}) };
}

export class DOMChatGPTAdapter implements ChatGPTAdapter {
  private revealRevision=0;
  /** Why the last reveal stopped without a result, so the sidebar can offer Reader at once. */
  lastReveal?:"far"|"unknown";
  cancelLocate(){this.revealRevision++;}
  followingAssistant(element: HTMLElement): HTMLElement | null {
    const messages = this.parseMessages();
    const index = messages.findIndex((message) => message.element === element);
    if (index < 0) return null;
    for (const message of messages.slice(index + 1)) {
      if (message.role === "user") return null;
      if (message.role === "assistant") return message.element;
    }
    return null;
  }

  scrollContainer(element: HTMLElement): HTMLElement | Window {
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      const overflow = getComputedStyle(parent).overflowY;
      if (/(auto|scroll)/.test(overflow) && parent.scrollHeight > parent.clientHeight + 16) return parent;
    }
    return window;
  }

  stickyHeaderBottom(): number {
    const visible = Array.from(document.querySelectorAll<HTMLElement>('header, [data-testid="conversation-header"]'))
      .filter((element) => /sticky|fixed/.test(getComputedStyle(element).position))
      .map((element) => element.getBoundingClientRect())
      .filter((rect) => rect.top <= 16 && rect.bottom > 0 && rect.bottom < window.innerHeight * .4);
    return Math.min(180, Math.max(0, ...visible.map((rect) => rect.bottom)));
  }

  detectConversation(): DetectedConversation | null {
    const id = chatGPTConversationId(window.location.pathname);
    if (!id) return null;
    const path = window.location.pathname;
    return {
      id,
      url: `${window.location.origin}${path}`,
      title: titleFromPage(path),
    };
  }

  parseMessages(): ParsedChatMessage[] {return this.readMessages(false);}
  parseQuestions(): ParsedChatMessage[] {return this.readMessages(true);}

  private readMessages(questionsOnly:boolean): ParsedChatMessage[] {
    // Hydration can mix turn wrappers and role-only messages. A wrapper in one
    // part of the page must not hide every unwrapped question elsewhere.
    const roles=threadRoles();

    const messages: ParsedChatMessage[] = [];
    const seen = new Set<HTMLElement>();

    for (const [index,roleElement] of roles.entries()) {
      if (!roleElement || seen.has(roleElement)) continue;
      seen.add(roleElement);

      const rawRole = roleOf(roleElement);
      if (rawRole !== "user" && rawRole !== "assistant") continue;
      if(questionsOnly&&rawRole!=="user")continue;
      const root=roleElement.closest<HTMLElement>(TURN_SELECTOR)??roleElement;
      const { text, uiParts } = capturedArticle(roleElement, rawRole);
      if (!text) continue;

      messages.push({
        stableId: stableMessageId(root, roleElement),
        index: questionsOnly?index:messages.length,
        role: rawRole,
        text,
        ...(uiParts?.length ? { uiParts } : {}),
        element: root,
      });
    }
    return messages;
  }

  /** Bounded recovery for a virtualized native turn. Only exact IDs can
   * succeed; original scroll is restored on failure in the same conversation. */
  /** The question by its native ID, or by its text when the page's IDs differ from the saved ones. */
  private mountedQuestion(identity:MessageIdentity):HTMLElement|null{return nativeMessageElement(identity)??this.textMatch(identity);}
  private textMatch(identity:MessageIdentity):HTMLElement|null{
    if(!identity.text||identity.role!=="user")return null;
    const same=this.parseQuestions().filter(message=>sameQuestionText(message.text,identity.text!,identity.textTruncated));
    if(same.length)return same.length===1?same[0].element:null;
    // The page may no longer mark message roles the way it used to. Find the smallest visible block that shows
    // this question and little else, so an answer quoting it is never taken for the question.
    const wanted=looseText(identity.text);
    if(wanted.length<8)return null;
    const blocks=Array.from(threadScope(TEXT_BLOCK_SELECTOR).querySelectorAll<HTMLElement>(TEXT_BLOCK_SELECTOR)).filter(block=>!hostHidden(block)&&!block.closest('form, [contenteditable="true"]'));
    // A label such as "edited" may sit beside the question; an answer quoting it says much more.
    const shown=blocks.flatMap(block=>{const own=looseText(block.textContent??"");return own.includes(wanted)&&(identity.textTruncated||own.length<=wanted.length*1.15+12)?[{block,exact:own===wanted}]:[];});
    const smallest=shown.filter(item=>!shown.some(other=>other!==item&&item.block.contains(other.block)));
    const exact=smallest.filter(item=>item.exact),pick=exact.length?exact:smallest;
    if(pick.length)return pick.length===1?pick[0].block.closest<HTMLElement>(TURN_SELECTOR)??pick[0].block:null;
    // No known message markup at all: search the page's text itself.
    return findQuestionBlock(identity.text,identity.textTruncated);
  }
  async revealMessage(identity:MessageIdentity):Promise<HTMLElement|null> {
    const conversation=this.detectConversation()?.id;
    // Without recognized message markup there is nothing to steer scrolling by: fail at once rather than
    // scrolling blindly through a history the page loads piece by piece.
    if(!threadRoles().length){this.lastReveal="unknown";return null;}
    if(!conversation||!identity.messageId&&!identity.text||identity.messageIndex===undefined||identity.role!=="user")return null;
    const revision=++this.revealRevision;
    const anchors=new Map(identity.anchors?.map(anchor=>[anchor.messageId,anchor.messageIndex]));
    const coordinates=new Map<number,number>();
    const windowTurns=()=>{
      // Current turns carry no position number; their questions' saved IDs (anchors) still place them.
      const all=Array.from(threadScope(TURN_SELECTOR).querySelectorAll<HTMLElement>(TURN_SELECTOR)).map(element=>({element,index:Number(element.getAttribute("data-testid")?.replace("conversation-turn-","")??Number.NaN)}));
      const turns=all.filter(item=>Number.isFinite(item.index));
      const known=all.flatMap(turn=>{const role=turn.element.matches(USER_SELECTOR)?turn.element:turn.element.querySelector<HTMLElement>(USER_SELECTOR);const id=role&&stableMessageId(turn.element,role),index=id?anchors.get(id):undefined;if(index===undefined)return [];if(Number.isFinite(turn.index))coordinates.set(turn.index,index);return [{element:turn.element,index}];});
      // Stored messages and rendered turns are different coordinate systems.
      // Known native IDs establish direction; DOM indices are only a fallback.
      if(known.length||!coordinates.size)return known.length?known:turns;
      // Estimate direction in windows between known anchors, preserving their
      // coordinate system. This estimate can guide scrolling, never success.
      const points=[...coordinates].sort((a,b)=>a[0]-b[0]);
      return turns.map(turn=>{
        const left=points.filter(point=>point[0]<=turn.index).at(-1)??points[0];
        const right=points.find(point=>point[0]>turn.index)??points.at(-1)!;
        const ratio=right[0]===left[0]?1:(right[1]-left[1])/(right[0]-left[0]);
        return {...turn,index:left[1]+(turn.index-left[0])*ratio};
      });
    };
    const indexed=windowTurns();
    // The current page keeps only a handful of turns and loads history a chunk at a time. A question far from what
    // is loaded, or a window without any known question to steer by, would take dozens of loads: hand it to Reader.
    const knownNow=indexed.filter(item=>anchors.size&&[...anchors.values()].includes(item.index));
    const gap=knownNow.length?Math.min(...knownNow.map(item=>Math.abs(item.index-identity.messageIndex!))):Number.POSITIVE_INFINITY;
    if(usesCurrentChatGPTMarkup()&&gap>FAR_QUESTIONS){this.lastReveal=knownNow.length?"far":"unknown";return null;}
    const surface=()=>{
      const root=threadScope(THREAD_SELECTOR).querySelector<HTMLElement>(THREAD_SELECTOR)??document.querySelector<HTMLElement>("main");
      return root?this.scrollContainer(root):window;
    };
    let container=surface();
    const initial=container===window?window.scrollY:(container as HTMLElement).scrollTop;
    // ChatGPT loads older history a chunk at a time, so a question far up takes many steps. Keep going while each
    // step brings the target closer; stop after a few seconds without progress, or at the hard limit.
    const hardLimit=Date.now()+45_000;
    let deadline=Date.now()+8_000,closest=Number.POSITIVE_INFINITY;
    let interrupted=false,lower:number|undefined,upper:number|undefined,wake:(()=>void)|undefined;
    const stop=()=>{interrupted=true;wake?.();};
    for(const event of ["wheel","touchstart","keydown"])window.addEventListener(event,stop,{passive:true});
    const unchanged=()=>this.detectConversation()?.id===conversation&&this.revealRevision===revision&&!interrupted;
    const fingerprint=()=>Array.from(threadScope(THREAD_SELECTOR).querySelectorAll<HTMLElement>(THREAD_SELECTOR)).map(element=>`${element.getAttribute("data-testid")??""}:${ownMessageId(element)??element.getAttribute("data-turn-key")??""}`).join("|");
    const wait=(before:string)=>new Promise<HTMLElement|null>(resolve=>{
      let finished=false;
      const finish=(element:HTMLElement|null)=>{if(finished)return;finished=true;observer.disconnect();clearTimeout(timer);clearInterval(poll);wake=undefined;resolve(element);};
      const check=()=>{if(!unchanged())finish(null);else{const element=this.mountedQuestion(identity);if(element||fingerprint()!==before)finish(element);}};
      const observer=new MutationObserver(check),timer=window.setTimeout(()=>finish(unchanged()?this.mountedQuestion(identity):null),Math.min(1000,Math.max(0,deadline-Date.now())));
      // Also stop when another request or navigation supersedes this one,
      // even if the host does not mutate the DOM during its network request.
      const poll=window.setInterval(check,100);
      wake=check;
      observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:[...MESSAGE_ID_ATTRIBUTES,"data-message-author-role","data-content-search-unit-key","data-turn-key"]});
      check();
    });
    try{
      for(let attempt=0;attempt<150&&Date.now()<Math.min(deadline,hardLimit)&&unchanged();attempt++){
        const mounted=this.mountedQuestion(identity);if(mounted)return mounted;
        const next=surface();
        if(next!==container){container=next;lower=upper=undefined;}
        const visible=attempt===0?indexed:windowTurns();
        const distance=Math.min(...visible.map(item=>Math.abs(item.index-identity.messageIndex!)));
        if(distance<closest){closest=distance;deadline=Date.now()+8_000;}
        const first=Math.min(...visible.map(item=>item.index)),last=Math.max(...visible.map(item=>item.index));
        const position=container===window?window.scrollY:(container as HTMLElement).scrollTop;
        const max=container===window?document.documentElement.scrollHeight:(container as HTMLElement).scrollHeight;
        let destination:number;
        if(!visible.length){
          // Role-only/initially loading pages still need recovery. With two
          // known bounds, hydrate the middle; otherwise start from history.
          const height=container===window?window.innerHeight:(container as HTMLElement).clientHeight;
          destination=lower!==undefined&&upper!==undefined?(lower+upper)/2:attempt===0?0:Math.min(max,position+Math.max(600,height*.85));
        }
        else if(identity.messageIndex<first){upper=position;destination=lower===undefined?0:(lower+upper)/2;}
        else if(identity.messageIndex>last){lower=position;destination=upper===undefined?max:(lower+upper)/2;}
        else {
          // Some native turns are placeholders inside the mounted index range.
          // Scroll their position to hydrate them, but accept only the exact ID.
          const placeholder=visible.reduce((best,item)=>Math.abs(item.index-identity.messageIndex!)<Math.abs(best.index-identity.messageIndex!)?item:best);
          const top=container===window?0:(container as HTMLElement).getBoundingClientRect().top;
          destination=Math.max(0,position+placeholder.element.getBoundingClientRect().top-top-80);
        }
        const waiting=wait(fingerprint());
        container.scrollTo({top:destination,behavior:"instant"});
        const element=await waiting;
        if(element&&unchanged())return element;
      }
    }catch{/* The host can replace its scroll surface during hydration. */}
    finally{
      for(const event of ["wheel","touchstart","keydown"])window.removeEventListener(event,stop);
    }
    if(unchanged())surface().scrollTo({top:initial,behavior:"instant"});
    return null;
  }

  /** DOM-only turn ownership: no Markdown capture or hashing of all replies. */
  discussionElements(element:HTMLElement):HTMLElement[] {
    const roles=threadRoles();
    const index=roles.findIndex(role=>role===element||element.contains(role));
    if(index<0)return [];
    if(roleOf(roles[index])!=="user")return [];
    const turn=(role:HTMLElement)=>role.closest<HTMLElement>(TURN_SELECTOR)??role;
    const result=[turn(roles[index])];
    for(const role of roles.slice(index+1)){
      const owner=roleOf(role);
      if(owner==="user")break;
      if(owner==="assistant"&&!result.includes(turn(role)))result.push(turn(role));
    }
    return result;
  }

  async locateMessage(identity: MessageIdentity): Promise<HTMLElement | null> {
    this.revealRevision++;
    this.lastReveal=undefined;
    const reliableHash=/^[a-f0-9]{64}$/iu.test(identity.contentHash);
    let mismatchedId=false;
    // Strong IDs can locate an existing native turn without capturing every
    // assistant response, which is expensive in long chats with rich content.
    if(identity.messageId){
      const roles=threadRoles();
      const exact=nativeMessageElement(identity);
      if(exact)return exact;
      // A known ID absent among other stable IDs may be an unmounted/other
      // branch. Do not jump to a different turn with similar text or index.
      mismatchedId=roles.some(role=>stableMessageId(role.closest<HTMLElement>(TURN_SELECTOR)??role,role)!==undefined);
      if(mismatchedId&&!reliableHash)return this.textMatch(identity);
    }
    // Imported IDs and hashes come from the platform's stored source, which the page renders differently.
    // The same full question text, once on the page, is the question.
    const byText=this.textMatch(identity);
    if(byText)return byText;

    const messages = identity.role==="user"?this.parseQuestions():this.parseMessages();
    if (identity.messageId) {
      const exact = messages.find((message) => message.stableId === identity.messageId);
      if (exact && (!identity.role||exact.role===identity.role)) return exact.element;
    }

    const hashMatch = messages.find((message) => (!identity.role||message.role===identity.role)&&locateHashes.get(message.element)?.text===message.text&&locateHashes.get(message.element)?.role===message.role&&locateHashes.get(message.element)?.hash===identity.contentHash);
    if (hashMatch&&!mismatchedId) return hashMatch.element;

    // The visible question text and index are already available. Match them before
    // hashing every turn in a long conversation on the main thread.
    const preview = previewMessage(identity.preview, 120).replace(/…$/u, "");
    const sameRole = messages.filter((message) => !identity.role || message.role === identity.role);
    const exactTextMatches = preview ? sameRole.filter((message) => previewMessage(message.text, 120) === preview) : [];
    const textMatches = exactTextMatches.length ? exactTextMatches : preview ? sameRole.filter((message) => previewMessage(message.text, 120).includes(preview)) : [];
    if (!reliableHash && textMatches.length && (textMatches.length===1 || preview.length<40 && identity.messageIndex!==undefined)) {
      const closest = identity.messageIndex === undefined ? textMatches[0] : textMatches.reduce((best, item) =>
        Math.abs(item.index - identity.messageIndex!) < Math.abs(best.index - identity.messageIndex!) ? item : best);
      return closest.element;
    }

    if (!reliableHash && identity.messageIndex !== undefined && textMatches.length<=1) {
      const candidate = messages[identity.messageIndex];
      if (candidate && (!identity.role || candidate.role === identity.role) && (!preview || previewMessage(candidate.text, 120).includes(identity.role?preview:preview.slice(0, 20)))) return candidate.element;
    }

    const hashCandidates=textMatches.length?[...textMatches,...sameRole.filter(message=>!textMatches.includes(message))]:sameRole;
    const verified:ParsedChatMessage[]=[];
    for (const message of hashCandidates) {
      if (identity.role && message.role !== identity.role) continue;
      const cached=locateHashes.get(message.element);
      const hash = cached?.text===message.text&&cached.role===message.role?cached.hash:await createContentHash(`${message.role}\n${message.text}`);
      locateHashes.set(message.element,{text:message.text,role:message.role,hash});
      message.element.dataset.atlasContentHash = hash;
      if (hash === identity.contentHash){if(!mismatchedId)return message.element;verified.push(message);}
    }
    // Imported mapping IDs can differ from native message IDs. Only a unique
    // full-content hash may bridge them; a preview or numeric position cannot.
    if(mismatchedId)return verified.length===1?verified[0].element:null;
    if (identity.messageIndex !== undefined && !identity.role) return messages[identity.messageIndex]?.element ?? null;
    return null;
  }
}
