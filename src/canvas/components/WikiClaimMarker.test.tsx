import { expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { WikiClaimMarker } from "./WikiClaimMarker";
import { WikiClaimMarkerContext } from "../wiki-claim-marker-context";
import type { EvidencePoint } from "../workspace-evidence-context";

const reference = { id: "u1", conversationId: "c", messageId: "m1", title: "", excerpt: "索引使用 Orama。" };
const point = (key: string, extra: Partial<EvidencePoint>): EvidencePoint => ({ key, claim: "索引使用 Orama。", source: "proposal", reference, references: [reference], placed: false, ...extra });

it("labels the end of a status run, shows the assistant's text and intermediate claims as dots, and opens the evidence on a click", () => {
  const open = vi.fn();
  const points = [point("a", { holder: "ai" }), point("b", { holder: "ai", holderMark: true }), point("c", { holder: "decided", holderMark: true }), point("d", { holder: "open", holderMark: true })];
  render(<WikiClaimMarkerContext.Provider value={{ points, open, zh: true }}><p>一<WikiClaimMarker pointKey="a" />二<WikiClaimMarker pointKey="b" />三<WikiClaimMarker pointKey="c" />四<WikiClaimMarker pointKey="d" /></p></WikiClaimMarkerContext.Provider>);
  const [quiet, ai, decided, unsettled] = screen.getAllByRole("button");
  expect(quiet).toHaveClass("is-holder-quiet");expect(quiet.textContent).toBe("");
  // The assistant's run ends on a dot, still opening its evidence and naming its holder for screen readers.
  expect(ai).toHaveClass("is-holder-quiet");expect(ai.textContent).toBe("");expect(ai).toHaveAccessibleName("AI 的建议或分析，所选来源未见采纳记录 · 核对依据");
  expect(unsettled.textContent).toBe("未定");expect(unsettled).toHaveClass("is-holder-open");
  expect(decided.textContent).toBe("已定");expect(decided).toHaveClass("is-holder-decided");
  fireEvent.click(ai);
  expect(open).toHaveBeenCalledWith("b");
});
