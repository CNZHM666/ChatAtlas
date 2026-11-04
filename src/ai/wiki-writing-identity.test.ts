import {expect,it} from "vitest";
import {enrichWikiWritingNotes,refreshWikiWritingNotes} from "./wiki-writing-details";
import {assignWikiOwners,wikiWritingOrder} from "./wiki-writing-batches";
import {wikiMaterialKey} from "./wiki-project-scope";
import type {CoverageMaterial} from "./focus-coverage";
import type {ProjectState} from "../shared/project-state";

const material=(id:string,text:string):CoverageMaterial=>({id,text,title:id,conversationId:"c",sourceConversationIds:["c"],messageId:"m",rawEvidenceIds:["e1"]});
const batch=[{...material("e1","user: 索引按消息维护。失败时保留原始消息。"),role:"user"}];
const facts=(quote:string)=>({modules:[],relations:[],decisions:[{id:"decision",text:quote,quote,evidenceIds:["e1"],status:"discussed"}],constraints:[],questions:[],history:[]}) as unknown as ProjectState;
const section=(note:CoverageMaterial)=>({id:note.id,title:note.title,body:note.text,evidenceIds:note.rawEvidenceIds,kind:"finding" as const,transition:""});

it("refreshes changed proofs inside the catalogue's IDs and preserves original scope keys",()=>{
 const catalogue=enrichWikiWritingNotes([material("n1","检索说明"),material("n2","存储说明")],facts("索引按消息维护"),batch);
 const original=structuredClone(catalogue),keys=catalogue.map(note=>wikiMaterialKey(section(note)));
 const plan=[{ownerId:"chapter",title:"保存规则",question:"如何保存？",group:"",sectionIds:catalogue.map(note=>note.id)}];
 const writing=refreshWikiWritingNotes(assignWikiOwners(catalogue,plan),facts("失败时保留原始消息"),batch);
 expect(writing.map(note=>note.id)).toEqual(catalogue.map(note=>note.id));
 expect(writing.some(note=>note.text.includes("失败时保留原始消息"))).toBe(true);
 expect(catalogue).toEqual(original);
 expect(catalogue.map(note=>wikiMaterialKey(section(note)))).toEqual(keys);
 expect(wikiWritingOrder(assignWikiOwners(writing,plan),plan).flat().every(note=>note.wikiOwnerId==="chapter")).toBe(true);
 // A previously excluded candidate is filtered using the unchanged catalogue,
 // before the writing-only refresh. It cannot reappear under a fresh proof ID.
 const removed=keys.at(-1)!;
 const included=catalogue.filter(note=>wikiMaterialKey(section(note))!==removed);
 const refreshed=refreshWikiWritingNotes(included,facts("失败时保留原始消息"),batch);
 expect(refreshed.map(note=>note.id)).toEqual(included.map(note=>note.id));
 expect(refreshed.some(note=>note.id===catalogue.at(-1)!.id)).toBe(false);
});

it("keeps every planned ID and valid owner across ambiguous note counts and changed facts",()=>{
 for(let count=1;count<=12;count++){
  const notes=Array.from({length:count},(_,index)=>material(`n${index}`,`讨论 ${index}`));
  const catalogue=enrichWikiWritingNotes(notes,facts("索引按消息维护"),batch);
  const pages=[{ownerId:"chapter",title:"规则",question:"?",group:"",sectionIds:catalogue.map(note=>note.id)}];
  for(const quote of ["索引按消息维护","失败时保留原始消息",""]){
   const writing=assignWikiOwners(refreshWikiWritingNotes(assignWikiOwners(catalogue,pages),facts(quote),batch),pages);
   expect(writing.map(note=>note.id)).toEqual(catalogue.map(note=>note.id));
   expect(writing.every(note=>note.wikiOwnerId==="chapter")).toBe(true);
   expect(new Set(wikiWritingOrder(writing,pages).flat().map(note=>note.id)).size).toBe(writing.length);
  }
 }
});

it("rejects unowned materials without an outline at the typed writing boundary",()=>{
 expect(()=>assignWikiOwners([material("n","原文")],[])).toThrow("valid chapter outline");
 expect(assignWikiOwners([],[])).toEqual([]);
});
