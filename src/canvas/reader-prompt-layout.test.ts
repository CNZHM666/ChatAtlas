import {expect,it} from "vitest";
import {readerPromptLayout} from "./reader-prompt-layout";

it("renders prompt banners as compact headings and rules instead of oversized setext headings",()=>{
 const source="说明\n\n===========================\n=========== PHASE 1 — Welcome\n\n首页不要默认进入 Canvas。\n\n===========================\n=========== PHASE 3 — Solution Draft";
 const display=readerPromptLayout(source);
 expect(display).toContain("### PHASE 1 — Welcome");expect(display).toContain("### PHASE 3 — Solution Draft");
 expect(display).toContain("\n---\n");expect(display).not.toContain("=====");
 expect(display).toContain("首页不要默认进入 Canvas。");expect(source).toContain("===========================");
});

it("keeps code fences, indented code and actual equations intact",()=>{
 const source="x === y\n    ===== example\n```text\n=========================\n========= PHASE sample\n```\n~~~~text\n=========================\n~~~\n~~~~\n| value | a=b |";
 expect(readerPromptLayout(source)).toBe(source);
});
