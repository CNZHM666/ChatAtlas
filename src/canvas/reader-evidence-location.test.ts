import { describe, expect, it } from "vitest";
import { readerEvidenceTarget } from "./reader-evidence-location";
import { parseMessageSourceRange } from "../shared/message-location";

describe("exact excerpt location", () => {
  it("finds a later paragraph inside an AI message rather than its opening or a user question", () => {
    const message = document.createElement("div");
    message.innerHTML = '<p>Opening context</p><p>Later <strong>correction</strong>: this suggestion was never confirmed.</p>';
    expect(readerEvidenceTarget(message, "assistant: Later correction: this suggestion was never confirmed.")).toBe(message.children[1]);
    expect(readerEvidenceTarget(message, "assistant: Later **correction**: this suggestion was never confirmed.")).toBe(message.children[1]);
    expect(readerEvidenceTarget(message, "Missing text")).toBe(message);
  });
});

it("uses the complete excerpt when paragraphs share a long opening", () => {
  const message = document.createElement("article"), shared = "相同的开头".repeat(30);
  message.innerHTML = `<p>${shared}第一种条件</p><p>${shared}第二种条件</p>`;
  expect(readerEvidenceTarget(message, `${shared}第二种条件`)).toBe(message.children[1]);
});

it("refuses to choose an arbitrary repeated keyword when formatting removed source coordinates", () => {
  const message = document.createElement("article"); message.innerHTML = "<p>keyword first</p><p>keyword second</p>";
  expect(readerEvidenceTarget(message, "keyword", { start: 100, end: 107, excerpt: "keyword" })).toBe(message);
});

it("validates positions carried by external Reader links", () => {
  expect(parseMessageSourceRange('{"start":1,"end":5,"part":"content","excerpt":"code"}')).toMatchObject({ start: 1, end: 5, excerpt: "code" });
  for (const value of ["oops", "null", '{"start":-1,"end":2}', '{"start":5,"end":2}', '{"start":1,"end":5,"part":"ui"}', '{"start":1,"end":5,"part":"unsafe"}']) expect(parseMessageSourceRange(value)).toBeUndefined();
});
