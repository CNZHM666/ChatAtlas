import { expect,it } from "vitest";
import { diagramSvg } from "./diagram-svg";
it("exports source names as inert text with real geometry and the requested theme",()=>{
 const svg=diagramSvg({width:320,height:140,groups:[],links:[{id:"edge",paths:["M20,20L50,20"],labels:[]}],nodes:[{id:"a",x:24,y:30,width:240,height:90}]},[{id:"a",title:'<script>alert("raw")</script>',body:"",responsibility:"本地读取消息 & 保留原文",transition:"",kind:"finding",evidenceIds:[]}],{background:"#18181b",surface:"#27272a",text:"#fafafa",muted:"#a1a1aa",border:"#52525b"});
 const doc=new DOMParser().parseFromString(svg,"image/svg+xml");expect(doc.querySelector("parsererror")).toBeNull();expect(doc.querySelector("script")).toBeNull();expect(doc.querySelector("foreignObject")).toBeNull();expect(svg).toContain('viewBox="0 0 320 140"');expect(svg).toContain('fill="#18181b"');expect(doc.querySelector("g title")?.textContent).toContain('<script>alert("raw")</script>');
});
