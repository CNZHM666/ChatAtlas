import {expect,it} from "vitest";
import {wikiDisplayGroups,wikiReadingQuestion} from "./wiki-display-groups";
it("hides groups under eight chapters, merges singleton runs and repeats consecutive names once",()=>{
 const groups=["甲","甲","单章","甲","甲","乙","乙","尾章"].map((name,index)=>({name,index}));
 const before=structuredClone(groups),result=wikiDisplayGroups(groups,item=>item.name);
 expect(result.map(group=>[group.name,group.pages.map(item=>item.index)])).toEqual([["甲",[0,1,2,3,4]],["乙",[5,6,7]]]);
 expect(wikiDisplayGroups(groups.slice(0,7),item=>item.name)).toEqual([{name:"",pages:groups.slice(0,7)}]);
 expect(groups).toEqual(before);expect(result[0].pages[0]).toBe(groups[0]);
});
it("handles leading singletons and all-singleton groups without reordering",()=>{
 const names=["起章","甲","甲","乙","乙","乙","乙","乙"];
 expect(wikiDisplayGroups(names,item=>item).map(group=>[group.name,group.pages.length])).toEqual([["甲",3],["乙",5]]);
 expect(wikiDisplayGroups(Array.from({length:8},(_,i)=>String(i)),item=>item)).toEqual([{name:"",pages:Array.from({length:8},(_,i)=>String(i))}]);
 expect(wikiReadingQuestion("  标题  ","标题")).toBeUndefined();expect(wikiReadingQuestion("如何读取？","读取")).toBe("如何读取？");
});
