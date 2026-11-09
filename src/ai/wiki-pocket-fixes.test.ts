import { expect, it } from "vitest";
import type { WikiDraftChapter, WikiKnowledgeOrganization, WikiKnowledgeUnit, WikiSubject, WikiUnitStatus } from "../shared/wiki-knowledge";
import { droppedRepeatedListItems, droppedRepeatedParagraphs } from "./wiki-paragraph-repeats";
import { chapterRepeatedClauses, isCommentary, lostNegation, refreshedClaimProblems } from "./wiki-knowledge-write";
import { ensureWikiDecisions } from "./wiki-decision-coverage";
import { ordinalLabelledItems } from "./wiki-ordinal-labels";
import { contentMoveAllowed, movedTopicUnits, technicalSubject, namedForContent, moveInterfaceSubjects, moveNamedSubjects, moveTechnicalSubjects, movedPartUnits } from "./wiki-knowledge-organize";
import { UNDECIDED } from "../shared/wiki-section-status";
import { droppedCoveredListings, droppedContainedDecisions, droppedDecisionEchoes, mergedLabelledLists, droppedEnglishAsides, droppedInnerRepeats, droppedOpeningRepeats, droppedRepeatedSentences, droppedUncitedParagraphs, droppedUnrelatedParagraphs, labelledSubjectlessItems, restoredFragments, statementSubject, trimmedDecidedClaims, webPlatformKept } from "./wiki-fragments";
import { claimSupported } from "./wiki-claim-support";
import { currentBaseline, wikiUnitStatuses } from "./wiki-knowledge-state";
import { wikiHolderOf, wikiShownHolder, withHolderMarks } from "../shared/wiki-holder";
import { englishPunctuation } from "../shared/wiki-sentences";
import { stageMoveReplacements, withQuotedMoves } from "./wiki-stage-moves";
import { placedSourceCode } from "../shared/wiki-source-code";
import { removeParagraph, replaceParagraph } from "../shared/wiki-body-text";
import { statesCore, withoutOwnProjectAnswers, type WikiKnowledgeLedger, type WikiWritingQuestion } from "../shared/wiki-knowledge";
import { openingSentenceMarks } from "./wiki-ledger-document";
import { droppedEchoedReports, droppedRepeatedExclusions, droppedTableEchoes, earlierVersionsLast, foldedValueDecisions, joinedLeadRepeats, valueLabel } from "./wiki-fragments";
import { labelContradicts, soundQuestion, withAnswerScope, withAnsweredChoices, withAnsweredOpenPoints, withDeclinedProposals, withSettledByAnswer, withSoundAnswers } from "./wiki-question-parse";

const chapter = (texts: Array<[string, string[]]>): WikiDraftChapter => ({
  id: "c", title: "Interface", question: "", group: "",
  body: ["Opening.", "### Visual System", ...texts.map(([text]) => text)].join("\n\n"),
  paragraphs: texts.map(([text, unitIds]) => ({ subtopic: "Visual System", text, unitIds, claims: [] })), problems: [],
}) as WikiDraftChapter;

it("drops a short paragraph its chapter already says, keeping one that adds a point", () => {
  const list = "- Dashboard top bar is confirmed at 48px for both desktop and mobile views.\n- Standard UI components use a global corner radius of 8px.";
  const kept = "A proposed layout displays category icon and description on the left and right-aligned amounts.";
  const draft = chapter([[list, ["a", "b"]], [kept, ["c"]], ["The dashboard top bar height is confirmed at 48px, and the global standard corner radius is confirmed at 8px.", ["d"]], ["The dashboard top bar is 56px on the landing page.", ["e"]]]);
  expect(droppedRepeatedParagraphs([draft])).toBe(1);
  expect(draft.paragraphs.map(paragraph => paragraph.text)).toEqual([list, kept, "The dashboard top bar is 56px on the landing page."]);
  expect(draft.paragraphs[0].unitIds).toEqual(["a", "b", "d"]);
  expect(draft.body).not.toContain("global standard corner radius is confirmed");
});

it("drops a list item another item of its list says in full, plurals folded", () => {
  const items = [
    "- Add transactions, Edit transactions, and Monthly spending chart are built",
    "- CSV export is not working",
    "- Budget tracking and Category management are not yet verified. Add transaction, edit transaction, and monthly spending chart features are built",
    "- CSV export is not working yet",
    "- delete, category management, and budget tracking are unverified. CSV export is required for V1 but is not working yet.",
    "- Exports must escape commas and quotation marks",
  ];
  const draft = chapter([[items.join("\n"), ["a"]]]);
  expect(droppedRepeatedListItems([draft])).toBe(3);
  expect(draft.paragraphs[0].text).toBe([items[2], items[4], items[5]].join("\n"));
  expect(draft.body).toContain(draft.paragraphs[0].text);
});

it("reads English filler that only sums up as commentary, never a rule", () => {
  const rest = "Standard UI components use a global corner radius of 8px. Dashboard top bar is 48px.";
  expect(isCommentary("This specification ensures uniform visual rhythm and component consistency throughout the application.", rest)).toBe(true);
  expect(isCommentary("This combination provides a modern development experience with strong typing and fast build times.", "The frontend stack is React, Vite and TypeScript.")).toBe(true);
  expect(isCommentary("This rule means transaction data must never be sent to a server.", rest)).toBe(false);
  expect(isCommentary("This layout uses a 72px header on desktop.", rest)).toBe(false);
});

it("marks a line already saying a decision instead of adding the decision again", () => {
  const statement = "Shared budgets are dropped entirely from the roadmap and v1 scope.";
  const unit = (id: string, adoption: WikiKnowledgeUnit["adoption"]): WikiKnowledgeUnit => ({ id, subject: "Scope", statement, kind: "decision", details: [], adoption, delivery: "unknown", evidence: { evidenceId: id, conversationId: "x", messageId: id, messageIndex: 1, role: "user", pasted: false, quote: statement } }) as unknown as WikiKnowledgeUnit;
  const units = [unit("d", { status: "user_decision" } as WikiKnowledgeUnit["adoption"]), unit("p", { status: "proposal" } as WikiKnowledgeUnit["adoption"])];
  const organization = { status: "complete", subjects: [{ id: "s", title: "Scope", unitIds: ["d", "p"] }], chapters: [{ id: "c", title: "Scope", question: "", group: "", subtopics: [{ title: "V1 Scope", subjectIds: ["s"] }] }], relations: [], groups: [], merged: [] } as unknown as WikiKnowledgeOrganization;
  const line = `- **Out of scope**：${statement}`;
  const draft: WikiDraftChapter = { id: "c", title: "Scope", question: "", group: "", body: `### V1 Scope\n\n${line}`, paragraphs: [{ subtopic: "V1 Scope", text: line, unitIds: ["p"], claims: [{ text: statement, unitIds: ["p"] }] }], problems: [] } as WikiDraftChapter;
  const statuses = new Map<string, WikiUnitStatus>([["d", "confirmed"], ["p", "proposal"]]);
  expect(ensureWikiDecisions([draft], organization, units, statuses)).toBe(1);
  expect(draft.paragraphs).toHaveLength(1);
  expect(draft.paragraphs[0].claims).toEqual([{ text: statement, unitIds: ["d"] }]);
  expect(draft.body).toBe(`### V1 Scope\n\n${line}`);
});

it("drops a paragraph the chapter's opening already says, the opening citing its units", () => {
  const opening = "The system is built as a web-only application. Data persistence relies exclusively on IndexedDB via Dexie, with localStorage explicitly prohibited.";
  const repeat = "Use IndexedDB via Dexie for local data persistence; do not use localStorage.";
  const draft = { ...chapter([["Other point about the React stack here.", ["a"]], [repeat, ["o"]]]), openingUnitIds: ["o"] } as WikiDraftChapter;
  draft.body = draft.body.replace("Opening.", opening);
  expect(droppedRepeatedParagraphs([draft])).toBe(1);
  expect(draft.body).not.toContain(repeat);
  expect(draft.openingUnitIds).toEqual(["o"]);
  // An opening that does not cite the paragraph's units keeps it.
  const other = { ...chapter([[repeat, ["d"]]]), openingUnitIds: ["o"] } as WikiDraftChapter;
  other.body = other.body.replace("Opening.", opening);
  expect(droppedRepeatedParagraphs([other])).toBe(0);
});

it("reads a decision as stated by a sentence that says it with plurals and a hyphened word", () => {
  expect(statesCore("v1 is web only, with no native mobile app.", "The initial version is defined as a web-only application with no native iOS or Android apps for mobile.")).toBe(true);
  expect(statesCore("v1 is web only, with no native mobile app.", "Shared budgets are dropped entirely from the roadmap.")).toBe(false);
});

it("gives a milestone item the milestone its units come from, in order", () => {
  const unitOf = (subject: string) => ({ subject, evidence: {} }) as unknown as WikiKnowledgeUnit;
  const units = new Map([["v", unitOf("Milestone 3")], ["c", unitOf("Milestone 2")], ["t", unitOf("Milestone 3")], ["b", unitOf("Milestone 4")]]);
  const lines = ["1. **Milestone 1**: Validate with 10–15 college students.", "2. **Milestone 2**: Includes CSV export.", "3. **Milestone 3**: Private alpha targets entry under 10 seconds.", "4. **Public Beta**: Launch to 20–50 users."];
  const draft = chapter([[lines.join("\n"), ["v", "c", "t", "b"]]]);
  draft.paragraphs[0].claims = [{ text: "Validate with 10–15 college students.", unitIds: ["v"] }, { text: "Includes CSV export.", unitIds: ["c"] }, { text: "Private alpha targets entry under 10 seconds.", unitIds: ["t"] }, { text: "Launch to 20–50 users.", unitIds: ["b"] }];
  expect(ordinalLabelledItems([draft], id => units.get(id))).toBe(1);
  expect(draft.paragraphs[0].text).toBe("1. **Milestone 2**: Includes CSV export.\n2. **Milestone 3**: Validate with 10–15 college students. Private alpha targets entry under 10 seconds.\n3. **Public Beta**: Launch to 20–50 users.");
  expect(draft.body).toContain(draft.paragraphs[0].text);
  // A label its units do not all place elsewhere stays.
  const kept = chapter([[lines.slice(0, 2).join("\n"), ["x"]]]);
  kept.paragraphs[0].claims = [{ text: "Validate with 10–15 college students.", unitIds: ["x"] }];
  expect(ordinalLabelledItems([kept], () => unitOf("Roadmap"))).toBe(0);
});

it("moves an interface subject the plan put under the roadmap to the interface chapter", () => {
  const subject = (id: string, name: string): [string, WikiSubject] => [id, { id, name, aliases: [], unitIds: [id] }];
  const subjects = new Map([subject("ui", "UI Specification"), subject("road", "Roadmap"), subject("warn", "User Data Warning"), subject("ynab", "Competitor UI")]);
  const pages = [
    { title: "Interface and Visual Design", group: "", question: "", sectionIds: ["warn"], subtopics: [{ title: "Privacy Messaging", question: "", sectionIds: ["warn"] }] },
    { title: "Roadmap and Validation", group: "", question: "", sectionIds: ["road", "ui"], subtopics: [{ title: "Milestones", question: "", sectionIds: ["road", "ui"] }] },
    { title: "Competitor Analysis", group: "", question: "", sectionIds: ["ynab"], subtopics: [{ title: "Others", question: "", sectionIds: ["ynab"] }] },
  ];
  const report: Record<string, number> = {};
  moveInterfaceSubjects(pages, subjects, report, 4);
  expect(pages[0].subtopics.map(topic => [topic.title, topic.sectionIds])).toEqual([["Privacy Messaging", ["warn"]], ["UI Specification", ["ui"]]]);
  expect(pages[1].sectionIds).toEqual(["road"]);
  expect(pages[2].sectionIds).toEqual(["ynab"]);
  expect(report.plan_moved_interface).toBe(1);
});

it("reads an opening stating two decisions together as telling each of them", () => {
  const decision = (id: string, statement: string): WikiKnowledgeUnit => ({ id, subject: "UI", statement, kind: "decision", details: [], adoption: { status: "user_decision" }, delivery: "unknown", evidence: { evidenceId: id, conversationId: "x", messageId: id, messageIndex: 1, role: "user", pasted: false, quote: statement } }) as unknown as WikiKnowledgeUnit;
  const units = [decision("h", "The dashboard top bar height is confirmed as 48px for both desktop and mobile."), decision("r", "Standard UI components use a global corner radius of 8px.")];
  const organization = { status: "complete", subjects: [{ id: "s", title: "UI", unitIds: ["h", "r"] }], chapters: [{ id: "c", title: "User Experience", question: "", group: "", subtopics: [{ title: "Interface Design", subjectIds: ["s"] }] }], relations: [], groups: [], merged: [] } as unknown as WikiKnowledgeOrganization;
  const opening = "The dashboard top bar is fixed at 48px height across desktop and mobile, while standard UI components use an 8px global corner radius.";
  const draft = { id: "c", title: "User Experience", question: "", group: "", body: `${opening}\n\n### Interface Design\n\nRows are clickable.`, openingUnitIds: ["h", "r"], paragraphs: [{ subtopic: "Interface Design", text: "Rows are clickable.", unitIds: [], claims: [] }], problems: [] } as unknown as WikiDraftChapter;
  ensureWikiDecisions([draft], organization, units, new Map<string, WikiUnitStatus>([["h", "confirmed"], ["r", "confirmed"]]));
  expect(draft.paragraphs).toHaveLength(1);
  expect(draft.body).not.toContain("confirmed as 48px");
});

it("drops a short paragraph with values another chapter already says in full", () => {
  const roadmap = chapter([["Shared budgets are dropped.", ["a"]], ["Dashboard top bar is 48px tall; global corner radius is 8px.", ["p"]]]);
  const ui = { ...chapter([["Rows are clickable.", ["b"]]]), id: "u", title: "User Experience" } as WikiDraftChapter;
  ui.body = ui.body.replace("Opening.", "The dashboard top bar is fixed at 48px height, and standard UI components use an 8px global corner radius.");
  expect(droppedRepeatedParagraphs([roadmap, ui])).toBe(1);
  expect(roadmap.body).not.toContain("48px tall");
  expect(ui.openingUnitIds).toEqual(["p"]);
  // One value alone is not enough to leave its chapter.
  const single = chapter([["Shared budgets are dropped.", ["a"]], ["The top bar is 48px tall.", ["p"]]]);
  expect(droppedRepeatedParagraphs([single, { ...ui, body: ui.body, openingUnitIds: [] } as WikiDraftChapter])).toBe(0);
});

it("restores a paragraph left as the tail of the statement it cites", () => {
  const whole = "A fuller backup/restore workflow is a recommendation, not a confirmed V1 requirement.";
  const units = new Map([["b", { id: "b", statement: whole } as unknown as WikiKnowledgeUnit]]);
  const draft = chapter([["Rows are clickable.", ["x"]], ["not a confirmed V1 requirement.", ["b"]], ["useLiveQuery() updates components.", ["b"]]]);
  draft.paragraphs[1].claims = [{ text: "not a confirmed V1 requirement.", unitIds: ["b"] }];
  expect(restoredFragments([draft], id => units.get(id))).toBe(1);
  expect(draft.paragraphs[1].text).toBe(whole);
  expect(draft.paragraphs[1].claims).toEqual([{ text: whole, unitIds: ["b"] }]);
  expect(draft.body).toContain(`\n\n${whole}\n\n`);
});

it("moves a subject to the chapter named for it", () => {
  const subject = (id: string, name: string): [string, WikiSubject] => [id, { id, name, aliases: [], unitIds: [id] }];
  const subjects = new Map([subject("pos", "Product Positioning"), subject("val", "Value Proposition"), subject("plat", "Platform Scope"), subject("feed", "External Feedback"), subject("mint", "Mint Pricing")]);
  const pages = [
    { title: "Product Positioning", group: "", question: "", sectionIds: ["plat"], subtopics: [{ title: "Core Principles", question: "", sectionIds: ["plat"] }] },
    { title: "Market Context", group: "", question: "", sectionIds: ["feed", "pos", "val"], subtopics: [{ title: "External Feedback", question: "", sectionIds: ["feed", "pos", "val"] }] },
    { title: "Competitor Analysis", group: "", question: "", sectionIds: ["mint"], subtopics: [{ title: "Mint", question: "", sectionIds: ["mint"] }] },
  ];
  const report: Record<string, number> = {};
  moveNamedSubjects(pages, subjects, report, 4);
  expect(pages[0].sectionIds.sort()).toEqual(["plat", "pos", "val"]);
  expect(pages[1].sectionIds).toEqual(["feed"]);
  expect(pages[2].sectionIds).toEqual(["mint"]);
  expect(report.plan_moved_named).toBe(2);
});

it("moves a unit of a numbered part to the subject holding such parts", () => {
  const units = new Map(["b1", "b2", "b3", "m1", "r1", "r2", "r3", "r4"].map((id, index) => [id, { id, subject: ["Budget Period", "Budget Data", "Budget Cadence", "Milestone 1", "Milestone 1 Scope", "Milestone 2 Scope", "Milestone 3 Scope", "Roadmap Structure"][index] } as unknown as WikiKnowledgeUnit]));
  const budget: WikiSubject = { id: "b", name: "Budgeting Model", aliases: [], unitIds: ["b1", "b2", "b3", "m1"] }, roadmap: WikiSubject = { id: "r", name: "Roadmap", aliases: [], unitIds: ["r1", "r2", "r3", "r4"] };
  const report: Record<string, number> = {};
  movedPartUnits([budget, roadmap], units, report);
  expect(budget.unitIds).toEqual(["b1", "b2", "b3"]);
  expect(roadmap.unitIds).toEqual(["r1", "r2", "r3", "r4", "m1"]);
  expect(report.part_units_moved).toBe(1);
});

it("moves a technical subject out of the interface chapter", () => {
  const subject = (id: string, name: string): [string, WikiSubject] => [id, { id, name, aliases: [], unitIds: [id] }];
  const subjects = new Map([subject("ui", "UI Specification"), subject("stack", "Tech Stack"), subject("db", "Persistence Architecture")]);
  const pages = [
    { title: "User Interface", group: "", question: "", sectionIds: ["ui", "stack"], subtopics: [{ title: "Interface Design", question: "", sectionIds: ["ui", "stack"] }] },
    { title: "Technical Architecture", group: "", question: "", sectionIds: ["db"], subtopics: [{ title: "Stack and Strategy", question: "", sectionIds: ["db"] }] },
  ];
  moveInterfaceSubjects(pages, subjects, {}, 4);
  expect(pages[0].sectionIds).toEqual(["ui"]);
  expect(pages[1].sectionIds).toEqual(["db", "stack"]);
});

it("states a decision in place of a short paragraph citing it alone in other words", () => {
  const statement = "Shared budgets are dropped entirely from the roadmap and v1 scope.";
  const unit = { id: "d", subject: "Scope", statement, kind: "decision", details: [], adoption: { status: "user_decision" }, delivery: "unknown", evidence: { evidenceId: "d", conversationId: "x", messageId: "d", messageIndex: 1, role: "user", pasted: false, quote: statement } } as unknown as WikiKnowledgeUnit;
  const organization = { status: "complete", subjects: [{ id: "s", title: "Scope", unitIds: ["d"] }], chapters: [{ id: "c", title: "Roadmap", question: "", group: "", subtopics: [{ title: "Future Plans", subjectIds: ["s"] }] }], relations: [], groups: [], merged: [] } as unknown as WikiKnowledgeOrganization;
  const writer = "Shared budget functionality has been removed from the project's future plans and will not be included in V1 or subsequent milestones.";
  const draft = { id: "c", title: "Roadmap", question: "", group: "", body: `### Future Plans\n\nCloud sync is possible for V2.\n\n${writer}`, paragraphs: [{ subtopic: "Future Plans", text: "Cloud sync is possible for V2.", unitIds: ["o"], claims: [] }, { subtopic: "Future Plans", text: writer, unitIds: ["d"], claims: [{ text: writer, unitIds: ["d"] }] }], problems: [] } as unknown as WikiDraftChapter;
  expect(ensureWikiDecisions([draft], organization, [unit], new Map<string, WikiUnitStatus>([["d", "confirmed"]]))).toBe(1);
  expect(draft.body).toBe(`### Future Plans\n\nCloud sync is possible for V2.\n\n${statement}`);
  expect(draft.paragraphs.map(paragraph => paragraph.text)).toEqual(["Cloud sync is possible for V2.", statement]);
});

it("reads an open product decision as undecided", () => {
  expect(UNDECIDED.test("The choice between monthly budgets and per-pay-period budgets remains an open product decision.")).toBe(true);
  expect(UNDECIDED.test("Monthly budgets are simpler and better suited for fixed allowances.")).toBe(false);
});

it("labels a list item that left out its subject by its unit's topic", () => {
  const units = new Map([["h", { id: "h", subject: "Dashboard Top Bar Height" } as unknown as WikiKnowledgeUnit]]);
  const draft = chapter([["- Confirmed at 48px for both desktop and mobile views.\n- Rows are clickable.", ["h"]]]);
  draft.paragraphs[0].claims = [{ text: "Confirmed at 48px for both desktop and mobile views.", unitIds: ["h"] }];
  expect(labelledSubjectlessItems([draft], id => units.get(id))).toBe(1);
  expect(draft.paragraphs[0].text).toBe("- **Dashboard Top Bar Height**: Confirmed at 48px for both desktop and mobile views.\n- Rows are clickable.");
  expect(draft.body).toContain(draft.paragraphs[0].text);
});

it("drops a paragraph that says nearly nothing its units say", () => {
  const units = new Map([["c", { id: "c", statement: "Select useful student-friendly categories and verify category management.", details: [], evidence: { quote: "Select useful student-friendly categories." } } as unknown as WikiKnowledgeUnit]]);
  const junk = "External feedback suggests supporting multiple currencies from the start, while transaction data must never be sent to any server in v1. Proposed positioning describes a web app helping college students track spending, which aligns with the MVP test plan.";
  const kept = "Students pick categories from a short list. Category management lets them rename or archive a category.";
  const draft = chapter([[kept, ["c"]], [junk, ["c"]]]);
  expect(droppedUnrelatedParagraphs([draft], id => units.get(id))).toBe(1);
  expect(draft.paragraphs.map(paragraph => paragraph.text)).toEqual([kept]);
  expect(draft.body).not.toContain("External feedback");
});

it("keeps a subject where the local rules put it when placing by content", () => {
  const subject = (name: string): WikiSubject => ({ id: name, name, aliases: [], unitIds: [] });
  const titles = ["Product Positioning", "User Experience", "Technical Architecture", "Development Roadmap", "Market Context"];
  expect(contentMoveAllowed(subject("Product Positioning"), "Product Positioning", "Development Roadmap", titles)).toBe(false);
  expect(contentMoveAllowed(subject("Persistence Architecture"), "Technical Architecture", "Market Context", titles)).toBe(false);
  expect(contentMoveAllowed(subject("Persistence Architecture"), "Market Context", "Technical Architecture", titles)).toBe(true);
  expect(contentMoveAllowed(subject("UI Specification"), "User Experience", "Development Roadmap", titles)).toBe(false);
  expect(contentMoveAllowed(subject("Value Proposition"), "Development Roadmap", "Market Context", titles)).toBe(false);
  expect(contentMoveAllowed(subject("Risk Mitigation"), "Development Roadmap", "Market Context", titles)).toBe(true);
});

it("reads User Experience as the interface chapter and moves technical subjects out of any chapter", () => {
  const subject = (id: string, name: string): [string, WikiSubject] => [id, { id, name, aliases: [], unitIds: [id] }];
  const subjects = new Map([subject("ui", "UI Specification"), subject("stack", "Tech Stack"), subject("db", "Persistence Architecture"), subject("feedback", "External Feedback"), subject("model", "Data Model")]);
  const pages = [
    { title: "User Experience", group: "", question: "", sectionIds: ["ui", "stack"], subtopics: [{ title: "Interface Design", question: "", sectionIds: ["ui", "stack"] }] },
    { title: "Technical Architecture", group: "", question: "", sectionIds: ["model"], subtopics: [{ title: "Data Models", question: "", sectionIds: ["model"] }] },
    { title: "Market Context", group: "", question: "", sectionIds: ["feedback", "db"], subtopics: [{ title: "External Feedback", question: "", sectionIds: ["feedback", "db"] }] },
  ];
  moveTechnicalSubjects(pages, subjects, {});
  moveInterfaceSubjects(pages, subjects, {}, 4);
  expect(pages[0].sectionIds).toEqual(["ui"]);
  expect(pages[1].subtopics[0].sectionIds).toEqual(expect.arrayContaining(["model", "db", "stack"]));
  expect(pages[2].subtopics[0].sectionIds).toEqual(["feedback"]);
});

it("reads an opening telling a decision among much else as no statement of it, so the decision keeps a marked line", () => {
  const make = (id: string, statement: string): WikiKnowledgeUnit => ({ id, subject: "V1 Scope", facet: "", statement, kind: "decision", details: [], evidence: { quote: statement, role: "user" }, adoption: { status: "user_decision" } } as unknown as WikiKnowledgeUnit);
  const bank = make("bank", "Bank syncing and receipt OCR are excluded from v1 scope.");
  const opening = "Pocket Ledger's v1 is a web-only application focused on core budgeting features, with bank syncing, receipt OCR, and shared budgets explicitly excluded from the scope.";
  expect(openingSentenceMarks(opening, bank, [])).toBe(false);
  expect(openingSentenceMarks("Bank syncing and receipt OCR are excluded from the v1 scope.", bank, [])).toBe(true);
});

const pocketUnit = (id: string, subject: string, statement: string, status = "proposal"): WikiKnowledgeUnit => ({ id, subject, statement, kind: "plan", details: [], evidence: { quote: statement, role: status === "user_decision" ? "user" : "assistant" }, adoption: { status } } as unknown as WikiKnowledgeUnit);

it("reads a claim as supported when only punctuation sets its words apart", () => {
  const unit = pocketUnit("mvp", "MVP Validation", "Test the MVP with 10–15 college students for a week, checking if they understand the dashboard without explanation.");
  expect(claimSupported("Validation of the MVP involves testing with 10–15 college students for one week.", [unit])).toBe(true);
});

it("names a subject for what it holds, leaving its units where they are", () => {
  const units = [
    pocketUnit("form", "Screen Structure - Add/Edit Transaction", "Form includes amount, category, date, and optional description."),
    pocketUnit("bar", "UI Behavior", "The dashboard top bar height is 48px."), pocketUnit("radius", "Global Corner Radius", "Global corner radius is 8px."),
    pocketUnit("row", "Global Corner Radius Standard", "Cards keep the global radius."), pocketUnit("palette", "Color Palette", "Warm off-whites and muted greens."),
    pocketUnit("accent", "Color Application Rules", "The accent marks income."),
    pocketUnit("backup", "Backup Workflow Status", "A fuller backup/restore workflow is a recommendation, not a confirmed V1 requirement."),
  ];
  const subjects: WikiSubject[] = [
    { id: "s1", name: "Data Persistence Limitations", aliases: ["Screen Structure - Add/Edit Transaction"], unitIds: ["form"] },
    { id: "s2", name: "UI Specification", aliases: [], unitIds: ["bar", "radius", "row", "palette", "accent", "backup"] },
  ];
  const report: Record<string, number> = {};
  namedForContent(subjects, new Map(units.map(unit => [unit.id, unit])), report);
  expect(subjects[0].name).toBe("Screen Structure - Add/Edit Transaction");
  expect(subjects[1].unitIds).toContain("backup");
  expect(report).toEqual({ subjects_renamed: 1 });
});

it("drops a prose paragraph citing nothing and trims a decided claim to the sentences its decision says", () => {
  const stack = pocketUnit("stack", "Tech Stack", "The frontend stack is React + Vite + TypeScript.", "user_decision");
  const first = "The frontend stack is confirmed as React + Vite + TypeScript, operating as a web-only application.";
  const text = `${first} A proposed responsive web layout aligns with this stack to prioritize mobile-browser usability.`;
  const aside = "This market shift highlights the volatility of third-party financial aggregators.";
  const draft = chapter([[text, ["stack"]], [aside, []]]);
  draft.paragraphs[0].claims = [{ text, unitIds: ["stack"] }];
  expect(droppedUncitedParagraphs([draft])).toBe(1);
  expect(draft.body).not.toContain(aside);
  expect(trimmedDecidedClaims([draft], id => id === "stack" ? stack : undefined, () => true)).toBe(1);
  expect(draft.paragraphs[0].claims![0].text).toBe(first);
});

it("sets no unit apart in a subject of unlike topics", () => {
  const units = ["Dashboard Top Bar Height", "Global Corner Radius", "Transaction Row Layout", "Color Palette", "Backup Workflow Status"].map((topic, index) => pocketUnit(`u${index}`, topic, `${topic} point.`));
  const subjects: WikiSubject[] = [{ id: "s", name: "UI Specification", aliases: [], unitIds: units.map(unit => unit.id) }];
  namedForContent(subjects, new Map(units.map(unit => [unit.id, unit])), {});
  expect(subjects).toHaveLength(1);
});

it("names the platform the user confirmed where an opening calls the product a mobile app", () => {
  const draft = chapter([["The application targets college students.", ["a"]]]);
  draft.body = `Pocket Ledger is a mobile application designed for college students.\n\n${draft.body}`;
  const web = pocketUnit("web", "Platform", "v1 is web only, with no native mobile app.", "user_decision");
  expect(webPlatformKept([draft], [web])).toBe(1);
  expect(draft.body).toContain("Pocket Ledger is a web application designed for college students.");
  expect(webPlatformKept([chapter([["Pocket Ledger is a mobile app.", ["a"]]])], [])).toBe(0);
});

it("drops a one-sentence aside on what something means", () => {
  const aside = "This mechanism narrows the previously recommended but unconfirmed dependency status into a specific implementation strategy for reactive UI updates.";
  const draft = chapter([["Use useLiveQuery() to update components.", ["u"]], [aside, ["u"]]]);
  expect(droppedEnglishAsides([draft])).toBe(1);
  expect(draft.body).not.toContain(aside);
});

it("drops a clause a later sentence of its item says in full from the same unit", () => {
  const text = "3. **Milestone 3**: Private alpha targets expense entry under 10 seconds, ≥90% successful first entries, Milestone 3 is complete when there are no known critical data-loss bugs, and all CSV test cases passing. Complete when there are no known critical data-loss bugs, primary workflows function on supported browsers.";
  const draft = chapter([[text, ["m"]]]);
  draft.paragraphs[0].claims = [{ text: "Milestone 3 is complete when there are no known critical data-loss bugs", unitIds: ["m3"] }, { text: "Complete when there are no known critical data-loss bugs, primary workflows function on supported browsers.", unitIds: ["m3"] }];
  expect(droppedInnerRepeats([draft])).toBe(1);
  expect(draft.paragraphs[0].text).toContain("≥90% successful first entries, and all CSV test cases passing.");
  expect(draft.body).not.toContain(", Milestone 3 is complete");
});

it("narrows a decided claim to the sentence stating the decision", () => {
  const bank = pocketUnit("bank", "Exclusions", "Bank syncing and receipt OCR are excluded from v1 scope.", "user_decision");
  const second = "Specifically, Bank syncing, Receipt OCR, and Shared budgets are confirmed exclusions.";
  const text = `Bank connections, AI financial advisors, receipt scanning, social challenges, complex financial reports, and shared budgets are excluded from v1. ${second}`;
  const draft = chapter([[text, ["bank"]]]);
  draft.paragraphs[0].claims = [{ text, unitIds: ["bank"] }];
  expect(trimmedDecidedClaims([draft], () => bank, () => true)).toBe(1);
  expect(draft.paragraphs[0].claims![0].text).toBe(second);
});

it("labels a subjectless item by what its statement names, over a label naming only the topic", () => {
  expect(statementSubject("The dashboard top bar height is confirmed as 48px for both desktop and mobile.")).toBe("Dashboard top bar height");
  const line = "- **UI specification**: **Confirmed as 48px for both desktop and mobile interfaces.**";
  const draft = chapter([[line, ["bar"]]]);
  draft.paragraphs[0].claims = [{ text: "Confirmed as 48px for both desktop and mobile interfaces.", unitIds: ["bar"] }];
  const bar = pocketUnit("bar", "UI Specification", "The dashboard top bar height is confirmed as 48px for both desktop and mobile.", "user_decision");
  expect(labelledSubjectlessItems([draft], () => bar)).toBe(1);
  expect(draft.paragraphs[0].text).toBe("- **Dashboard top bar height**: **Confirmed as 48px for both desktop and mobile interfaces.**");
});

it("drops a short paragraph another chapter's subtopic says across its items", () => {
  const ui: WikiDraftChapter = { id: "ux", title: "User Experience", question: "", group: "", body: "", problems: [], paragraphs: [
    { subtopic: "UI Specification", text: "- **Dashboard top bar height**: Confirmed as 48px for both desktop and mobile.\n- Standard UI components use a global corner radius of 8px.", unitIds: ["bar", "radius"], claims: [] },
    { subtopic: "UI Specification", text: "The dashboard top bar is 48px tall on every screen.", unitIds: ["bar"], claims: [] },
  ] } as unknown as WikiDraftChapter;
  ui.body = `### UI Specification\n\n${ui.paragraphs.map(item => item.text).join("\n\n")}`;
  const repeat = "**Dashboard top bar is 48px tall**; global corner radius is 8px.";
  const roadmap = chapter([["Milestones run for seven weeks.", ["m"]], [repeat, ["rr"]]]);
  expect(droppedRepeatedParagraphs([roadmap, ui])).toBe(1);
  expect(roadmap.body).not.toContain(repeat);
});

it("drops a sentence your own words in the paragraph say, keeping yours and one that adds a point", () => {
  const ai = "IndexedDB is not a permanent backup guarantee. Consequently, reliable export mechanisms are critical to prevent data loss if browser storage is cleared.";
  const yours = "Export and backup features are critical because browser storage can be cleared, leading to data loss.";
  const persistence = chapter([[`${ai} ${yours}`, ["ai", "you"]]]);
  persistence.paragraphs[0].claims = [{ text: ai, unitIds: ["ai"] }, { text: yours, unitIds: ["you"] }] as WikiDraftChapter["paragraphs"][number]["claims"];
  const status = chapter([["Budget tracking and category management are not yet verified. Delete, category management, and budget tracking are unverified.", ["s"]]]);
  const weight = (ids: string[]) => ids.includes("you") ? 1 : 0;
  expect(droppedRepeatedSentences([persistence, status], weight)).toBe(1);
  expect(persistence.paragraphs[0].text).toBe(`IndexedDB is not a permanent backup guarantee. ${yours}`);
  expect(persistence.paragraphs[0].claims?.map(claim => claim.text)).toEqual(["IndexedDB is not a permanent backup guarantee.", yours]);
  expect(status.paragraphs[0].text).toContain("Delete");
});

it("drops a short paragraph its chapter's opening already tells", () => {
  const repeat = "The application is designed specifically for college students. The proposed value proposition is 'Know what you can spend.'";
  const positioning = chapter([[repeat, ["a"]], ["Students track spending against a budget.", ["b"]]]);
  positioning.body = positioning.body.replace("Opening.", "Pocket Ledger is a web application designed specifically for college students; its proposed value proposition is 'Know what you can spend.'");
  expect(droppedOpeningRepeats([positioning])).toBe(1);
  expect(positioning.body).not.toContain(repeat);
  expect(positioning.openingUnitIds).toContain("a");
});

it("reads quoted feedback in a short message as material and a choice left open in the user's words as open", () => {
  const said = (id: string, statement: string, quote: string, kind = "plan"): WikiKnowledgeUnit => ({ id, subject: "s", statement, kind, details: [], evidence: { quote, role: "user", pasted: false }, adoption: { status: "unknown" } } as unknown as WikiKnowledgeUnit);
  const feedback = said("f", "External feedback suggests supporting multiple currencies from day one.", "Here is feedback a friend pasted from their review, what do you think?\n> \"The app should support multiple currencies from day one, and sync across devices through a cloud account.\"", "question");
  const cadence = said("c", "The choice between monthly budgets and per-pay-period budgets remains explicitly undecided.", "I can't decide whether budgets should be monthly or per pay period. What are the tradeoffs? Let's leave it open for now.");
  const own = said("o", "Adding and editing transactions are built.", "I've built adding/editing transactions. What do you think of the chart?");
  const statuses = wikiUnitStatuses([feedback, cadence, own], { relations: [] });
  expect([statuses.get("f"), statuses.get("c"), statuses.get("o")]).toEqual(["relayed", "open", "stated"]);
  expect(wikiShownHolder(wikiHolderOf(["relayed"])!, feedback.statement)).toBe("material");
});

it("counts privacy and analytics names as technical, so such a subject leaves the external chapter", () => {
  const misnamed: WikiSubject = { id: "x", name: "External Feedback", aliases: ["Data Privacy & Analytics", "Transaction Storage", "Data Transmission Restrictions", "Multi-currency Support"], unitIds: ["x"] };
  expect(technicalSubject(misnamed)).toBe(true);
  expect(technicalSubject({ ...misnamed, aliases: ["Multi-currency Support", "Cloud Synchronization"] })).toBe(false);
});

it("drops a closing sentence that only points back and gives a purpose", () => {
  const text = "Earlier proposals suggested larger radii (16px cards, 24px dialogs), but these were replaced by the current 8px standard. The application must maintain these dimensions to ensure visual consistency.";
  const ui = chapter([[text, ["h"]], ["Rows use a 150ms hover transition.", ["r"]]]);
  ui.paragraphs[0].claims = [{ text, unitIds: ["h"] }] as WikiDraftChapter["paragraphs"][number]["claims"];
  expect(droppedEnglishAsides([ui])).toBe(1);
  expect(ui.paragraphs[0].text).toBe("Earlier proposals suggested larger radii (16px cards, 24px dialogs), but these were replaced by the current 8px standard.");
  expect(ui.body).not.toContain("visual consistency");
  expect(ui.paragraphs[0].claims?.[0].text).toBe(ui.paragraphs[0].text);
});

it("moves a unit to the subject its own topic names, within its chapter and by whole words", () => {
  const units = new Map([["csv", pocketUnit("csv", "Roadmap Revision", "CSV export is moved from Milestone 1 to Milestone 2.")], ["m1", pocketUnit("m1", "Milestone 1 Scope", "Milestone 1 covers persistence.")], ["bank", pocketUnit("bank", "Bank Sync", "Bank syncing is excluded.")]]);
  const exclusions: WikiSubject = { id: "ex", name: "V1 Exclusions", aliases: ["Roadmap Revision", "Bank Sync"], unitIds: ["csv", "bank"] };
  const roadmap: WikiSubject = { id: "rm", name: "Roadmap", aliases: [], unitIds: ["m1"] }, scope: WikiSubject = { id: "sc", name: "V1 Scope", aliases: [], unitIds: [] };
  const report: Record<string, number> = {};
  movedTopicUnits([exclusions, roadmap, scope], units, [{ subtopics: [{ subjectIds: ["ex", "sc"] }, { subjectIds: ["rm"] }] }], report);
  expect([exclusions.unitIds, roadmap.unitIds, scope.unitIds]).toEqual([["bank"], ["m1", "csv"], []]);
  expect(report.topic_units_moved).toBe(1);
});

it("lists one baseline item once when a second says it in other words", () => {
  const said = (id: string, statement: string, role: "user" | "assistant"): WikiKnowledgeUnit => ({ id, subject: "Roadmap", statement, kind: "plan", details: [], evidence: { quote: statement, role, messageIndex: id === "you" ? 2 : 1, conversationId: "c" }, adoption: { status: "unknown" } } as unknown as WikiKnowledgeUnit);
  const units = [said("you", "Milestone 2 includes CSV export alongside remaining core features.", "user"), said("ai", "Reliable CSV export is assigned to Milestone 2.", "assistant")];
  const items = currentBaseline(units, new Map([["you", "stated"], ["ai", "proposal"]]));
  expect(items.filter(item => /CSV/u.test(item.text))).toHaveLength(1);
});

it("drops a decision told in part when the chapter tells it whole, keeping the paragraph break", () => {
  const part = "Transaction data must never be sent to any server in v1.";
  const whole = "Transaction data must never be sent to any server in v1; analytics may collect only anonymous page views.";
  const text = `Persistence runs entirely in the browser. ${part}\n\nDexie and IndexedDB are the settled persistence architecture.`;
  const persistence = chapter([[text, ["p", "d"]], [whole, ["d"]]]);
  persistence.paragraphs[0].claims = [{ text: part, unitIds: ["d"] }, { text: "Persistence runs entirely in the browser.", unitIds: ["p"] }] as WikiDraftChapter["paragraphs"][number]["claims"];
  persistence.paragraphs[1].claims = [{ text: whole, unitIds: ["d"] }] as WikiDraftChapter["paragraphs"][number]["claims"];
  expect(droppedContainedDecisions([persistence], ids => ids.includes("d") ? 2 : 0)).toBe(1);
  expect(persistence.paragraphs[0].text).toBe("Persistence runs entirely in the browser.\n\nDexie and IndexedDB are the settled persistence architecture.");
  expect(persistence.paragraphs[1].text).toBe(whole);
});

it("moves a condition put inside a list into the later sentence opening as it does", () => {
  const clause = "Milestone 3 is complete when there are no known critical data-loss bugs";
  const later = "Complete when primary workflows function and testers can use the app independently.";
  const text = `Targets include entry under 10 seconds, ≥90% successful first entries, ${clause}, and all CSV test cases passing. ${later}`;
  const roadmap = chapter([[text, ["m3"]]]);
  roadmap.paragraphs[0].claims = [{ text: clause, unitIds: ["m3"] }, { text: later, unitIds: ["m3"] }] as WikiDraftChapter["paragraphs"][number]["claims"];
  expect(droppedInnerRepeats([roadmap])).toBe(1);
  expect(roadmap.paragraphs[0].text).toBe("Targets include entry under 10 seconds, ≥90% successful first entries, and all CSV test cases passing. Complete when there are no known critical data-loss bugs, primary workflows function and testers can use the app independently.");
});

it("keeps your wording of a baseline item and leaves out a plan a later one replaced", () => {
  const said = (id: string, statement: string, role: "user" | "assistant", at: number): WikiKnowledgeUnit => ({ id, subject: "Roadmap", statement, kind: "plan", details: [], evidence: { quote: statement, role, messageIndex: at, conversationId: "c" }, adoption: { status: "unknown" } } as unknown as WikiKnowledgeUnit);
  const units = [said("old", "Milestone 2 completes the student experience by polishing mobile entry.", "assistant", 1), said("you", "Milestone 2 includes CSV export alongside remaining core features.", "user", 2), said("ai", "Reliable CSV export is assigned to Milestone 2.", "assistant", 3)];
  const items = currentBaseline(units, new Map([["old", "proposal"], ["you", "stated"], ["ai", "proposal"]]), new Map(), [], new Set(["old"]));
  expect(items.map(item => [item.text, item.holder])).toEqual([["Milestone 2 includes CSV export alongside remaining core features.", "user"]]);
});

it("joins a second list of the same labelled items to the first", () => {
  const first = "1. **Milestone 1**: Focuses on data reliability.\n2. **Milestone 2**: Completes core features.\n3. **Milestone 3**: Private alpha.";
  const second = "1. **Milestone 1**: Complete when expenses can be exported.\n2. **Milestone 2**: Complete when a new user can set a budget.";
  const roadmap = chapter([[first, ["a"]], ["Progress is reported.", ["p"]], [second, ["b"]]]);
  roadmap.paragraphs[2].claims = [{ text: "Complete when expenses can be exported.", unitIds: ["b"] }] as WikiDraftChapter["paragraphs"][number]["claims"];
  expect(mergedLabelledLists([roadmap])).toBe(1);
  expect(roadmap.paragraphs.map(paragraph => paragraph.text)).toEqual(["1. **Milestone 1**: Focuses on data reliability. Complete when expenses can be exported.\n2. **Milestone 2**: Completes core features. Complete when a new user can set a budget.\n3. **Milestone 3**: Private alpha.", "Progress is reported."]);
  expect(roadmap.paragraphs[0].unitIds).toEqual(["a", "b"]);
  expect(roadmap.body).not.toContain(second);
});

it("drops a sentence that only says a decision of its chapter is settled", () => {
  const decision = "Local data persistence uses IndexedDB via Dexie; localStorage is prohibited.";
  const echo = "Dexie and IndexedDB are the settled persistence architecture for Pocket Ledger.";
  const kept = "IndexedDB is not a permanent backup guarantee.";
  const persistence = chapter([[decision, ["d"]], [`${echo} ${kept}`, ["u", "k"]]]);
  persistence.paragraphs[0].claims = [{ text: decision, unitIds: ["d"] }] as WikiDraftChapter["paragraphs"][number]["claims"];
  persistence.paragraphs[1].claims = [{ text: echo, unitIds: ["u"] }, { text: kept, unitIds: ["k"] }] as WikiDraftChapter["paragraphs"][number]["claims"];
  expect(droppedDecisionEchoes([persistence], ids => ids.includes("d") ? 2 : ids.includes("u") ? 1 : 0, "Pocket Ledger")).toBe(1);
  expect(persistence.paragraphs[1].text).toBe(kept);
});

it("rereads claim problems against the final text: a claim a blank line cut and a sentence its units state together", () => {
  const usd = "Pocket Ledger v1 supports USD only.", feedback = "External feedback asks for more currencies.";
  const alpha = "**Milestone 3**: Private alpha validates with 10–15 college students.";
  const units = new Map([["usd", pocketUnit("usd", "Currency", usd, "user_decision")], ["m3", pocketUnit("m3", "Milestone 3", "Milestone 3 runs a private alpha.")], ["v", pocketUnit("v", "Validation", "Validate with 10–15 college students.")]]);
  const scope = chapter([[`${usd}\n\n${feedback}`, ["usd"]], [`3. ${alpha}`, ["m3", "v"]]]);
  scope.paragraphs[0].claims = [{ text: `${usd} ${feedback}`, unitIds: ["usd"] }] as WikiDraftChapter["paragraphs"][number]["claims"];
  scope.problems = [`claim "${`${usd} ${feedback}`.slice(0, 36)}…" not in the paragraph`, `" **Milestone 3**：Private…" has no claim naming the units it states; add a claim for each decided, done, figure or change sentence`];
  expect(refreshedClaimProblems([scope], units)).toBe(2);
  expect(scope.problems).toEqual([]);
  expect(scope.paragraphs[0].claims?.map(claim => claim.text)).toEqual([usd, feedback]);
  expect(scope.paragraphs[1].claims?.[0]).toMatchObject({ text: alpha });
});

const csvQuestion: WikiWritingQuestion = { id: "ask:1:1", about: "CSV", ask: "Is CSV export in Milestone 1 or Milestone 2?", unitIds: ["plan", "move"], organization: 1, options: [
  { id: "o1", label: "Milestone 1 includes CSV export", actions: [{ do: "confirm", units: ["plan"] }, { do: "reject", units: ["move"] }] },
  { id: "o2", label: "CSV export is in Milestone 2", actions: [{ do: "confirm", units: ["move"] }, { do: "reject", units: ["plan"] }] }] };
const feedbackQuestion: WikiWritingQuestion = { id: "ask:1:2", about: "Feedback", ask: "Include the outside suggestions?", unitIds: ["sync"], organization: 1, options: [
  { id: "o1", label: "Exclude from current project scope", actions: [{ do: "owner", units: ["sync"], name: "Pocket Ledger", answer: "exclude" }] },
  { id: "o2", label: "Include as future considerations", actions: [{ do: "owner", units: ["sync"], name: "Pocket Ledger", answer: "reference" }] }] };
const statements: Record<string, string> = { plan: "Milestone 2 includes CSV export alongside remaining core features.", move: "CSV export is moved from Milestone 1 to Milestone 2.", sync: "External feedback suggests syncing across devices." };

it("drops a question answer naming another stage than the point it confirms, and the question left with one answer", () => {
  expect(labelContradicts("Milestone 1 includes CSV export", statements.plan)).toBe(true);
  expect(labelContradicts("CSV export is in Milestone 2", statements.move)).toBe(false);
  expect(labelContradicts("Global radius is 8px", "Standard UI components use a global corner radius of 8px.")).toBe(false);
  expect(labelContradicts("M1 includes CSV", "Milestone 2 includes CSV export.")).toBe(true);
  expect(soundQuestion(csvQuestion, id => statements[id])).toBeUndefined();
});

it("never takes the project itself as another project's owner", () => {
  const sound = soundQuestion(feedbackQuestion, id => statements[id], "Pocket Ledger")!;
  expect(sound.options.map(option => option.actions)).toEqual([[], []]);
  const ledger = { organization: { projectName: "Pocket Ledger" }, scopeAnswers: { pocketledger: "exclude", mint: "reference" }, userOwners: { sync: "Pocket Ledger", other: "Mint" } } as unknown as WikiKnowledgeLedger;
  const cleaned = withoutOwnProjectAnswers(ledger);
  expect([cleaned.scopeAnswers, cleaned.userOwners]).toEqual([{ mint: "reference" }, { other: "Mint" }]);
});

it("withdraws an answer the question should not have offered, and the decisions it made unless changed since", () => {
  const units = Object.entries(statements).map(([id, statement]) => ({ id, statement }));
  const ledger = { batches: [{ units }], organization: { projectName: "Pocket Ledger" }, writingQuestions: [csvQuestion, feedbackQuestion],
    decisions: { plan: { verdict: "confirmed", at: 5 }, move: { verdict: "rejected", at: 5 }, other: { verdict: "confirmed", at: 5 } },
    userAnswers: [{ questionId: csvQuestion.id, unitIds: [], question: "", answer: "Milestone 1 includes CSV export", optionId: "o1", at: 5 }, { questionId: feedbackQuestion.id, unitIds: [], question: "", answer: "Exclude from current project scope", optionId: "o1", at: 6 }] } as unknown as WikiKnowledgeLedger;
  const sound = withSoundAnswers(ledger);
  expect(sound.decisions).toEqual({ other: { verdict: "confirmed", at: 5 } });
  expect(sound.userAnswers?.map(answer => answer.answer)).toEqual(["Exclude from current project scope"]);
  expect(sound.writingQuestions?.map(question => question.id)).toEqual([feedbackQuestion.id]);
});

it("labels a value item from the decision kept below it, and drops that repeat", () => {
  expect(valueLabel("Standard UI components use a global corner radius of 8px.", "8px")).toBe("Global corner radius");
  expect(valueLabel("The global standard corner radius is confirmed at 8px.", "8px")).toBe("Corner radius");
  const list = "- **Dashboard top bar height**: 48px.\n- Global standard is 8px; earlier proposals of 16px/24px were replaced.";
  const decision = "Standard UI components use a global corner radius of 8px.";
  const draft = chapter([[list, ["bar", "radius", "old"]], ["*Table from the discussion*\n\n| Token | Radius |\n|---|---|\n| sm | 8px |", ["old"]], [decision, ["radius"]]]);
  draft.paragraphs[0].claims = [{ text: "48px.", unitIds: ["bar"] }, { text: "Global standard is 8px; earlier proposals of 16px/24px were replaced.", unitIds: ["radius", "old"] }];
  draft.paragraphs[2].claims = [{ text: decision, unitIds: ["radius"] }];
  expect(foldedValueDecisions([draft], ids => ids.every(id => id !== "old") ? 2 : 1)).toBe(1);
  expect(draft.paragraphs).toHaveLength(2);
  expect(draft.paragraphs[0].text).toContain("- **Global corner radius**: Global standard is 8px;");
  expect(draft.body).not.toContain(decision);
  expect(draft.body).toContain("**Global corner radius**");
});

it("joins a sentence adding a few words to another's lead into that lead", () => {
  const listed = "The roadmap consists of four milestones: M1 Data reliability (Week 1), and M4 Public beta launch (Weeks 6–7).", extra = "The roadmap consists of four milestones leading to a public beta.";
  const draft = chapter([[`${listed} ${extra}`, ["ai", "you"]]]);
  draft.paragraphs[0].claims = [{ text: listed, unitIds: ["ai"] }, { text: extra, unitIds: ["you"] }];
  expect(joinedLeadRepeats([draft])).toBe(1);
  expect(draft.paragraphs[0].text).toBe("The roadmap consists of four milestones leading to a public beta: M1 Data reliability (Week 1), and M4 Public beta launch (Weeks 6–7).");
  expect(draft.paragraphs[0].claims?.map(claim => claim.text)).toEqual(["M1 Data reliability (Week 1), and M4 Public beta launch (Weeks 6–7).", "The roadmap consists of four milestones leading to a public beta"]);
  expect(draft.body).toContain(draft.paragraphs[0].text);
});

it("lists one baseline item for one stage, in the user's words", () => {
  const said = (id: string, statement: string, role: "user" | "assistant", index: number): WikiKnowledgeUnit => ({ id, subject: "Roadmap", statement, kind: "plan", details: [], evidence: { quote: statement, role, messageIndex: index, conversationId: "c" }, adoption: { status: "unknown" } } as unknown as WikiKnowledgeUnit);
  const units = [said("you", "Milestone 1 focuses exclusively on data reliability.", "user", 1), said("ai", "Revised Milestone 1 covers Dexie persistence and chart correctness only.", "assistant", 2)];
  const items = currentBaseline(units, new Map([["you", "stated"], ["ai", "proposal"]]));
  expect(items.filter(item => /Milestone 1/u.test(item.text)).map(item => [item.text, item.holder])).toEqual([["Milestone 1 focuses exclusively on data reliability.", "user"]]);
});

it("reads zero as a negation kept, so the source sentence is not restored into a list of targets", () => {
  const targets = "Private alpha testing targets entry under 10 seconds, ≥90% successful first entries, zero known critical data-loss bugs, and all CSV test cases passing.";
  const source = "Milestone 3 is complete when there are no known critical data-loss bugs, primary workflows function on supported browsers, and testers can use the app independently.";
  expect(lostNegation(targets, [source])).toBeUndefined();
  expect(lostNegation(targets.replace("zero", "few"), [source])).toBeDefined();
});

it("clears a no-source problem once a later pass cited the claim's other unit", () => {
  const left = pocketUnit("left", "UI", "Left side displays category icon and description; right side shows amount aligned right.");
  const row = pocketUnit("row", "UI", "Entire row is clickable to open details or editing, with hover background transition of 150ms ease.");
  const text = "Rows display category icons and descriptions on the left, with amounts aligned right; entire rows are clickable with a 150ms hover transition.";
  const draft = chapter([[`- **Layout**: ${text}`, ["left", "row"]]]);
  draft.paragraphs[0].claims = [{ text, unitIds: ["left", "row"] }];
  draft.problems = [`claim "${text.slice(0, 36)}…" has no supported source after final formatting`];
  expect(refreshedClaimProblems([draft], new Map([["left", left], ["row", row]]))).toBe(1);
  expect(draft.problems).toEqual([]);
});

it("puts back a statement whose tail ends a sentence reworded around its subject", () => {
  const unit = pocketUnit("backup", "Storage", "A fuller backup/restore workflow is a recommendation, not a confirmed V1 requirement.");
  const text = "Mobile browser usability matters. Additionally, while a fuller backup/restore workflow was suggested, not a confirmed V1 requirement.";
  const draft = chapter([[text, ["backup"]]]);
  draft.paragraphs[0].claims = [{ text: "not a confirmed V1 requirement.", unitIds: ["backup"] }];
  expect(restoredFragments([draft], id => id === "backup" ? unit : undefined)).toBe(1);
  expect(draft.paragraphs[0].text).toBe(`Mobile browser usability matters. ${unit.statement}`);
  expect(draft.paragraphs[0].claims?.[0].text).toBe(unit.statement);
});

it("lists an item moved to a stage once beside the user's line on that stage", () => {
  const said = (id: string, statement: string, role: "user" | "assistant", index: number): WikiKnowledgeUnit => ({ id, subject: "Roadmap", statement, kind: "plan", details: [], evidence: { quote: statement, role, messageIndex: index, conversationId: "c" }, adoption: { status: "unknown" } } as unknown as WikiKnowledgeUnit);
  const units = [said("you", "Milestone 2 includes CSV export alongside remaining core features.", "user", 1), said("ai", "CSV export implementation/fix is moved from Milestone 1 to Milestone 2.", "assistant", 2)];
  const items = currentBaseline(units, new Map([["you", "stated"], ["ai", "proposal"]]));
  expect(items.filter(item => /CSV/u.test(item.text)).map(item => [item.text, item.holder])).toEqual([["Milestone 2 includes CSV export alongside remaining core features.", "user"]]);
});

it("marks each decided list item when the opening says one of them again", () => {
  const text = "The top bar is confirmed as 48px for both desktop and mobile. Standard UI components use a global corner radius of 8px.\n\n### UI Specification\n\n- **Top bar**: Confirmed as 48px for both desktop and mobile views.\n- Standard UI components use a global corner radius of 8px.";
  const marked = withHolderMarks(text, [
    { text: "The top bar is confirmed as 48px for both desktop and mobile.", holder: "decided" }, { text: "Standard UI components use a global corner radius of 8px.", holder: "decided" },
    { text: "Confirmed as 48px for both desktop and mobile views.", holder: "decided" }, { text: "Standard UI components use a global corner radius of 8px.", holder: "decided" }], false);
  expect(marked.match(/\[Decided\]/gu)).toHaveLength(4);
  expect(marked).toContain("radius of 8px. [Decided]\n\n### UI");
  expect(marked).toContain("desktop and mobile views. [Decided]\n");
});

it("parts sentences glued at a closing bracket or after a field name before a hyphenated word", () => {
  expect(englishPunctuation("basic insights (spending by category/weekly totals).Useful features include CSV export.")).toBe("basic insights (spending by category/weekly totals). Useful features include CSV export.");
  expect(englishPunctuation("do not use localStorage.Client-only persistence is confirmed.")).toBe("do not use localStorage. Client-only persistence is confirmed.");
  expect(englishPunctuation("Use useLiveQuery() from dexie-react-hooks and App.tsx.")).toBe("Use useLiveQuery() from dexie-react-hooks and App.tsx.");
});

it("keeps Doing now to the earliest numbered stage", () => {
  const said = (id: string, statement: string, role: "user" | "assistant", index: number): WikiKnowledgeUnit => ({ id, subject: "Roadmap", statement, kind: "plan", details: [], evidence: { quote: statement, role, messageIndex: index, conversationId: "c" }, adoption: { status: "unknown" } } as unknown as WikiKnowledgeUnit);
  const units = [said("m1", "Milestone 1 focuses exclusively on data reliability.", "user", 1), said("m2", "Milestone 2 includes CSV export alongside remaining core features.", "user", 2), said("m3", "Milestone 3 involves running a private alpha with 10–15 students.", "assistant", 3)];
  const items = currentBaseline(units, new Map([["m1", "stated"], ["m2", "stated"], ["m3", "proposal"]]));
  expect(items.filter(item => item.part === "now").map(item => item.text)).toEqual(["Milestone 1 focuses exclusively on data reliability."]);
});

it("drops a sentence telling again in other words a decision the opening states", () => {
  const web = pocketUnit("web", "Scope", "v1 is web only, with no native mobile app.", "user_decision");
  const draft = chapter([["Essential features include quick expense entry and budgets.", ["a"]], ["The first version is restricted to the web platform, explicitly excluding any native mobile applications.", ["web"]], ["V1 is Web only; no native iOS or Android apps.", ["ai"]], ["Bank syncing, receipt OCR, AI coaching, and cloud sync are excluded from v1.", ["web"]]]);
  draft.body = draft.body.replace("Opening.", "V1 is a web-only application with no native mobile apps, excluding bank syncing, receipt OCR, and shared budgets.");
  draft.openingUnitIds = ["web"];
  expect(droppedOpeningRepeats([draft], id => id === "web" ? web : undefined, id => id === "web")).toBe(2);
  expect(draft.paragraphs.map(paragraph => paragraph.text)).toEqual(["Essential features include quick expense entry and budgets.", "Bank syncing, receipt OCR, AI coaching, and cloud sync are excluded from v1."]);
});

it("retires a stage's earlier line naming what a later move took out of that stage", () => {
  const said = (id: string, statement: string, index: number): WikiKnowledgeUnit => ({ id, subject: "Roadmap", statement, kind: "plan", details: [], evidence: { quote: statement, role: "assistant", messageIndex: index, conversationId: "c" }, adoption: { status: "proposal" } } as unknown as WikiKnowledgeUnit);
  const units = new Map([
    ["done", said("done", "Milestone 1 is complete when expenses can be added, edited, displayed, and exported without data corruption.", 28)],
    ["focus", said("focus", "Milestone 1 focuses on data reliability via Dexie.", 28)],
    ["two", said("two", "Milestone 2 is complete when a new user can configure a budget.", 28)],
    ["move", said("move", "CSV export implementation/fix is moved from Milestone 1 to Milestone 2.", 30)],
    ["revised", said("revised", "Revised Milestone 1 covers Dexie persistence only, excluding CSV export.", 30)],
  ].map(([id, unit]) => [id as string, unit as WikiKnowledgeUnit]));
  const report: Record<string, number> = {};
  const organization = stageMoveReplacements({ relations: [] } as unknown as WikiKnowledgeOrganization, units, report);
  expect(organization.relations.map(relation => [relation.older, relation.newer, relation.kind, relation.status])).toEqual([["done", "move", "replaces", "resolved"]]);
  expect(report.stage_moves_replaced).toBe(1);
});

it("drops a listing whose items another listing of the same state names, never a decision's", () => {
  const status = "Add transactions and the spending chart are built; Budget tracking and Category management are not yet verified. Delete, category management, and budget tracking are unverified.";
  const list = "- **Initial Out**: Bank connections, AI financial advisors, receipt scanning, and shared budgets are excluded from v1.\n- Bank syncing, Receipt OCR, and Shared budgets are excluded from V1.\n- **AI Coaching**: AI financial coaching is out of scope for V1.";
  const draft = chapter([[status, ["built", "unverified"]], [list, ["out", "ai", "coach"]], ["Bank syncing and receipt OCR are excluded from v1 scope.", ["decided"]]]);
  draft.paragraphs[0].claims = [{ text: "Add transactions and the spending chart are built; Budget tracking and Category management are not yet verified.", unitIds: ["built"] }, { text: "Delete, category management, and budget tracking are unverified.", unitIds: ["unverified"] }];
  draft.paragraphs[1].claims = [{ text: "Bank connections, AI financial advisors, receipt scanning, and shared budgets are excluded from v1.", unitIds: ["out"] }, { text: "Bank syncing, Receipt OCR, and Shared budgets are excluded from V1.", unitIds: ["ai"] }, { text: "AI financial coaching is out of scope for V1.", unitIds: ["coach"] }];
  draft.paragraphs[2].claims = [{ text: "Bank syncing and receipt OCR are excluded from v1 scope.", unitIds: ["decided"] }];
  expect(droppedCoveredListings([draft], ids => ids.includes("decided") ? 2 : 1)).toBe(3);
  expect(draft.paragraphs.map(paragraph => paragraph.text)).toEqual(["Add transactions and the spending chart are built. Delete, category management, and budget tracking are unverified.", "- **Initial Out**: Bank connections, AI financial advisors, receipt scanning, and shared budgets are excluded from v1.", "Bank syncing and receipt OCR are excluded from v1 scope."]);
  expect(draft.paragraphs[0].claims?.map(claim => claim.text)).toEqual(["Add transactions and the spending chart are built.", "Delete, category management, and budget tracking are unverified."]);
  expect(draft.paragraphs[1].claims?.map(claim => claim.unitIds)).toEqual([["out"]]);
});

it("keeps a numbered list item and the items of a comma list when removing clauses the chapter said", () => {
  const texts = ["Milestone 1 focuses exclusively on data reliability, covering Dexie persistence and chart correctness, but excluding CSV export.",
    "1. **Milestone 1**: Data reliability: Focuses exclusively on data reliability, covering Dexie persistence and chart correctness, and exclude CSV export.\n2. **Milestone 2**: Includes remaining core features.",
    "Bank syncing is excluded from the first version entirely.", "V1 is web-only. Bank syncing, receipt OCR, and AI coaching are excluded from the v1 scope."];
  const draft = chapter(texts.map(text => [text, []]));
  chapterRepeatedClauses(draft);
  expect(draft.paragraphs.map(paragraph => paragraph.text)).toEqual(texts);
});

it("parts sentences glued at a period before a version", () => {
  expect(englishPunctuation("Income tracking and CSV export are also included as useful features.V1 is strictly web-only.")).toBe("Income tracking and CSV export are also included as useful features. V1 is strictly web-only.");
});

it("keeps the items of a list the sentence rules out at its end, and restores a negation without its stop", () => {
  const statements = ["V1 is Web only; no native iOS or Android apps."];
  for (const text of ["V1 is strictly web-only; native iOS or Android apps, Bank syncing, receipt OCR, and AI coaching are excluded from the v1/beta scope.",
    "V1 is strictly web-only. Native iOS or Android apps, Bank syncing, and receipt OCR are excluded from the v1 scope.",
    "V1 is strictly web-only, with native iOS or Android apps, bank syncing, and receipt OCR excluded from the v1 scope."]) expect(lostNegation(text, statements)).toBeUndefined();
  expect(lostNegation("V1 ships as a web app. It also offers native iOS or Android apps for students.", statements)).toEqual({ clause: "It also offers native iOS or Android apps for students", source: "no native iOS or Android apps" });
});

it("reads a web-only sentence as telling the web-only decision again", () => {
  expect(statesCore("v1 is web only, with no native mobile app.", "V1 is strictly web-only; native iOS or Android apps, Bank syncing, receipt OCR, and AI coaching are excluded from the v1/beta scope.")).toBe(true);
});

it("drops the AI's status sentence another chapter has in the user's words, keeping the one adding a point", () => {
  const roadmap = "CSV export is required for V1 but is not working yet. Add transactions, Edit transactions, and Monthly spending chart are built. Delete, category management, and budget tracking are unverified.";
  const status = "- **Built**: Adding/editing transactions and the monthly spending chart are built.\n- **Unfinished**: CSV export functionality does not work yet.";
  const first = { id: "a", title: "Scope", question: "", group: "", body: `Opening.\n\n### Roadmap\n\n${roadmap}`, paragraphs: [{ subtopic: "Roadmap", text: roadmap, unitIds: ["ai1", "ai2"], claims: [{ text: "Delete, category management, and budget tracking are unverified.", unitIds: ["ai2"] }] }], problems: [] } as unknown as WikiDraftChapter;
  const second = { id: "b", title: "Tech", question: "", group: "", body: `Opening.\n\n### Status\n\n${status}`, paragraphs: [{ subtopic: "Status", text: status, unitIds: ["u1", "u2"], claims: [{ text: "Adding/editing transactions and the monthly spending chart are built.", unitIds: ["u1"] }, { text: "CSV export functionality does not work yet.", unitIds: ["u2"] }] }], problems: [] } as unknown as WikiDraftChapter;
  expect(droppedEchoedReports([first, second], ids => ids.some(id => id.startsWith("u")) ? 1 : 0)).toBe(1);
  expect(first.paragraphs[0].text).toBe("CSV export is required for V1 but is not working yet. Delete, category management, and budget tracking are unverified.");
  expect(first.body).toContain(first.paragraphs[0].text);
  expect(second.paragraphs[0].text).toBe(status);
});

it("drops a one-sentence paragraph the source table right after it tells", () => {
  const sentence = "Proposed targets for the private alpha include expense entry time under 10 seconds, ≥90% successful first entries, zero known critical data-loss bugs, and all CSV test cases passing.";
  const table = "*Table from the discussion · AI suggestion, not confirmed*\n\n| Metric | Target |\n|---|---|\n| Expense entry time | Under 10 seconds |\n| Successful first expense entry | ≥90% of testers |\n| Data-loss bugs | Zero known critical issues |\n| CSV export correctness | All defined test cases pass |";
  const after = "Cloud sync and multi-currency are possible for V2 but not committed.";
  const draft = { id: "a", title: "Scope", question: "", group: "", body: `Opening.\n\n### Roadmap\n\n${sentence}\n\n${table}\n\n${after}`, paragraphs: [sentence, table, after].map((text, index) => ({ subtopic: "Roadmap", text, unitIds: [`ai${index}`], claims: [] })), problems: [] } as unknown as WikiDraftChapter;
  expect(droppedTableEchoes([draft], () => 0)).toBe(1);
  expect(draft.paragraphs.map(paragraph => paragraph.text)).toEqual([table, after]);
  expect(draft.body).toBe(`Opening.\n\n### Roadmap\n\n${table}\n\n${after}`);
  const kept = { ...draft, body: `Opening.\n\n### Roadmap\n\n${sentence}\n\n${table}`, paragraphs: [sentence, table].map((text, index) => ({ subtopic: "Roadmap", text, unitIds: [`u${index}`], claims: [] })) } as unknown as WikiDraftChapter;
  expect(droppedTableEchoes([kept], ids => ids.includes("u0") ? 1 : 0)).toBe(0);
});

it("marks a claim ending in bold before a semicolon after the bold", () => {
  expect(withHolderMarks("**Local data persistence uses IndexedDB via Dexie**; localStorage is prohibited. All operations run in the browser.", [{ text: "Local data persistence uses IndexedDB via Dexie", holder: "decided" }], false))
    .toBe("**Local data persistence uses IndexedDB via Dexie** [Decided]; localStorage is prohibited. All operations run in the browser.");
});

const ledgerUnit = (id: string, statement: string, role: "user" | "assistant", messageIndex: number, extra: Partial<WikiKnowledgeUnit> = {}): WikiKnowledgeUnit => ({
  id, subject: "Roadmap", statement, kind: "decision", details: [], delivery: "unknown",
  adoption: { status: role === "user" ? "user_decision" : "proposal" },
  evidence: { evidenceId: `e${id}`, conversationId: "c", messageId: `m${messageIndex}`, messageIndex, role, pasted: false, quote: statement },
  ...extra,
}) as WikiKnowledgeUnit;

it("makes a move the user's decision quotes a decision of its own when extraction left it out", () => {
  const quote = "★ Revise the roadmap: move CSV export into milestone 2, and drop the \"shared budgets\" milestone entirely.";
  const drop = ledgerUnit("drop", "Shared budgets are dropped entirely from the roadmap and v1 scope.", "user", 29, { evidence: { evidenceId: "e", conversationId: "c", messageId: "m29", messageIndex: 29, role: "user", pasted: false, quote } });
  const ledger = { batches: [{ sourceIds: [], status: "ok", units: [drop] }], organization: { subjects: [{ id: "s", name: "Roadmap", aliases: [], unitIds: ["drop"] }], relations: [] } } as unknown as WikiKnowledgeLedger;
  const report: Record<string, number> = {};
  const read = withQuotedMoves(ledger, report);
  const added = read.batches[0].units.find(unit => unit.id !== "drop")!;
  expect(added.statement).toBe("CSV export moves to Milestone 2.");
  expect(added.evidence.quote).toBe(quote);
  expect(read.organization!.subjects[0].unitIds).toEqual(["drop", added.id]);
  expect(wikiUnitStatuses(read.batches[0].units, { relations: [] }).get(added.id)).toBe("confirmed");
  expect(report.quoted_moves_added).toBe(1);
  // Told already by a point of the same message: nothing added.
  const told = { ...ledger, batches: [{ sourceIds: [], status: "ok", units: [drop, ledgerUnit("told", "CSV export is moved into Milestone 2.", "user", 29, { evidence: drop.evidence })] }] } as unknown as WikiKnowledgeLedger;
  expect(withQuotedMoves(told)).toBe(told);
});

it("captions an AI table the user's next message limits with that decision", () => {
  const table = "| Milestone | Proposed adjustment |\n|---|---|\n| M1 — Data reliability | Ensure the data model can preserve currency information |\n| M2 — Core completion | Finish CSV export; consider configurable currency |";
  const ai = ledgerUnit("ai", "Cloud account synchronization is deferred to V2 evaluation.", "assistant", 33, { evidence: { evidenceId: "e", conversationId: "c", messageId: "m33", messageIndex: 33, role: "assistant", pasted: false, quote: "x", code: { language: "table", text: table } } });
  const usd = ledgerUnit("usd", "Pocket Ledger v1 supports USD only; multi-currency functionality is explicitly excluded.", "user", 34);
  const later = ledgerUnit("later", "Pocket Ledger v1 supports USD only; multi-currency functionality is explicitly excluded.", "user", 40);
  const place = (units: WikiKnowledgeUnit[]) => {
    const draft = { id: "c", title: "T", question: "", group: "", body: "P.", paragraphs: [{ subtopic: "S", text: "P.", unitIds: ["ai"], claims: [] }], problems: [] } as unknown as WikiDraftChapter;
    const byId = new Map(units.map(unit => [unit.id, unit]));
    placedSourceCode([draft], id => byId.get(id), id => id === "ai" ? "proposal" : "confirmed", false, units);
    return draft.paragraphs[1].text.split("\n")[0];
  };
  expect(place([ai, usd])).toBe("*Table from the discussion · AI suggestion, not confirmed; your later decision takes precedence: Pocket Ledger v1 supports USD only; multi-currency functionality is explicitly excluded.*");
  expect(place([ai, later])).toBe("*Table from the discussion · AI suggestion, not confirmed*");
});

it("moves what earlier versions said to the chapter's end, rows of a table as list lines", () => {
  const table = "| Stage | Completion Criteria |\n| --- | --- |\n| Milestone 1 | Expenses can be exported without data corruption. |\n| Milestone 2 | A new user can configure a budget. |";
  const old = "Earlier specifications proposed default card radius at 16px, but these were replaced by the current 8px global standard.";
  const scale = "*Table from the discussion · earlier version, since replaced*\n\n| Token | Radius |\n|---|---|\n| `radius-lg` | 16px |";
  const now = "Standard UI components use a global corner radius of 8px.";
  const draft = { id: "c", title: "T", question: "", group: "", body: ["Opening.", "### Roadmap", table, "### UI", now, old, scale, "Later point.", "> 3 more related points in the ledger"].join("\n\n"),
    paragraphs: [
      { subtopic: "Roadmap", text: table, unitIds: ["h1", "p2"], claims: [{ text: "Milestone 1", unitIds: ["h1"] }, { text: "Expenses can be exported without data corruption.", unitIds: ["h1"] }, { text: "Milestone 2", unitIds: ["p2"] }, { text: "A new user can configure a budget.", unitIds: ["p2"] }] },
      { subtopic: "UI", text: now, unitIds: ["d"], claims: [{ text: now, unitIds: ["d"] }] },
      { subtopic: "UI", text: old, unitIds: ["h2", "d"], claims: [{ text: old, unitIds: ["h2", "d"] }] },
      { subtopic: "UI", text: scale, unitIds: ["h2"], claims: [] },
      { subtopic: "UI", text: "Later point.", unitIds: ["p3"], claims: [{ text: "Later point.", unitIds: ["p3"] }] },
    ], problems: [] } as unknown as WikiDraftChapter;
  const statuses: Record<string, string> = { h1: "history", h2: "history", p2: "proposal", p3: "proposal", d: "confirmed" };
  expect(earlierVersionsLast([draft], id => statuses[id], false)).toBe(3);
  const row = "- **Milestone 1** · Completion Criteria: Expenses can be exported without data corruption.";
  expect(draft.body).toBe(["Opening.", "### Roadmap", "| Stage | Completion Criteria |\n| --- | --- |\n| Milestone 2 | A new user can configure a budget. |", "### UI", now, "Later point.", "### Earlier versions", row, old, scale, "> 3 more related points in the ledger"].join("\n\n"));
  expect(draft.paragraphs.map(paragraph => paragraph.subtopic)).toEqual(["Roadmap", "UI", "UI", "Earlier versions", "Earlier versions", "Earlier versions"]);
  expect(draft.paragraphs[3].claims?.map(claim => claim.unitIds)).toEqual([["h1"], ["h1"]]);
});

it("drops an item of an exclusion list the paragraph ruled out a sentence before", () => {
  const list = "Bank syncing, receipt OCR, AI coaching, native mobile apps, complex reports, and multi-device cloud synchronization are excluded from v1/beta scope.";
  const text = `The platform is strictly Web only for v1, with no native iOS or Android apps. ${list}`;
  const draft = { id: "c", title: "T", question: "", group: "", body: `Opening.\n\n### V1 Scope\n\n${text}`, paragraphs: [{ subtopic: "V1 Scope", text, unitIds: ["d", "a"], claims: [{ text: "The platform is strictly Web only for v1", unitIds: ["d"] }, { text: list, unitIds: ["a"] }] }], problems: [] } as unknown as WikiDraftChapter;
  expect(droppedRepeatedExclusions([draft])).toBe(1);
  const kept = "Bank syncing, receipt OCR, AI coaching, complex reports, and multi-device cloud synchronization are excluded from v1/beta scope.";
  expect(draft.paragraphs[0].text).toBe(`The platform is strictly Web only for v1, with no native iOS or Android apps. ${kept}`);
  expect(draft.paragraphs[0].claims?.map(claim => claim.text)).toEqual(["The platform is strictly Web only for v1", kept]);
  expect(draft.body).toContain(kept);
});

it("captions an AI table the writer copied into the text as it stands", () => {
  const table = "| Milestone | Proposed adjustment |\n|---|---|\n| M2 — Core completion | Finish CSV export; consider configurable currency |";
  const ai = ledgerUnit("ai", "Cloud account synchronization is deferred to V2 evaluation.", "assistant", 33, { evidence: { evidenceId: "e", conversationId: "c", messageId: "m33", messageIndex: 33, role: "assistant", pasted: false, quote: "x", code: { language: "table", text: table } } });
  const usd = ledgerUnit("usd", "Pocket Ledger v1 supports USD only; multi-currency functionality is explicitly excluded.", "user", 34);
  const draft = { id: "c", title: "T", question: "", group: "", body: `Opening.\n\n${table}`, paragraphs: [{ subtopic: "S", text: "Opening.", unitIds: ["usd"], claims: [] }, { subtopic: "S", text: table, unitIds: ["ai"], claims: [] }], problems: [] } as unknown as WikiDraftChapter;
  const byId = new Map([ai, usd].map(unit => [unit.id, unit]));
  expect(placedSourceCode([draft], id => byId.get(id), id => id === "ai" ? "proposal" : "confirmed", false, [ai, usd])).toBe(1);
  const caption = "*Table from the discussion · AI suggestion, not confirmed; your later decision takes precedence: Pocket Ledger v1 supports USD only; multi-currency functionality is explicitly excluded.*";
  expect(draft.paragraphs).toHaveLength(2);
  expect(draft.paragraphs[1].text).toBe(`${caption}\n\n${table}`);
  expect(draft.body).toBe(`Opening.\n\n${caption}\n\n${table}`);
});

it("reads an answer that confirms only an account of facts as the user's own decision", () => {
  const facts = ledgerUnit("facts", "Monthly budgets are simpler; pay-period budgets match cash flow.", "assistant", 20, { kind: "fact" } as Partial<WikiKnowledgeUnit>);
  const open = ledgerUnit("open", "The choice between monthly and pay-period budgets remains undecided.", "assistant", 21, { kind: "fact" } as Partial<WikiKnowledgeUnit>);
  const question = { id: "q", about: "Budgets", ask: "Which budget period for v1?", unitIds: ["facts", "open"], organization: 0,
    options: [{ id: "o", label: "Implement monthly budgets only for v1", actions: [{ do: "confirm", units: ["facts"] }, { do: "open", units: ["open"] }] }] } as WikiWritingQuestion;
  const ledger = { batches: [{ sourceIds: [], status: "ok", units: [facts, open] }], writingQuestions: [question],
    userAnswers: [{ questionId: "q", optionId: "o", unitIds: ["facts", "open"], question: question.ask, answer: "Implement monthly budgets only for v1", at: 5 }],
    decisions: { facts: { verdict: "confirmed", at: 5 }, open: { verdict: "open", at: 5 } },
    organization: { subjects: [{ id: "s", name: "Roadmap", aliases: [], unitIds: ["facts", "open"] }], relations: [] } } as unknown as WikiKnowledgeLedger;
  const read = withAnsweredChoices(ledger);
  const added = read.batches[0].units.find(unit => unit.id.startsWith("answer:"))!;
  expect(added.statement).toBe("Implement monthly budgets only for v1.");
  expect(added.kind).toBe("decision");
  // Quoted from the message it was said in, so checking claims against the originals keeps it.
  expect(added.evidence.quote).toBe(facts.evidence.quote);
  expect(read.decisions![added.id].verdict).toBe("confirmed");
  expect(read.decisions!.facts).toBeUndefined();
  expect(read.decisions!.open.verdict).toBe("rejected");
  expect(read.organization!.subjects[0].unitIds).toEqual(["facts", added.id, "open"]);
  // An answer that confirms a decision stays as it is.
  const deciding = { ...ledger, batches: [{ sourceIds: [], status: "ok", units: [{ ...facts, kind: "decision" }, open] }] } as unknown as WikiKnowledgeLedger;
  expect(withAnsweredChoices(deciding)).toBe(deciding);
});

it("adds a decision a line only names inside a point of its own, instead of taking that line for it", () => {
  const statement = "Pocket Ledger v1 supports USD only; multi-currency functionality is explicitly excluded.";
  const decision = { id: "d", subject: "Scope", statement, kind: "constraint", details: [], adoption: { status: "user_decision" }, delivery: "unknown", evidence: { evidenceId: "d", conversationId: "x", messageId: "d", messageIndex: 1, role: "user", pasted: false, quote: statement } } as unknown as WikiKnowledgeUnit;
  const organization = { status: "complete", subjects: [{ id: "s", title: "Scope", unitIds: ["d", "f"] }], chapters: [{ id: "c", title: "Scope", question: "", group: "", subtopics: [{ title: "Currency", subjectIds: ["s"] }] }], relations: [], groups: [], merged: [] } as unknown as WikiKnowledgeOrganization;
  const line = "External feedback suggesting multi-currency support and cloud sync from day one conflicts with the confirmed v1 constraint that Pocket Ledger supports USD only, with multi-currency functionality explicitly excluded.";
  const draft: WikiDraftChapter = { id: "c", title: "Scope", question: "", group: "", body: `### Currency\n\n${line}`, paragraphs: [{ subtopic: "Currency", text: line, unitIds: ["f", "d"], claims: [{ text: line, unitIds: ["f", "d"] }] }], problems: [] } as WikiDraftChapter;
  expect(ensureWikiDecisions([draft], organization, [decision], new Map<string, WikiUnitStatus>([["d", "confirmed"], ["f", "proposal"]]))).toBe(1);
  expect(draft.paragraphs.map(paragraph => paragraph.text)).toEqual([line, statement]);
  expect(draft.body).toBe(`### Currency\n\n${line}\n\n${statement}`);
});

it("moves an earlier criterion out of a current list item to the earlier versions", () => {
  const now = "Focuses exclusively on data reliability, excluding CSV export.", old = "Complete when expenses can be exported without data corruption.";
  const next = "2. **Milestone 2**: Includes CSV export.";
  const list = `1. **Milestone 1**: ${now} ${old}\n${next}`;
  const draft = { id: "c", title: "T", question: "", group: "", body: `### Roadmap\n\n${list}`, problems: [],
    paragraphs: [{ subtopic: "Roadmap", text: list, unitIds: ["m1", "h", "m2"], claims: [{ text: now, unitIds: ["m1"] }, { text: old, unitIds: ["h"] }, { text: "Includes CSV export.", unitIds: ["m2"] }] }] } as unknown as WikiDraftChapter;
  expect(earlierVersionsLast([draft], id => id === "h" ? "history" : "proposal", false)).toBe(1);
  expect(draft.body).toBe(`### Roadmap\n\n1. **Milestone 1**: ${now}\n${next}\n\n### Earlier versions\n\n- **Milestone 1**: ${old}`);
  expect(draft.paragraphs[0].claims!.map(claim => claim.text)).toEqual([now, "Includes CSV export."]);
  expect(draft.paragraphs[0].unitIds).toEqual(["m1", "m2"]);
});

it("adds a decision a claim of its own only names, before the subtopic's closing note", () => {
  const statement = "Pocket Ledger v1 supports USD only; multi-currency functionality is explicitly excluded.";
  const decision = { id: "d", subject: "Scope", statement, kind: "constraint", details: [], adoption: { status: "user_decision" }, delivery: "unknown", evidence: { evidenceId: "d", conversationId: "x", messageId: "d", messageIndex: 1, role: "user", pasted: false, quote: statement } } as unknown as WikiKnowledgeUnit;
  const organization = { status: "complete", subjects: [{ id: "s", title: "Scope", unitIds: ["d"] }], chapters: [{ id: "c", title: "Scope", question: "", group: "", subtopics: [{ title: "Persistence", subjectIds: ["s"] }, { title: "Status", subjectIds: [] }] }], relations: [], groups: [], merged: [] } as unknown as WikiKnowledgeOrganization;
  const line = "External feedback suggesting multi-currency support and cloud sync from day one conflicts with the confirmed v1 constraint that Pocket Ledger supports USD only, with multi-currency functionality explicitly excluded.";
  const note = "> 4 more related points in the ledger";
  const draft: WikiDraftChapter = { id: "c", title: "Scope", question: "", group: "", body: `### Persistence\n\n${line}\n\n${note}\n\n### Status\n\nBuilt.`, problems: [],
    paragraphs: [{ subtopic: "Persistence", text: line, unitIds: ["d"], claims: [{ text: line, unitIds: ["d"] }] }, { subtopic: "Status", text: "Built.", unitIds: [], claims: [] }] } as WikiDraftChapter;
  expect(ensureWikiDecisions([draft], organization, [decision], new Map<string, WikiUnitStatus>([["d", "confirmed"]]))).toBe(1);
  expect(draft.body).toBe(`### Persistence\n\n${line}\n\n${statement}\n\n${note}\n\n### Status\n\nBuilt.`);
  // A claim saying the decision in a part of its own still covers it.
  const said = "Standard UI components use a global corner radius of 8px; earlier specifications for larger radii are ignored.";
  const radius = { ...decision, id: "r", statement: "Standard UI components use a global corner radius of 8px." } as WikiKnowledgeUnit;
  const ui: WikiDraftChapter = { id: "c", title: "Scope", question: "", group: "", body: `### Persistence\n\n${said}`, problems: [], paragraphs: [{ subtopic: "Persistence", text: said, unitIds: ["r"], claims: [{ text: said, unitIds: ["r"] }] }] } as WikiDraftChapter;
  const uiOrganization = { ...organization, subjects: [{ id: "s", title: "Scope", unitIds: ["r"] }] } as unknown as WikiKnowledgeOrganization;
  expect(ensureWikiDecisions([ui], uiOrganization, [radius], new Map<string, WikiUnitStatus>([["r", "confirmed"]]))).toBe(0);
});

it("does not read a point placed under the user's message as theirs when the message says nothing of it", () => {
  const placed = (statement: string, quote: string) => ({ id: statement.slice(0, 8), subject: "Roadmap", statement, kind: "plan", details: [], adoption: { status: "unknown" }, delivery: "unknown",
    evidence: { evidenceId: "e", conversationId: "c", messageId: "m", messageIndex: 32, role: "user", pasted: false, quote } }) as unknown as WikiKnowledgeUnit;
  const review = placed("Milestone 1 focuses exclusively on data reliability.", "Here is feedback a friend pasted from their review, what do you think?\n> \"The app should support multiple currencies from day one.\"");
  const summary = placed("Privacy and currency constraints apply to all future Pocket Ledger architecture and roadmap recommendations.", "给我把上面的15句对话总结成一个最终MD");
  const own = placed("The roadmap consists of four milestones leading to a public beta.", "Give me a roadmap with 4 milestones from now to a public beta.");
  const chinese = placed("Bank syncing is excluded from v1.", "第一版不要做银行同步。");
  const statuses = wikiUnitStatuses([review, summary, own, chinese], { relations: [] });
  expect([review, summary, own, chinese].map(unit => statuses.get(unit.id))).toEqual(["proposal", "proposal", "stated", "stated"]);
});

it("keeps a decision it wrote through the passes dropping repeats, and leaves one said before the earlier values it set aside", () => {
  const statement = "CSV export moves to Milestone 2.";
  const move = { id: "d", subject: "Roadmap", statement, kind: "decision", details: [], adoption: { status: "user_decision" }, delivery: "unknown", evidence: { evidenceId: "d", conversationId: "x", messageId: "d", messageIndex: 1, role: "user", pasted: false, quote: "★ Revise the roadmap: move CSV export into milestone 2." } } as unknown as WikiKnowledgeUnit;
  const organization = { status: "complete", subjects: [{ id: "s", title: "Roadmap", unitIds: ["d", "p"] }], chapters: [{ id: "c", title: "Roadmap", question: "", group: "", subtopics: [{ title: "Roadmap", subjectIds: ["s"] }] }], relations: [], groups: [], merged: [] } as unknown as WikiKnowledgeOrganization;
  const opening = "The roadmap consists of four milestones leading to a public beta, with CSV export moved from Milestone 1 to Milestone 2.";
  const draft: WikiDraftChapter = { id: "c", title: "Roadmap", question: "", group: "", body: `${opening}\n\n### Roadmap\n\nFour milestones lead to a beta.`, openingUnitIds: ["d", "p"], problems: [],
    paragraphs: [{ subtopic: "Roadmap", text: "Four milestones lead to a beta.", unitIds: ["p"], claims: [] }] } as unknown as WikiDraftChapter;
  const statuses = new Map<string, WikiUnitStatus>([["d", "confirmed"], ["p", "proposal"]]);
  const kept = new Set<WikiDraftChapter["paragraphs"][number]>();
  expect(ensureWikiDecisions([draft], organization, [move], statuses, new Set(), kept)).toBe(1);
  expect(kept.size).toBe(1);
  droppedRepeatedParagraphs([draft], kept);
  droppedOpeningRepeats([draft], id => id === "d" ? move : undefined, id => id === "d", kept);
  expect(draft.paragraphs.map(paragraph => paragraph.text)).toContain(statement);
  // Said before the earlier values it set aside, in a claim citing those too: the decision is told, nothing is added.
  const radius = { ...move, id: "r", statement: "Standard UI components use a global corner radius of 8px." } as WikiKnowledgeUnit;
  const line = "Standard UI components use a global corner radius of 8px; earlier specifications for larger card (16px) and dialog (24px) radii are ignored.";
  const ui: WikiDraftChapter = { id: "c", title: "Roadmap", question: "", group: "", body: `### Roadmap\n\n- ${line}`, problems: [], paragraphs: [{ subtopic: "Roadmap", text: `- ${line}`, unitIds: ["r", "h", "p"], claims: [{ text: line, unitIds: ["r", "h", "p"] }] }] } as WikiDraftChapter;
  const uiOrganization = { ...organization, subjects: [{ id: "s", title: "Roadmap", unitIds: ["r"] }] } as unknown as WikiKnowledgeOrganization;
  expect(ensureWikiDecisions([ui], uiOrganization, [radius], new Map<string, WikiUnitStatus>([["r", "confirmed"], ["h", "history"], ["p", "proposal"]]))).toBe(0);
});

it("marks a claim ending on its own full stop there, not in the next sentence", () => {
  const claim = "The choice between monthly budgets and per-pay-period budgets remains explicitly undecided.";
  expect(withHolderMarks(`${claim} Monthly budgets are simpler and better for fixed allowances; pay-period budgets match cash flow.`, [{ text: claim, holder: "open" }], false))
    .toBe(`${claim} [Open] Monthly budgets are simpler and better for fixed allowances; pay-period budgets match cash flow.`);
});

it("writes a decision a claim citing it alone tells only after another point", () => {
  const statement = "Pocket Ledger v1 supports USD only; multi-currency functionality is explicitly excluded.";
  const decision = { id: "d", subject: "Scope", statement, kind: "constraint", details: [], adoption: { status: "user_decision" }, delivery: "unknown", evidence: { evidenceId: "d", conversationId: "x", messageId: "d", messageIndex: 1, role: "user", pasted: false, quote: statement } } as unknown as WikiKnowledgeUnit;
  const organization = { status: "complete", subjects: [{ id: "s", title: "Scope", unitIds: ["d"] }], chapters: [{ id: "c", title: "Scope", question: "", group: "", subtopics: [{ title: "Persistence", subjectIds: ["s"] }] }], relations: [], groups: [], merged: [] } as unknown as WikiKnowledgeOrganization;
  const line = "External feedback suggests supporting multiple currencies from day one and syncing across devices through a cloud account, but Pocket Ledger v1 supports USD only; multi-currency functionality is explicitly excluded.";
  const draft: WikiDraftChapter = { id: "c", title: "Scope", question: "", group: "", body: `### Persistence\n\nCloud sync is deferred. ${line}`, problems: [],
    paragraphs: [{ subtopic: "Persistence", text: `Cloud sync is deferred. ${line}`, unitIds: ["d"], claims: [{ text: line, unitIds: ["d"] }] }] } as WikiDraftChapter;
  const kept = new Set<WikiDraftChapter["paragraphs"][number]>();
  expect(ensureWikiDecisions([draft], organization, [decision], new Map<string, WikiUnitStatus>([["d", "confirmed"]]), new Set(), kept)).toBe(1);
  expect([...kept].map(paragraph => paragraph.text)).toEqual([statement]);
});

it("edits a paragraph at its own place when another paragraph ends with the same words", () => {
  const rule = "Pocket Ledger v1 supports USD only; multi-currency functionality is explicitly excluded.";
  const feedback = `External feedback suggests multiple currencies, but ${rule}`, never = "In version 1, transaction data must never be sent to any server.";
  const body = `### Persistence\n\n${feedback}\n\n${never}\n\n${rule}\n\n> 4 more related points in the ledger`;
  expect(replaceParagraph(body, rule, "USD only.")).toBe(`### Persistence\n\n${feedback}\n\n${never}\n\nUSD only.\n\n> 4 more related points in the ledger`);
  expect(removeParagraph(body, rule)).toBe(`### Persistence\n\n${feedback}\n\n${never}\n\n> 4 more related points in the ledger`);
  // Not standing alone anywhere: its first place, as before.
  expect(replaceParagraph("A rule. B.", "A rule.", "C.")).toBe("C. B.");
  // A pass shortening the restored paragraph leaves the feedback sentence whole.
  const draft: WikiDraftChapter = { id: "c", title: "Technical Architecture", question: "", group: "", body, problems: [], paragraphs: [
    { subtopic: "Persistence", text: feedback, unitIds: ["d"], claims: [{ text: feedback, unitIds: ["d"] }] },
    { subtopic: "Persistence", text: never, unitIds: ["n"], claims: [{ text: never, unitIds: ["n"] }] },
    { subtopic: "Persistence", text: rule, unitIds: ["d"], claims: [{ text: rule, unitIds: ["d"] }] }] } as WikiDraftChapter;
  const restored = structuredClone(draft);
  droppedContainedDecisions([draft], () => 2);
  expect(draft.body).toContain(`${feedback}\n\n${never}`);
  // Restored because the feedback sentence holds it only inside another point: it stays.
  expect(droppedContainedDecisions([restored], () => 2, new Set([restored.paragraphs[2]]))).toBe(0);
  expect(restored.body).toContain(`${never}\n\n${rule}`);
});

it("binds a claim to the decision it tells when its other unit only says the same point", () => {
  const statement = "v1 is web only, with no native mobile app.";
  const unitOf = (id: string, text: string, role: string) => ({ id, subject: "Scope", statement: text, kind: "constraint", details: [], adoption: { status: "user_decision" }, delivery: "unknown", evidence: { evidenceId: id, conversationId: "x", messageId: id, messageIndex: 1, role, pasted: false, quote: text } }) as unknown as WikiKnowledgeUnit;
  const decision = unitOf("d", statement, "user"), proposal = unitOf("p", "V1 is Web only; no native iOS or Android apps.", "assistant");
  const organization = { status: "complete", subjects: [{ id: "s", title: "Scope", unitIds: ["d", "p"] }], chapters: [{ id: "c", title: "Scope", question: "", group: "", subtopics: [{ title: "V1 Scope", subjectIds: ["s"] }] }], relations: [], groups: [], merged: [] } as unknown as WikiKnowledgeOrganization;
  const line = "The platform is strictly Web only; there are no native iOS or Android apps.";
  const draft: WikiDraftChapter = { id: "c", title: "Scope", question: "", group: "", body: `### V1 Scope\n\n${line}`, problems: [], paragraphs: [{ subtopic: "V1 Scope", text: line, unitIds: ["d", "p"], claims: [{ text: line, unitIds: ["d", "p"] }] }] } as WikiDraftChapter;
  ensureWikiDecisions([draft], organization, [decision, proposal], new Map<string, WikiUnitStatus>([["d", "confirmed"], ["p", "proposal"]]));
  expect(draft.paragraphs.map(paragraph => paragraph.text)).toEqual([line]);
  expect(draft.paragraphs[0].claims).toEqual([{ text: line, unitIds: ["d"] }]);
});

it("clears a no-claim problem once the item's sentences are claimed without its label", () => {
  const item = "3. **Milestone 3**: Private alpha testing targets 10–15 college students. Goals include expense entry under 10 seconds.";
  const claim = "Private alpha testing targets 10–15 college students. Goals include expense entry under 10 seconds.";
  const draft = { id: "c", title: "Roadmap", question: "", group: "", body: item, paragraphs: [{ subtopic: "Roadmap", text: item, unitIds: ["m"], claims: [{ text: claim, unitIds: ["m"] }] }],
    problems: ["\" **Milestone 3**：Private…\" has no claim naming the units it states; add a claim for each decided, done, figure or change sentence"] } as unknown as WikiDraftChapter;
  const unit = { id: "m", subject: "Roadmap", statement: claim, kind: "plan", details: [], adoption: { status: "assistant_proposal" }, delivery: "unknown", evidence: { evidenceId: "m", conversationId: "x", messageId: "m", messageIndex: 1, role: "assistant", pasted: false, quote: claim } } as unknown as WikiKnowledgeUnit;
  expect(refreshedClaimProblems([draft], new Map([["m", unit]]))).toBe(1);
  expect(draft.problems).toEqual([]);
});

it("moves the replaced criterion told in one claim with the current milestone to earlier versions", () => {
  const unitOf = (id: string, text: string) => ({ id, subject: "Roadmap", statement: text, kind: "plan", details: [], adoption: { status: "assistant_proposal" }, delivery: "unknown", evidence: { evidenceId: id, conversationId: "x", messageId: id, messageIndex: 1, role: "assistant", pasted: false, quote: text } }) as unknown as WikiKnowledgeUnit;
  const current = unitOf("now", "Revised Milestone 1 covers Dexie persistence and chart correctness only, excluding CSV export.");
  const old = unitOf("old", "Milestone 1 is complete when expenses can be added, edited, displayed, and exported without data corruption, passing tests for special characters and formula-like text.");
  const said = "Covers Dexie persistence and chart correctness. It excludes CSV export. Completion requires expenses can be added, edited, displayed, and exported without data corruption, passing tests for special characters and formula-like text.";
  const item = `1. **Milestone 1**: ${said}\n2. **Milestone 2**: Includes CSV export.`;
  const draft = { id: "c", title: "Roadmap", question: "", group: "", body: `### Roadmap\n\n${item}`, problems: [], paragraphs: [{ subtopic: "Roadmap", text: item, unitIds: ["now", "old"], claims: [{ text: said, unitIds: ["now", "old"] }] }] } as unknown as WikiDraftChapter;
  const units = new Map([["now", current], ["old", old]]);
  expect(earlierVersionsLast([draft], id => id === "old" ? "history" : "proposal", false, id => units.get(id))).toBe(1);
  expect(draft.body).toContain("1. **Milestone 1**: Covers Dexie persistence and chart correctness. It excludes CSV export.\n2.");
  expect(draft.body).toContain("### Earlier versions\n\n- **Milestone 1**: Completion requires expenses can be added");
});

it("says a short answer with what its question is about", () => {
  const facts = ledgerUnit("wide", "建议将 Popup 宽度设为 380px，高度自适应。", "assistant", 20, { kind: "fact" } as Partial<WikiKnowledgeUnit>);
  const question = { id: "q", about: "Popup 宽度", ask: "Popup 宽度最终定为 360px 还是 380px？", unitIds: ["wide"], organization: 0,
    options: [{ id: "o", label: "380px", actions: [{ do: "confirm", units: ["wide"] }] }] } as WikiWritingQuestion;
  const ledger = { batches: [{ sourceIds: [], status: "ok", units: [facts] }], writingQuestions: [question],
    userAnswers: [{ questionId: "q", optionId: "o", unitIds: ["wide"], question: question.ask, answer: "380px", at: 5 }], decisions: { wide: { verdict: "confirmed", at: 5 } },
    organization: { subjects: [{ id: "s", name: "界面", aliases: [], unitIds: ["wide"] }], relations: [] } } as unknown as WikiKnowledgeLedger;
  // Not 「380px.」 alone.
  expect(withAnsweredChoices(ledger).batches[0].units.find(unit => unit.id.startsWith("answer:"))!.statement).toBe("Popup 宽度：380px。");
});

it("settles a point elsewhere saying an answered choice is still open", () => {
  const both = ledgerUnit("both", "弹窗宽度保留 B1（380px）与 B2（360px）两案并存，未最终指定前不做选择。", "assistant", 20);
  const mine = ledgerUnit("mine", "存储方案和弹窗宽度的最终选择暂不决定，两个备选方案均保留。", "user", 21);
  const other = ledgerUnit("other", "是否加入每 4 个番茄钟一次的 15 分钟长休息尚未确定。", "assistant", 22);
  const question = { id: "q", about: "Popup 宽度", ask: "Popup 宽度定为 360px 还是 380px？", unitIds: ["both"], organization: 0, options: [] } as unknown as WikiWritingQuestion;
  const ledger = { batches: [{ sourceIds: [], status: "ok", units: [both, mine, other] }], writingQuestions: [question],
    userAnswers: [{ questionId: "q", optionId: "o", unitIds: ["both"], question: question.ask, answer: "380px", at: 5 }], decisions: { both: { verdict: "rejected", at: 5 } } } as unknown as WikiKnowledgeLedger;
  const read = withAnsweredOpenPoints(ledger);
  expect(read.decisions!.mine).toEqual({ verdict: "rejected", at: 5 });
  // Another open choice is not this one.
  expect(read.decisions!.other).toBeUndefined();
  expect(ledger.decisions).not.toHaveProperty("mine");
});

it("confirms with an answer only what it answers, and keeps a point the rejected change would replace", async () => {
  const { wikiUnitStatuses } = await import("./wiki-knowledge-state");
  const wide = ledgerUnit("wide", "第一版默认专注时长为25分钟，短休息时长为5分钟，每4轮后休息15分钟。", "user", 3);
  const exact = ledgerUnit("exact", "V0.1版本默认专注时间为25分钟，休息时间为5分钟。", "user", 6);
  const later = ledgerUnit("later", "用户决定将默认专注时长改为 50 分钟，休息时长改为 10 分钟。", "user", 8);
  const question = { id: "q", about: "默认专注/休息时长", ask: "第一版默认时长用 25/5 还是 50/10？", unitIds: ["wide", "exact", "later"], organization: 0,
    options: [{ id: "o2", label: "25分钟专注，5分钟休息", actions: [{ do: "confirm", units: ["wide", "exact"] }, { do: "reject", units: ["later"] }] }] } as unknown as WikiWritingQuestion;
  const ledger = { batches: [{ sourceIds: [], status: "ok", units: [wide, exact, later] }], writingQuestions: [question],
    userAnswers: [{ questionId: "q", optionId: "o2", unitIds: question.unitIds, question: question.ask, answer: "25分钟专注，5分钟休息", at: 5 }],
    decisions: { wide: { verdict: "confirmed", at: 5 }, exact: { verdict: "confirmed", at: 5 }, later: { verdict: "rejected", at: 5 } } } as unknown as WikiKnowledgeLedger;
  const read = withAnswerScope(ledger);
  // The long break was never asked about: that point is not decided by the answer; the point saying 25/5 alone is.
  expect(read.decisions!.wide).toBeUndefined();
  expect(read.decisions!.exact.verdict).toBe("confirmed");
  // And the 50/10 change, set aside, does not make the 25/5 point earlier.
  const statuses = wikiUnitStatuses([wide, exact, later], { relations: [{ older: "wide", newer: "later", kind: "replaces", status: "resolved" }] } as never, read.decisions);
  expect(statuses.get("wide")).not.toBe("history");
  expect(statuses.get("later")).toBe("history");
});

it("turns down the suggested change the user said no to, even when the option left it open", () => {
  const change = ledgerUnit("change", "助手建议将首页统计文案从“完成番茄 X 个”改为“完成专注 X 轮”，以匹配 50 分钟的深度工作节奏，待用户确认。", "assistant", 4);
  const question = { id: "q", about: "首页统计文案", ask: "首页文案确认为“完成专注 X 轮”吗？", unitIds: ["change"], organization: 0,
    options: [{ id: "o1", label: "是，使用“完成专注 X 轮”", actions: [{ do: "confirm", units: ["change"] }] }, { id: "o2", label: "否，保持原样或待定", actions: [{ do: "open", units: ["change"] }] }] } as unknown as WikiWritingQuestion;
  const answered = (optionId: string, verdict: string) => ({ batches: [{ sourceIds: [], status: "ok", units: [change] }], writingQuestions: [question],
    userAnswers: [{ questionId: "q", optionId, unitIds: ["change"], question: question.ask, answer: "", at: 5 }], decisions: { change: { verdict, at: 5 } } }) as unknown as WikiKnowledgeLedger;
  expect(withDeclinedProposals(answered("o2", "open")).decisions!.change.verdict).toBe("rejected");
  expect(withDeclinedProposals(answered("o1", "confirmed")).decisions!.change.verdict).toBe("confirmed");
});

it("settles what a chosen option set open, and does not settle other open questions with it", () => {
  const plan = ledgerUnit("plan", "第一版默认专注时长为25分钟，短休息时长为5分钟，每4轮后长休息15分钟。", "user", 3);
  const asked = ledgerUnit("asked", "是否加入每 4 个番茄钟一次的 15 分钟长休息尚未确定。", "assistant", 4, { kind: "question" } as Partial<WikiKnowledgeUnit>);
  const rule = ledgerUnit("rule", "宽度必须写成 CSS 变量 --popup-width，body 使用该变量。", "assistant", 5);
  const custom = ledgerUnit("custom", "是否允许用户自定义专注和休息时长尚未确定。", "assistant", 6, { kind: "question" } as Partial<WikiKnowledgeUnit>);
  const question = { id: "q", about: "长休息机制", ask: "V0.1版本是否包含每4轮后的15分钟长休息？", unitIds: ["plan", "asked", "rule"], organization: 0,
    options: [{ id: "o1", label: "包含长休息", actions: [{ do: "confirm", units: ["plan"] }, { do: "open", units: ["asked", "rule"] }] }] } as unknown as WikiWritingQuestion;
  const ledger = { batches: [{ sourceIds: [], status: "ok", units: [plan, asked, rule, custom] }], writingQuestions: [question],
    userAnswers: [{ questionId: "q", optionId: "o1", unitIds: question.unitIds, question: question.ask, answer: "包含长休息", at: 5 }],
    decisions: { plan: { verdict: "confirmed", at: 5 }, asked: { verdict: "open", at: 5 }, rule: { verdict: "open", at: 5 } } } as unknown as WikiKnowledgeLedger;
  const read = withAnsweredOpenPoints(withSettledByAnswer(ledger));
  expect(read.decisions!.asked).toEqual({ verdict: "rejected", at: 5 });
  // Not a choice left open: it keeps no verdict from the answer.
  expect(read.decisions!.rule).toBeUndefined();
  // Another open question shares only "是否……尚未确定" with it.
  expect(read.decisions!.custom).toBeUndefined();
  expect(ledger.decisions!.asked.verdict).toBe("open");
});

it("writes a short Chinese answer after what it is about", () => {
  const facts = ledgerUnit("label", "助手建议将首页统计文案改为“完成专注 X 轮”。", "assistant", 20, { kind: "fact" } as Partial<WikiKnowledgeUnit>);
  const question = { id: "q", about: "首页统计文案", ask: "首页显示“完成番茄 X 个”还是“完成专注 X 轮”？", unitIds: ["label"], organization: 0,
    options: [{ id: "o", label: "使用“完成专注 X 轮”", actions: [{ do: "confirm", units: ["label"] }] }] } as WikiWritingQuestion;
  const ledger = { batches: [{ sourceIds: [], status: "ok", units: [facts] }], writingQuestions: [question],
    userAnswers: [{ questionId: "q", optionId: "o", unitIds: ["label"], question: question.ask, answer: "使用“完成专注 X 轮”", at: 5 }], decisions: { label: { verdict: "confirmed", at: 5 } },
    organization: { subjects: [{ id: "s", name: "界面", aliases: [], unitIds: ["label"] }], relations: [] } } as unknown as WikiKnowledgeLedger;
  expect(withAnsweredChoices(ledger).batches[0].units.find(unit => unit.id.startsWith("answer:"))!.statement).toBe("首页统计文案：使用“完成专注 X 轮”。");
});
