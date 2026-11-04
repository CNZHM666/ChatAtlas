import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { locateDiscussion } from "./locate-discussion";
import type { ChatGPTAdapter, ParsedChatMessage } from "./chatgpt-adapter";
beforeEach(() => { vi.stubGlobal("matchMedia", () => ({ matches: false })); document.body.innerHTML = '<main><article data-testid="conversation-turn-0"><div>Question</div></article><article data-testid="conversation-turn-1"><div>Answer one</div></article><article data-testid="conversation-turn-2"><div>Answer two</div></article><article data-testid="conversation-turn-3"><div>Next question</div></article></main>'; });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function fixture() {
  const elements = [...document.querySelectorAll<HTMLElement>("article div")];
  const messages: ParsedChatMessage[] = elements.map((element, index) => ({ element, index, role: index === 0 || index === 3 ? "user" : "assistant", text: element.textContent! }));
  const scrollBy = vi.fn(); vi.spyOn(window, "scrollBy").mockImplementation(scrollBy);
  vi.spyOn(elements[0], "getBoundingClientRect").mockReturnValue({ top: 500, bottom: 550 } as DOMRect);
  const adapter: ChatGPTAdapter = { detectConversation: () => ({ id: "current", title: "", url: "" }), parseMessages: () => messages, locateMessage: async () => elements[0], scrollContainer: () => window, stickyHeaderBottom: () => 60, followingAssistant: () => elements[1] };
  return { adapter, elements, scrollBy };
}
it("scrolls to the question and outlines complete turns including role labels", async () => {
  const { adapter, elements, scrollBy } = fixture();
  expect(await locateDiscussion(adapter, "current", { role: "user", contentHash: "", preview: "Question" })).toBe(true);
  expect(document.querySelectorAll("article.atlas-located-discussion")).toHaveLength(3);
  expect(elements[0]).not.toHaveClass("atlas-located-discussion"); expect(elements[3].parentElement).not.toHaveClass("atlas-located-discussion");
  expect(scrollBy).toHaveBeenCalledWith(expect.objectContaining({ top: Math.round(500 - window.innerHeight * .19) }));
});
it("does not locate another conversation or an assistant fragment", async () => {
  const { adapter, scrollBy } = fixture();
  expect(await locateDiscussion(adapter, "other", { role: "user", contentHash: "", preview: "" })).toBe(false);
  expect(await locateDiscussion(adapter, "current", { role: "assistant", contentHash: "", preview: "" })).toBe(false);
  expect(scrollBy).not.toHaveBeenCalled();
});
it("rejects a late locator result after the host changes conversation", async () => {
  const { adapter, elements, scrollBy } = fixture();
  adapter.locateMessage = async () => { adapter.detectConversation = () => ({ id: "other", title: "", url: "" }); return elements[0]; };
  expect(await locateDiscussion(adapter, "current", { role: "user", contentHash: "", preview: "" })).toBe(false); expect(scrollBy).not.toHaveBeenCalled();
});
it("uses a current native element without depending on imported identities or async matching",async()=>{
 const {adapter,elements,scrollBy}=fixture();adapter.locateMessage=vi.fn(async()=>null);adapter.cancelLocate=vi.fn();
 expect(await locateDiscussion(adapter,"current",{role:"user",contentHash:"",preview:"Question"},elements[0])).toBe(true);
 expect(adapter.cancelLocate).toHaveBeenCalledOnce();expect(adapter.locateMessage).not.toHaveBeenCalled();expect(scrollBy).toHaveBeenCalledOnce();
});
