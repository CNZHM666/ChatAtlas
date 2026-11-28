import { expect, it } from "vitest";
import { contextKnowledge } from "../test/context-fixture";
import type { WikiKnowledgeLedger } from "../shared/wiki-knowledge";
import { defaultProjectExportPreset, PROJECT_EXPORT_PRESETS, projectExportSelection } from "./project-export-presets";

it("uses the sidebar preference for export and otherwise uses the most recent saved writing mode", () => {
  const { session } = contextKnowledge();
  const ledger: WikiKnowledgeLedger = { version: 1, generatedAt: 1, status: "complete", materials: 0, batches: [],
    writingMode: "audit", draft: { version: 1, generatedAt: 1, status: "complete", chapters: [], report: {}, writingMode: "handoff" } };
  expect(defaultProjectExportPreset({...session, wikiKnowledge: ledger})).toBe("handoff");
  expect(defaultProjectExportPreset({...session, wikiKnowledge: ledger, sidecarWritingMode:"concise"})).toBe("brief");
  expect(defaultProjectExportPreset({...session, wikiKnowledge: {...ledger,draft:undefined}})).toBe("archive");
  expect(defaultProjectExportPreset({...session, wikiKnowledge: {...ledger,documentType:"learning"}})).toBeUndefined();
});

it("shares preset defaults while preserving selected chapters and explicit archive options", () => {
  const { session } = contextKnowledge();
  expect(PROJECT_EXPORT_PRESETS.map(item=>item.id)).toEqual(["brief","handoff","archive"]);
  const archive = projectExportSelection(session,"archive",{wikiIds:["database"],hasReferences:true});
  expect(archive).toMatchObject({overview:true,wikiIds:["database"],sourceMode:"excerpts",referenceAppendix:true,matters:false,history:false});
  const previous = {...archive,matters:true,history:true};
  expect(projectExportSelection(session,"archive",{previous,hasReferences:false})).toMatchObject({matters:true,history:true,referenceAppendix:"omit"});
  for(const preset of ["brief","handoff"] as const) expect(projectExportSelection(session,preset,{previous})).toMatchObject({
    preset,wikiIds:["database"],sourceMode:"locators",referenceAppendix:"omit",matters:false,history:false,
  });
});
