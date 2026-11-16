import { expect, it } from "vitest";
import { unsupportedWikiNumbers, wikiNumberSpans } from "./wiki-number-diagnostics";

it("does not mistake list prefixes for unsupported numbers while still checking quantities in the items", () => {
  const spans = wikiNumberSpans("1. 先核对原文。\n2. 再导出文档。\n\n4. 支持 12 个元件。\n\n3.3V 电源。");
  expect(spans).not.toContain("1."); expect(spans).not.toContain("4.");
  const result = spans.flatMap(span => unsupportedWikiNumbers(span, "先核对原文，再导出文档。", new Set()).numbers);
  expect(result).toContain("12"); expect(result).toContain("3.3");
  expect(result).not.toContain("1"); expect(result).not.toContain("2"); expect(result).not.toContain("4");
});

it("validates identifiers as whole labels without using their digits to support a quantity", () => {
  expect(unsupportedWikiNumbers("GPLv3；Phase 14。", "GPLv3；Phase 14。", new Set())).toEqual({ numbers: [], ranges: [], identifiers: [] });
  expect(unsupportedWikiNumbers("支持 3 个元件。", "GPLv3", new Set()).numbers).toEqual(["3"]);
});
