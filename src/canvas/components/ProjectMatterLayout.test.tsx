import {afterEach,expect,it} from "vitest";

afterEach(()=>{document.head.querySelectorAll("style[data-layout-check]").forEach(style=>style.remove());document.body.innerHTML="";});

it("keeps checkboxes and clipped row headings aligned after the shared input and legacy list rules",async()=>{
 const moduleName="node:fs",{readFileSync}=await import(/* @vite-ignore */ moduleName);
 const projectStyles=readFileSync("src/canvas/project-outcome.css","utf8"),readingStyles=readFileSync("src/canvas/reading-workspace.css","utf8"),baseStyles=readFileSync("src/canvas/styles.css","utf8");
 const style=document.createElement("style");style.dataset.layoutCheck="true";
 style.textContent=baseStyles+readingStyles+projectStyles;document.head.append(style);
 document.body.innerHTML='<div class="focus-workspace"><section class="project-items-workspace"><div class="project-matter-list is-simple"><ul><li class="project-items-selectable"><input type="checkbox"><button class="project-matter-heading"><span class="project-matter-row-copy"><span class="project-matter-title">LocalInterpreter 与 LLMInterpreter 的路由阈值</span><span class="project-matter-row-preview">待核对</span></span><small hidden></small><svg></svg></button></li></ul></div></section></div>';
 const row=document.querySelector("li")!,checkbox=document.querySelector("input")!,heading=document.querySelector("button")!;
 expect(getComputedStyle(row).display).toBe("grid");expect(getComputedStyle(heading).height).toBe("88px");
 expect(getComputedStyle(checkbox).width).toBe("16px");expect(getComputedStyle(checkbox).marginBottom).toBe("0px");
 expect(getComputedStyle(document.querySelector(".project-matter-title")!).display).toBe("-webkit-box");
});
