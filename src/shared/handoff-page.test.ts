import { expect, it } from "vitest";
import { handoffPageMatches } from "./handoff-page";

it("lets knowledge be inserted on any supported new-chat page but never into another open conversation", () => {
  for (const url of ["https://chatgpt.com/", "https://chatgpt.com/g/g-p-123/project", "https://claude.ai/new", "https://chat.deepseek.com/"]) expect(handoffPageMatches(url, "")).toBe(true);
  for (const url of ["https://chatgpt.com/c/abc", "https://claude.ai/chat/abc", "https://example.com/", "not a url"]) expect(handoffPageMatches(url, "")).toBe(false);
  expect(handoffPageMatches("https://chatgpt.com/c/abc", "abc")).toBe(true);
  expect(handoffPageMatches("https://chatgpt.com/c/other", "abc")).toBe(false);
});
