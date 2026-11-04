import type { ChatGPTAdapter } from "./chatgpt-adapter";
import type { NativeMessageIdentity } from "../shared/native-discussion";
import { calculateNavigationPlacement } from "./navigation-placement";

/** An explicit source action, never called on query completion. */
export async function locateDiscussion(adapter: ChatGPTAdapter, conversationId: string, identity: NativeMessageIdentity, mountedElement?:HTMLElement): Promise<boolean> {
  if (adapter.detectConversation()?.id !== conversationId || identity.role !== "user") return false;
  adapter.cancelLocate?.();
  let element = mountedElement?.isConnected?mountedElement:await adapter.locateMessage(identity);
  if(!element&&adapter.detectConversation()?.id===conversationId)element=await adapter.revealMessage?.(identity)??null;
  // The host may have switched conversations during async hashing.
  if (!element || !element.isConnected || adapter.detectConversation()?.id !== conversationId) return false;
  const turns:HTMLElement[]=adapter.discussionElements?.(element)??(()=>{
    const messages=adapter.parseMessages(),index=messages.findIndex(item=>item.element===element&&item.role==="user");
    if(index<0)return [];
    const result:HTMLElement[]=[];
    for(const message of messages.slice(index)){if(result.length&&message.role==="user")break;result.push(message.element.closest<HTMLElement>('article[data-testid^="conversation-turn-"]')??message.element);}
    return result;
  })();
  // A block found by its text alone has no role markup to group a turn by; mark the block itself.
  if(!turns.length)turns.push(element);
  // A question found inside a shadow root or frame needs the highlight style there, and its own scrolling.
  const owner = element.getRootNode() as Document | ShadowRoot, styleHost = owner instanceof ShadowRoot ? owner : owner.head;
  if (styleHost && !styleHost.querySelector("#atlas-discussion-highlight-style")) {
    const style = document.createElement("style"); style.id = "atlas-discussion-highlight-style";
    style.textContent = '.atlas-located-discussion{outline:2px solid #22c55e!important;outline-offset:8px;border-radius:14px;box-shadow:0 0 0 8px rgba(34,197,94,.07)}'; styleHost.append(style);
  }
  for (const scope of [document, owner]) scope.querySelectorAll(".atlas-located-discussion").forEach(item => item.classList.remove("atlas-located-discussion"));
  // Outline the complete turn, including role labels, rather than a fragment of its text.
  turns.forEach(turn=>turn.classList.add("atlas-located-discussion"));
  const behavior: ScrollBehavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth";
  if (owner !== document) { element.scrollIntoView({ block: "center", behavior }); return true; }
  const container = adapter.scrollContainer(element), rect = element.getBoundingClientRect();
  const viewport = container === window ? { top: 0, height: window.innerHeight } : (container as HTMLElement).getBoundingClientRect();
  const { scrollDelta } = calculateNavigationPlacement({ role: "user", messageTop: rect.top, messageBottom: rect.bottom, textLength: element.textContent?.length ?? 0, viewportTop: viewport.top, viewportHeight: viewport.height, headerBottom: adapter.stickyHeaderBottom(), preferQuestionTop: true });
  container.scrollBy({ top: scrollDelta, behavior });
  return true;
}
