import {expect,it} from "vitest";
import {wikiWritingOrder,wikiCompletionOutputLimit,wikiBudgetedCompletionLimit,opensWikiChapter} from "./wiki-writing-batches";
import type {OwnedMaterial} from "./focus-coverage";

const notes:OwnedMaterial[]=Array.from({length:5},(_,i)=>({id:`n${i}`,wikiOwnerId:i%2?"b":"a",conversationId:"c",sourceConversationIds:["c"],messageId:`m${i}`,title:"笔记",text:`完整条件 ${i}`,rawEvidenceIds:[`e${i}`]}));
it("opens a split chapter only at its first material descendant",()=>{
 for(const id of ["n0","n0:1","n0:1:output-0"])expect(opensWikiChapter(id,"n0")).toBe(true);
 for(const id of ["n1","n0:2","n0:output-1","n00","n0:1:output-1"])expect(opensWikiChapter(id,"n0")).toBe(false);
});
it("co-locates one owner's related notes without losing text, source identities or ordering inside a subject",()=>{
 const before=structuredClone(notes);
 const result=wikiWritingOrder(notes,[{ownerId:"a",title:"同步",group:"",question:"同步",sectionIds:["n0","n2","n4"],subtopics:[{title:"确认",question:"确认",sectionIds:["n4","n2"]},{title:"读取",question:"读取",sectionIds:["n0"]}]},{ownerId:"b",title:"阅读",group:"",question:"阅读",sectionIds:["n1","n3"]}]);
 expect(result.map(group=>group.map(note=>note.id))).toEqual([["n2","n4","n0"],["n1","n3"]]);
 expect(result.flat().map(note=>note.id).sort()).toEqual(notes.map(note=>note.id).sort());expect(notes).toEqual(before);
 const unknown={...notes[0],id:"unknown",wikiOwnerId:"unknown"};expect(wikiWritingOrder([...notes,unknown],[]).flat()).toContain(unknown);
});
it("reserves less output for a small supplement and retains normal room for rich or code-heavy evidence",()=>{
 expect(wikiCompletionOutputLimit(5000,[notes[0]],1)).toBe(2400);
 expect(wikiCompletionOutputLimit(5000,[{...notes[0],text:"条件".repeat(20000)}],1)).toBe(5000);
 expect(wikiCompletionOutputLimit(5000,[{...notes[0],text:"```ts\nconst keep=true;\n```"}],1)).toBe(5000);
});

it("fits the last prose supplement into 3000 remaining tokens without granting more allowance or squeezing code",()=>{
 const rich=[{...notes[0],text:"完整条件".repeat(5000)}];
 expect(wikiBudgetedCompletionLimit(5000,rich,1,3000)).toBe(3000);
 expect(wikiBudgetedCompletionLimit(5000,rich,1,2399)).toBe(5000);
 expect(wikiBudgetedCompletionLimit(5000,rich,3,3000)).toBe(5000);
 expect(wikiBudgetedCompletionLimit(5000,[{...rich[0],text:"```ts\n// complete source code\n```"}],1,3000)).toBe(5000);
});
