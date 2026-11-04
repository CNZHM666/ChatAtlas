import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { ConversationMessage } from "../../shared/types";
import { QuestionReader } from "./QuestionReader";
import { ReaderToolbarProvider, ReaderToolbarSlot } from "./ReaderToolbar";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const messages: ConversationMessage[] = ["First question", "First answer", "Answer continuation", "What about the other method?", "Second answer"].map((content, i) => ({ id: `q-${i}`, conversationId: "source", role: i === 0 || i === 3 ? "user" : "assistant", messageIndex: i, content, preview: content, contentHash: `${i}`, createdAt: 1, updatedAt: 1 }));

it("opens a cited continuation at its question with every reply and lets the reader expand context", async () => {
  const scroll = vi.fn(); const originalScroll = HTMLElement.prototype.scrollIntoView;
  HTMLElement.prototype.scrollIntoView = scroll;
  try {
    const { container } = render(<QuestionReader messages={messages} zh={false} focusMessageId="q-2" initialFocused />);
    expect(screen.getByRole("button", { name: "Exit focus" })).toBeInTheDocument();
    expect(screen.getByText("First question")).toBeVisible();
    expect(screen.getByText("First answer")).toBeVisible();
    expect(screen.getByText("Answer continuation")).toBeVisible();
    expect(screen.queryByText("Second answer")).not.toBeInTheDocument();
    await waitFor(() => expect(scroll.mock.contexts.at(-1)).toBe(container.querySelector('[data-reader-message-id="q-0"]')));
    fireEvent.click(screen.getByRole("button", { name: "Next question" }));
    expect(screen.getByText("Second answer")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Read earlier context" }));
    expect(screen.getByText("First question")).toBeVisible();
    expect(screen.getByText("Second answer")).toBeVisible();
  } finally { HTMLElement.prototype.scrollIntoView = originalScroll; }
});

it("focuses complete turns, navigates questions and restores the original scroll without duplicate message IDs", async () => {
  const { container } = render(<main style={{ overflowY: "auto" }}><QuestionReader messages={messages} zh={false} selectedQuestionId="q-0" /></main>);
  const body = container.querySelector("main")!;
  body.scrollTop = 320;
  fireEvent.click(screen.getByRole("button", { name: "Focus question" }));
  expect(container.querySelectorAll("[data-reader-message-id]")).toHaveLength(3);
  expect(screen.getByText("Answer continuation")).toBeVisible();
  expect(screen.queryByText("Second answer")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Previous question" })).toBeDisabled();
  body.scrollTop = 0;
  fireEvent.click(screen.getByRole("button", { name: "Next question" }));
  expect(container.querySelectorAll("[data-reader-message-id]")).toHaveLength(2);
  expect(screen.getByText("Second answer")).toBeVisible();
  expect(screen.getByRole("button", { name: "Next question" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Exit focus" }));
  await waitFor(() => expect(body.scrollTop).toBe(320));
  expect(container.querySelectorAll("[data-reader-message-id]")).toHaveLength(5);
});

it("retains loaded history when leaving focus and can explicitly open earlier context outside an excerpt", async () => {
  const long = Array.from({ length: 70 }, (_, i) => ({ ...messages[0], id: `long-${i}`, messageIndex: i, content: `Turn ${i}`, role: i % 2 ? "assistant" as const : "user" as const }));
  const { container, rerender } = render(<QuestionReader messages={long} zh={false} selectedQuestionId="long-0" />);
  fireEvent.click(screen.getByRole("button", { name: /Continue reading/ }));
  expect(screen.getByText("Turn 47")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Focus question" }));
  fireEvent.click(screen.getByRole("button", { name: "Exit focus" }));
  expect(screen.getByText("Turn 47")).toBeVisible();
  rerender(<QuestionReader messages={messages.slice(3)} contextMessages={messages} zh={false} focusMessageId="q-4" />);
  fireEvent.click(screen.getByRole("button", { name: "Focus question" }));
  fireEvent.click(screen.getByRole("button", { name: "Read earlier context" }));
  await screen.findByText("First question");
  expect(screen.getByText("First answer")).toBeVisible();
  expect(container.querySelectorAll("[data-reader-message-id]")).toHaveLength(5);
  rerender(<QuestionReader messages={messages.slice(3)} contextMessages={messages} zh={false} focusMessageId="q-4" focusNonce={1} />);
  await waitFor(() => expect(container.querySelector(".knowledge-reader-message.is-focused")).toHaveTextContent("Second answer"));
});

it("follows an explicit new citation during focus and safely reads an answer with no saved question", () => {
  const { rerender } = render(<QuestionReader messages={messages} zh={false} focusMessageId="q-1" />);
  fireEvent.click(screen.getByRole("button", { name: "Focus question" }));
  rerender(<QuestionReader messages={messages} zh={false} focusMessageId="q-4" focusNonce={1} />);
  expect(screen.getByText("Second answer")).toBeVisible();
  expect(screen.queryByText("First answer")).not.toBeInTheDocument();
  rerender(<QuestionReader messages={[messages[1]]} zh={false} />);
  expect(screen.getByText("First answer")).toBeVisible();
  expect(screen.queryByRole("button", { name: "Focus question" })).not.toBeInTheDocument();
});

it("expands a citation reader at the current question after navigating away from the initial cite", async () => {
  const scroll = vi.fn(); const originalScroll = HTMLElement.prototype.scrollIntoView;
  HTMLElement.prototype.scrollIntoView = scroll;
  try {
    const { container } = render(<QuestionReader messages={messages} zh={false} focusMessageId="q-1" initialFocused />);
    fireEvent.click(screen.getByRole("button", { name: "Next question" }));
    fireEvent.click(screen.getByRole("button", { name: "Exit focus" }));
    await waitFor(() => expect(scroll.mock.contexts.at(-1)).toBe(container.querySelector('[data-reader-message-id="q-3"]')));
    expect(screen.getByText("Second answer")).toBeVisible();
  } finally { HTMLElement.prototype.scrollIntoView = originalScroll; }
});

it("keeps one working focus toolbar above the discussion and restores the scroll on exit", async () => {
  const { container } = render(<ReaderToolbarProvider><header><ReaderToolbarSlot /></header><main style={{ overflowY: "auto" }}><QuestionReader messages={messages} zh={false} selectedQuestionId="q-0" /></main></ReaderToolbarProvider>);
  const body = container.querySelector("main")!, header = container.querySelector("header")!;
  body.scrollTop = 410;
  expect(container.querySelector(".question-reader .question-reader-controls")).toBeNull();
  expect(header).toHaveTextContent("Focus question");
  fireEvent.click(screen.getByRole("button", { name: "Focus question" }));
  expect(header).toHaveTextContent("1/2");
  fireEvent.click(screen.getByRole("button", { name: "Next question" }));
  expect(screen.getByText("Second answer")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Exit focus" }));
  await waitFor(() => expect(body.scrollTop).toBe(410));
});

it("switches the sole toolbar to the active discussion and removes it after leaving the reader", () => {
  const view = (shown: boolean) => <ReaderToolbarProvider><header><ReaderToolbarSlot /></header>{shown ? <><QuestionReader messages={messages} zh={false} selectedQuestionId="q-0" /><QuestionReader messages={messages.slice(3)} zh={false} /></> : null}</ReaderToolbarProvider>;
  const { container, rerender } = render(view(true));
  const readers = container.querySelectorAll(".question-reader");
  expect(screen.getAllByRole("button", { name: "Focus question" })).toHaveLength(1);
  fireEvent.pointerDown(readers[0]);
  fireEvent.click(screen.getByRole("button", { name: "Focus question" }));
  expect(screen.getByRole("group", { name: "Question reading" })).toHaveTextContent("1/2");
  rerender(view(false));
  expect(container.querySelector(".reader-toolbar-slot")?.textContent).toBe("");
});
