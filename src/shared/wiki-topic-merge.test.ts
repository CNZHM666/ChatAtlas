import {expect,it} from "vitest";
import {contextKnowledge} from "../test/context-fixture";
import {mergeWikiTopics} from "./wiki-topic-merge";
const page={title:"消息存储",group:"技术",question:"如何保存消息？",sectionIds:["sidebar","database"]};
it("merges only explicitly selected pages, preserving chronology, notes, original sources and old links",()=>{
 const session=contextKnowledge().session;session.sections[1].kind="finding";session.activeSectionId="sidebar";
 session.sectionNotes={database:{text:"笔记 A",evidenceIds:["e-db"],updatedAt:1},sidebar:{text:"笔记 B",evidenceIds:["e-ui"],updatedAt:2}};
 session.projectMaintenance!.modules={m:{id:"m",title:"消息存储",layer:"数据",purpose:"存储",inputs:[],outputs:[],status:"documented",quote:"",evidenceIds:[],wikiSectionIds:["database","sidebar"]}};
 const before=structuredClone(session),next=mergeWikiTopics(session,[page]);
 expect(next.sections).toHaveLength(1);expect(next.sections[0].id).toBe("database");expect(next.activeSectionId).toBe("database");expect(next.completedSectionIds).toEqual([]);
 expect(next.sectionNotes!.database.text).toContain("笔记 A");expect(next.sectionNotes!.database.text).toContain("笔记 B");expect(next.sectionNotes!.database.evidenceIds).toEqual(["e-db","e-ui"]);
 expect(next.sections[0].evidenceIds).toEqual(["e-db","e-ui"]);expect(next.evidence).toEqual(before.evidence);expect(next.wikiSectionAliases!.sidebar).toBe("database");expect(next.projectMaintenance!.modules!.m.wikiSectionIds).toEqual(["database"]);
 expect(next.wikiMergeHistory![0].sections).toEqual(before.sections);expect(next.sections[0].evidenceReview?.mode).toBe("manual");expect(session).toEqual(before);
});
it("rejects personal pages and duplicate groups; an empty selection is a no-op",()=>{
 const session=contextKnowledge().session;session.sections[1].userEdited=true;
 expect(()=>mergeWikiTopics(session,[page])).toThrow("Personal");session.sections[1].userEdited=false;
 expect(()=>mergeWikiTopics(session,[page,page])).toThrow("Invalid");expect(mergeWikiTopics(session,[]).sections).toEqual(session.sections);
});

it("does not resurrect a deleted personal note when another merged chapter has a live note",()=>{
 const session=contextKnowledge().session;session.sections[1].kind="finding";
 session.sectionNotes={database:{text:"已删除笔记",evidenceIds:[],updatedAt:1,deletedAt:2},sidebar:{text:"仍保留的笔记",evidenceIds:[],updatedAt:3}};
 const next=mergeWikiTopics(session,[page]);expect(next.sectionNotes!.database.text).toBe("仍保留的笔记");expect(next.sectionNotes!.database.deletedAt).toBeUndefined();
 expect(next.wikiMergeHistory![0].sectionNotes!.database.deletedAt).toBe(2);
});
