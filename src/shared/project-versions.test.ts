import {expect,it} from "vitest";
import {projectVersionLabels} from "./project-versions";
import {projectSession} from "../test/project-fixture";

it("adds the creation time and chapter count only where versions share a title",()=>{
 const base=projectSession(),at=new Date(2026,9,26,10,19).getTime();
 const a={...base,id:"a",title:"硬件AI创作平台",createdAt:at},b={...base,id:"b",title:"硬件AI创作平台",createdAt:at+3_600_000,sections:base.sections.slice(0,1)},c={...base,id:"c",title:"另一项目",createdAt:at};
 const labels=projectVersionLabels([a,b,c],true);
 expect(labels.get("a")).toMatch(new RegExp(`^硬件AI创作平台 · 10/26 10:19 · ${base.sections.length} 章$`,"u"));
 expect(labels.get("b")).toMatch(/^硬件AI创作平台 · 10\/26 11:19 · 1 章$/u);
 expect(labels.get("c")).toBe("另一项目");
 // Made in the same minute: numbered by age, and a pending version says so.
 const same=projectVersionLabels([a,{...a,id:"d",createdAt:at+10_000,status:"preview" as const}],true);
 expect(same.get("a")).toMatch(/第 1 版$/u);expect(same.get("d")).toMatch(/第 2 版 · 待确认$/u);
 expect(projectVersionLabels([c],true,true).get("c")).toMatch(/^另一项目 · 10\/26 10:19/u);
});
