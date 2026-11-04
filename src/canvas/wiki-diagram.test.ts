import { expect, it } from "vitest";
import { hasChapterDiagram, suggestedDiagramHeading, wikiDiagramParts } from "./wiki-diagram";
import { exampleChapterDiagram, workspaceLayoutExample } from "./workspace-layout-example";
it("offers diagrams for architecture while leaving ordinary chapters alone",()=>{
 const session=workspaceLayoutExample();
 expect(suggestedDiagramHeading(session.sections[0])).toBeUndefined();
 expect(suggestedDiagramHeading(session.sections[1])).not.toBeUndefined();
 expect(hasChapterDiagram(exampleChapterDiagram(session.sections[1]),session)).toBe(true);
});
it("embeds after a complete Markdown section and retains every original character",()=>{
 const body="Intro.\n\n## Architecture\n\n- A\n- B\n\n```js\n## not a heading\n```\n\n## Limits\n\nPending.";
 const [before,after]=wikiDiagramParts(body,"Architecture");
 expect(before+after).toBe(body);expect(before).toContain("```js\n## not a heading\n```");expect(after).toMatch(/^## Limits/);
});
