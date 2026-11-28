import { expect, it } from "vitest";
import { projectLedgerPage } from "../canvas/project-wiki-pages";
import { defaultProjectExportPreset } from "../export/project-export-presets";
import { sourceMessageSignature } from "../shared/source-signature";
import { wikiTableSignature } from "../shared/wiki-table-source";
import { architectureChapter, demoProject } from "./project";

it.each(["en", "zh"] as const)("binds every %s demo claim, table, and ledger unit to a real message in its localized fixture", locale => {
  const { knowledge, overview } = demoProject(locale);
  const { session, conversations, messages } = knowledge;
  expect(conversations.map(chat => chat.platform)).toEqual(["chatgpt", "claude", "deepseek", "gemini", "claude", "chatgpt", "deepseek"]);
  expect(session.sections).toHaveLength(6);
  expect(session.activeSectionId).toBe(architectureChapter);

  const ruleTable = (text: string) => text.split("\n\n").find(block => block.startsWith("|"));
  const archSection = session.sections.find(chapter => chapter.id === architectureChapter)!;
  const archOriginal = messages.find(message => message.id === "transcription-1")!;
  expect(wikiTableSignature(ruleTable(archSection.body)!)).toBe(wikiTableSignature(ruleTable(archOriginal.content)!));

  const routingSection = session.sections.find(chapter => chapter.id === "summary-routing")!;
  const routingOriginal = messages.find(message => message.id === "routing-3")!;
  expect(wikiTableSignature(ruleTable(routingSection.body)!)).toBe(wikiTableSignature(ruleTable(routingOriginal.content)!));

  for (const chapter of session.sections) {
    for (const claim of chapter.claims ?? []) {
      expect(chapter.body).toContain(claim.text);
      for (const id of claim.evidenceIds) {
        const ref = session.evidence.find(item => item.id === id);
        const original = messages.find(message => message.id === ref?.messageId && message.conversationId === ref.conversationId);
        expect(original).toBeDefined();
        expect(original?.content).toContain(claim.quote);
        expect(ref?.sourceSignature).toBe(sourceMessageSignature(original!.content));
      }
    }
  }

  expect(overview.questions).toHaveLength(3);
  expect(overview.decisions.length).toBeGreaterThanOrEqual(8);
  expect(defaultProjectExportPreset(session)).toBe("handoff");

  const ledger = projectLedgerPage(session);
  expect(ledger?.chapters).toHaveLength(session.sections.length);
  expect(ledger?.total).toBeGreaterThanOrEqual(20);
  expect(ledger?.counts.get("confirmed")).toBeGreaterThanOrEqual(8);
  expect(ledger?.counts.get("proposal")).toBeGreaterThanOrEqual(4);
  expect(ledger?.counts.get("open")).toBeGreaterThanOrEqual(3);
  expect(ledger?.counts.get("history")).toBeGreaterThanOrEqual(3);
  expect(ledger?.counts.get("reported")).toBeGreaterThanOrEqual(1);
});
