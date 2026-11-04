import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { WikiDocument } from "./WikiDocument";
import { DocumentOverview } from "./DocumentOverview";
import { projectSession } from "../../test/project-fixture";
import { sourceMessageSignature } from "../../shared/source-signature";
import { groundWikiClaims } from "../../shared/wiki-claims";
import type { FocusSession } from "../../shared/focus-session";

afterEach(cleanup);
const proposal = "我建议采用 Orama 作为搜索引擎。", decision = "我决定使用 IndexedDB 保存消息。";
function fixture(): FocusSession {
  const session = projectSession(); session.projectState = undefined;
  const originals = [{ text: proposal, role: "assistant" as const }, { text: decision, role: "user" as const }].map(({ text, role }, index) => ({ id: `m${index}`, conversationId: "source", messageIndex: index, role, content: text, preview: "", contentHash: "", createdAt: 0, sourceCreatedAt: Date.UTC(2026, 8, index + 1), updatedAt: 0 }));
  session.evidence = originals.map((message, index) => ({ id: `e${index}`, conversationId: "source", messageId: message.id, title: "讨论", excerpt: message.content, sourceSignature: sourceMessageSignature(message.content) }));
  session.sourceConversationIds = ["source"]; session.sourceRoles = { source: { m0: "assistant", m1: "user" } };
  session.sourceSignatures = { source: Object.fromEntries(originals.map(message => [message.id, sourceMessageSignature(message.content)])) }; session.sourceMessageOrder = { source: ["m0", "m1"] };
  session.sections = groundWikiClaims([{ id: "store", title: "存储与搜索", body: "消息保存在 IndexedDB 中。\n\n用户已确认采用 Orama 作为搜索引擎。", kind: "finding", transition: "", evidenceIds: ["e0", "e1"], claims: [{ text: "消息保存在 IndexedDB 中。", quote: decision, evidenceIds: ["e1"], overviewRole: "decision" }, { text: "用户已确认采用 Orama 作为搜索引擎。", quote: proposal, evidenceIds: ["e0"], workStatus: "proposed", overviewRole: "decision" }] }], session.evidence, originals, true);
  return session;
}

it("keeps key conclusions out of the reading page; the sources list only the cited conversation turns", () => {
  const session = fixture();
  const view = render(<WikiDocument section={session.sections[0]} session={session} zh structure={null} onLocate={vi.fn()} onCurrent={vi.fn()} />);
  const sources = view.container.querySelector(".wiki-sources-unified") as HTMLDetailsElement;
  sources.open = true; fireEvent(sources, new Event("toggle"));
  expect(view.container.querySelector(".wiki-key-claims")).toBeNull();
  expect(view.container.querySelector(".wiki-evidence")).toBeNull();
});
it("hides key conclusions on personal chapters", () => {
  const session = fixture(), section = { ...session.sections[0], userEdited: true };
  const view = render(<WikiDocument section={section} session={session} zh structure={null} onLocate={vi.fn()} onCurrent={vi.fn()} />);
  expect(view.container.querySelector(".wiki-key-claims")).toBeNull();
});

it("puts checking into the one evidence button and lists no pending counts in the overview", () => {
  const session = fixture(), onReview = vi.fn();
  const { container } = render(<DocumentOverview session={session} zh onRead={vi.fn()} onLocate={vi.fn()} onReview={onReview} />);
  // No chapter counts, dates, document type or "待处理 / 未核对" row: checking starts from the quote button.
  expect(container.querySelector(".document-overview-identity")).toBeNull();
  expect(container.querySelector(".document-overview-meta")).toBeNull();
  expect(screen.queryByRole("button", { name: /^待处理 \d+$/u })).toBeNull();
  expect(screen.queryByText(/个来源对话/u)).toBeNull();
});
