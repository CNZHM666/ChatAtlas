import { expect, it } from "vitest";
import { sourceMessageSignature } from "../shared/source-signature";
import { wikiTableSignature } from "../shared/wiki-table-source";
import { architectureChapter, demoProject } from "./project";

it.each(["en", "zh"] as const)("binds every %s demo claim to a real message in its localized fixture", locale => {
  const { knowledge } = demoProject(locale);
  const { session, conversations, messages } = knowledge;
  expect(conversations.map(chat => chat.platform)).toEqual(["chatgpt", "claude", "gemini", "chatgpt", "claude", "gemini"]);
  expect(session.activeSectionId).toBe(architectureChapter);
  const architecture = session.sections.find(chapter => chapter.id === architectureChapter)!;
  expect(architecture.evidenceIds).toEqual([
    "source-architecture-2", "source-validation-2",
  ]);
  const ruleTable = (text: string) => text.split("\n\n").find(block => block.startsWith("|"));
  const tableInChapter = ruleTable(architecture.body);
  const validationOriginal = messages.find(message => message.id === "validation-2");
  expect(tableInChapter).toBeDefined();
  expect(ruleTable(validationOriginal!.content)).toBeDefined();
  expect(wikiTableSignature(tableInChapter!)).toBe(wikiTableSignature(ruleTable(validationOriginal!.content)!));
  expect(architecture.claims?.every(claim => claim.holder === "decided" && claim.holderMark)).toBe(true);

  for (const chapter of session.sections) {
    for (const claim of chapter.claims ?? []) {
      expect(chapter.body).toContain(claim.text);
      for (const id of claim.evidenceIds) {
        const ref = session.evidence.find(item => item.id === id);
        const original = messages.find(message => message.id === ref?.messageId && message.conversationId === ref.conversationId);
        expect(original?.role).toBe("user");
        expect(original?.content).toContain(claim.quote);
        expect(ref?.sourceSignature).toBe(sourceMessageSignature(original!.content));
      }
    }
  }
});
