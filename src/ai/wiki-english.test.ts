import { expect, it } from "vitest";
import type { WikiDraftChapter, WikiKnowledgeUnit } from "../shared/wiki-knowledge";
import { englishDraftPunctuation, englishPunctuation, joinSentence, withStop } from "../shared/wiki-sentences";
import { decidedValuesNotes, reportedStatusRows } from "../shared/wiki-section-status";
import { droppedEmptyHeadings } from "./wiki-stray-paragraphs";
import { namedListItems } from "./wiki-knowledge-write";
import { similarStatements } from "../shared/wiki-knowledge";

const unit = (id: string, statement: string, extra: Partial<WikiKnowledgeUnit> = {}, section?: string): WikiKnowledgeUnit => ({ id, subject: "", statement, kind: "decision", details: [], evidence: { evidenceId: id, conversationId: "c", messageId: id, messageIndex: 1, role: "assistant", pasted: false, quote: statement, ...(section ? { section } : {}) }, adoption: { status: "proposal" }, delivery: "unknown", ...extra });

it("ends and joins English sentences the English way, Chinese ones as before", () => {
  expect(withStop("Bank syncing is excluded from v1")).toBe("Bank syncing is excluded from v1.");
  expect(withStop("第一版不做银行同步")).toBe("第一版不做银行同步。");
  expect(joinSentence("Phone and laptop databases are separate.", "Bank syncing is excluded.")).toBe("Phone and laptop databases are separate. Bank syncing is excluded.");
  expect(joinSentence("数据只存本地。", "不做账号系统。")).toBe("数据只存本地。不做账号系统。");
  expect(joinSentence("- a\n- b", "Then c.")).toBe("- a\n- b\n\nThen c.");
});

it("tells an English sentence already in a paragraph once its sentences are split at periods", () => {
  const paragraph = "AI coaching is excluded. Bank syncing and receipt OCR are excluded from v1 and are only potential v2 features. Phone and laptop databases are separate.";
  const sentences = paragraph.split(/(?:(?<=[。！？!?\n])|(?<=[A-Za-z0-9)\]"'’*%`]\.)(?<!\b(?:e\.g|i\.e|vs|etc|incl|approx|cf)\.)(?=\s))/u).map(sentence => sentence.trim());
  expect(sentences).toHaveLength(3);
  expect(sentences.some(sentence => similarStatements(sentence, "Bank syncing and receipt OCR are excluded from v1 and are only potential v2 features."))).toBe(true);
  expect("Costs about 1.5 hours, e.g. setup.".split(/(?:(?<=[A-Za-z0-9)\]"'’*%`]\.)(?<!\b(?:e\.g|i\.e|vs|etc|incl|approx|cf)\.)(?=\s))/u)).toHaveLength(1);
});

it("gives an English draft English punctuation in body, paragraphs and claims alike", () => {
  expect(englishPunctuation("- **Target User**：A web app（for students）；fast，simple。")).toBe("- **Target User**: A web app (for students); fast, simple.");
  expect(englishPunctuation("首页（工作台）：简洁。")).toBe("首页（工作台）：简洁。");
  const text = "- **Currency**：USD only。";
  const chapter: WikiDraftChapter = { id: "a", title: "A", question: "", group: "", body: `Opening.\n\n### Scope\n\n${text}`, paragraphs: [{ subtopic: "Scope", text, unitIds: [], claims: [{ text: "USD only。", unitIds: [] }] }], problems: [] };
  englishDraftPunctuation([chapter]);
  expect(chapter.body).toContain("- **Currency**: USD only.");
  expect(chapter.body).toContain(chapter.paragraphs[0].text);
  expect(chapter.paragraphs[0].text).toContain(chapter.paragraphs[0].claims![0].text);
});

it("drops a subtopic heading left with nothing under it, and keeps one with text", () => {
  const chapter: WikiDraftChapter = { id: "a", title: "A", question: "", group: "", body: "The chart is built.\n\n### Current Status\n\n### Launch Plan\n\n1. Week 1.\n\n### Empty end\n", paragraphs: [], problems: [] };
  expect(droppedEmptyHeadings([chapter])).toBe(1);
  expect(chapter.body).toBe("The chart is built.\n\n### Launch Plan\n\n1. Week 1.");
});

it("labels list items by the heading their units stood under when the list spans several", () => {
  const bar = unit("bar", "The top bar is fixed at 48px.", {}, "Dashboard top bar"), icon = unit("icon", "Shows a 20px plus icon.", {}, "Add button"), radius = unit("radius", "Corner radius is 12px.", {}, "Add button");
  const paragraph = { text: "- Fixed at 48px for both desktop and mobile.\n- Displays a 20px plus icon.\n- Corner radius is 12px.", claims: [{ text: "Fixed at 48px for both desktop and mobile.", unitIds: ["bar"] }, { text: "Displays a 20px plus icon.", unitIds: ["icon"] }, { text: "Corner radius is 12px.", unitIds: ["radius"] }] };
  expect(namedListItems(paragraph, new Map([bar, icon, radius].map(item => [item.id, item])))).toBe(true);
  expect(paragraph.text).toBe("- **Dashboard top bar**：Fixed at 48px for both desktop and mobile.\n- **Add button**：Displays a 20px plus icon.\n- Corner radius is 12px.");
});

it("says which values of a subtopic are the user's when most are not", () => {
  const body = "Opening.\n\n### Layout\n\n- Top bar 48px.\n- Padding 28px desktop, 16px mobile.\n- Title 24px.\n- Button 40px.\n\n### Other\n\nPlain text.";
  const noted = decidedValuesNotes(body, [{ text: "Top bar 48px.", holder: "decided" }], false);
  expect(noted).toContain("### Layout\n\n> Only 48px here is your decision; the other values are suggestions.\n\n- Top bar 48px.");
  expect(noted).toContain("### Other\n\nPlain text.");
  expect(decidedValuesNotes(body, [{ text: "Top bar 48px.", holder: "decided" }], true)).toContain("> 本节只有 48px 是你确认的取值，其余数值是建议。");
  expect(decidedValuesNotes(body, [], false)).toBe(body);
});

it("lists what the user reported, built or not working yet, once each", () => {
  const user = (id: string, statement: string) => unit(id, statement, { kind: "report", evidence: { evidenceId: id, conversationId: "c", messageId: id, messageIndex: 1, role: "user", pasted: false, quote: statement } });
  const rows = reportedStatusRows([user("a", "Adding and editing transactions are built."), user("b", "CSV export does not work yet."), user("c", "CSV export does not work yet."), unit("d", "Charts are built.")], new Set(["a", "b", "c", "d"]));
  expect(rows).toEqual([{ text: "Adding and editing transactions are built.", done: true, status: "built" }, { text: "CSV export does not work yet.", done: false, status: "not_yet" }]);
  // Built and not built in one report is partly built, not Built.
  expect(reportedStatusRows([user("e", "Three core features are implemented, CSV export is unfinished.")], new Set(["e"]))[0].status).toBe("partial");
  // Placed under a message it says nothing of, it is no report of the user's.
  const placed = user("f", "Three core features are implemented, CSV export is unfinished, and unverified features are treated as unknown rather than complete.");
  placed.evidence.quote = "Give me a roadmap with 4 milestones from now to a public beta.";
  expect(reportedStatusRows([placed], new Set(["f"]))).toEqual([]);
});

it("spaces English sentences glued at a period, leaving file names as they are", () => {
  expect(englishPunctuation("Excluded from v1.Specifically, bank syncing is out. See database.ts and Node.js.")).toBe("Excluded from v1. Specifically, bank syncing is out. See database.ts and Node.js.");
  expect(englishPunctuation("They return after several days.In comparison, it is free.")).toBe("They return after several days. In comparison, it is free.");
  expect(englishPunctuation("It keeps privacy.v1 is web only. Format with Intl.NumberFormat and Array.From(x).")).toBe("It keeps privacy. v1 is web only. Format with Intl.NumberFormat and Array.From(x).");
});
