import {expect,it} from "vitest";
import {broadRefinement} from "./wiki-broad-refinement";
import type {DirectoryPage} from "../shared/wiki-directory";

const page=(title:string,subtopics=2):DirectoryPage=>({title,question:`${title}是什么？`,group:"",sectionIds:[`${title}-1`],subtopics:Array.from({length:subtopics},(_,index)=>({title:`${title}${index}`,question:"?",sectionIds:[`${title}-${index}`]}))});
const names=["Atlas 项目知识工作区"];

it("renames a document-named chapter when the re-plan finds one concrete subject",()=>{
 // A real run kept "Atlas 项目知识工作区" because the re-plan returned one chapter.
 expect(broadRefinement([page("对话库管理")],names,2)).toMatchObject({reason:"broad_renamed",pages:[{title:"对话库管理"}]});
 expect(broadRefinement([page("Atlas 项目知识工作区")],names,2)).toEqual({reason:"broad_unclear_title"});
 expect(broadRefinement([page("项目总览")],names,2)).toEqual({reason:"broad_unclear_title"});
 expect(broadRefinement(undefined,names,2)).toEqual({reason:"broad_kept"});
});

it("splits only into substantial single-subject chapters that fit under the ceiling",()=>{
 expect(broadRefinement([page("对话库"),page("同步机制")],names,2).reason).toBe("broad_split");
 expect(broadRefinement([page("对话库"),page("同步机制",1)],names,2).reason).toBe("broad_thin_split");
 expect(broadRefinement([page("对话库"),page("同步机制"),page("项目事项")],names,1).reason).toBe("broad_no_room");
});
