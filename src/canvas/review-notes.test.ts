import { describe, expect, it } from "vitest";
import { carryReviewNotes } from "./review-notes";
import { focusMarkdown } from "../storage/focus-sessions";
import type { FocusSession } from "../shared/focus-session";

const previous: FocusSession = { id: "old", goal: "Review", mode: "review", title: "Review", sourceConversationIds: ["source"], sections: [{ id: "one", title: "Original chapter", body: "Original", kind: "review", transition: "", evidenceIds: ["e1"] }], evidence: [{ id: "e1", conversationId: "source", messageId: "q1", title: "Source", excerpt: "Original question" }], activeSectionId: "one", completedSectionIds: [], notes: "Legacy shared note", sectionNotes: { one: { text: "My own qualification", evidenceIds: ["e1"], updatedAt: 1 } }, reviewNeeds: { one: "What about B?" }, createdAt: 1, updatedAt: 1 };
describe("chapter understanding survives revisions", () => {
  it("remaps multiple Wiki notes without mutating the previous version", () => {
    const old = { ...previous, detachedNotes: [{ title: "Wiki note", text: "My decision", section: { id: "one", title: "Original chapter" }, sources: previous.evidence }] };
    const next = { ...previous, sections: [{ ...previous.sections[0], id: "new" }] };
    expect(carryReviewNotes(old, next).detachedNotes?.[0].section?.id).toBe("new");
    expect(old.detachedNotes[0].section.id).toBe("one");
    expect(carryReviewNotes(old, { ...next, sections: [] }).detachedNotes?.[0]).toEqual(old.detachedNotes[0]);
  });
  it("retains an authored chapter route after a revision and recovers unmatched cards as earlier notes", () => {
    const path = [{ ...previous.sections[0], id: "personal-step", title: "我的卡片", body: "自己的补充", origin: "user" as const }];
    const old = { ...previous, sections: [{ ...previous.sections[0], understandingPath: path }] };
    const matched = { ...previous, sections: [{ ...previous.sections[0], id: "changed" }] };
    expect(carryReviewNotes(old, matched).sections?.[0].understandingPath).toBe(path);
    const unmatched = { ...matched, sections: [] };
    expect(carryReviewNotes(old, unmatched).detachedNotes?.[0].text).toContain("我的卡片\n自己的补充");
  });
  it("remaps a note by exact original message references when chapter titles and IDs change", () => {
    const next = { ...previous, sections: [{ ...previous.sections[0], id: "new", title: "Renamed chapter", evidenceIds: ["r1"] }], evidence: [{ ...previous.evidence[0], id: "r1" }] };
    const notes = carryReviewNotes(previous, next);
    expect(notes.sectionNotes?.new.text).toBe("My own qualification");
    expect(notes.sectionNotes?.new.sources?.[0].messageId).toBe("q1");
    expect(notes.reviewNeeds).toEqual({ new: "What about B?" });
    expect(notes.notes).toBe("Legacy shared note");
  });
  it("remaps route citations by original messages instead of colliding citation labels", () => {
    const old = { ...previous, sections: [{ ...previous.sections[0], understandingPath: [{ ...previous.sections[0], id: "my-step" }] }] };
    const next = { ...previous, evidence: [{ ...previous.evidence[0], messageId: "unrelated" }, { ...previous.evidence[0], id: "e2" }] };
    expect(carryReviewNotes(old, next, true).sections?.[0].understandingPath?.[0].evidenceIds).toEqual(["e2"]);
    expect(carryReviewNotes(old, { ...next, evidence: [next.evidence[0]] }, true).sections?.[0].understandingPath?.[0].evidenceIds).toEqual([]);
  });
  it("keeps ambiguous notes recoverable instead of attaching them to an unrelated section", () => {
    const next = { ...previous, sections: [{ ...previous.sections[0], id: "new", title: "Other", evidenceIds: [] }], evidence: [] };
    const notes = carryReviewNotes(previous, next);
    expect(notes.sectionNotes).toEqual({});
    expect(notes.detachedNotes?.[0]).toMatchObject({ title: "Original chapter", text: "My own qualification\n\nWhat about B?", sources: [previous.evidence[0]] });
    const exported = focusMarkdown({ ...next, ...notes });
    expect(exported).toContain("My own qualification");
    expect(exported).toContain("> Original question");
  });
  it("preserves the explicit target of a section revision even when it gets new citations", () => {
    const next = { ...previous, sections: [{ ...previous.sections[0], title: "Expanded", evidenceIds: ["r2"] }], evidence: [{ ...previous.evidence[0], id: "r2", messageId: "q2" }] };
    expect(carryReviewNotes(previous, next, true).sectionNotes?.one.sources?.[0].messageId).toBe("q1");
  });
  it("exports old note references separately from colliding new model citation labels", () => {
    const next = { ...previous, evidence: [{ ...previous.evidence[0], messageId: "q2", excerpt: "New source" }], sectionNotes: { one: { ...previous.sectionNotes!.one, sources: previous.evidence } } };
    const text = focusMarkdown(next);
    expect(text).toContain("> New source");
    expect(text).toContain("> Original question");
    expect(text).toContain("My own qualification");
    expect(text).not.toMatch(/\[e1\]|source \/ q[12]/u);
  });
});
