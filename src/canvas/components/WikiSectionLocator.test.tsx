import {useRef} from "react";
import {afterEach,expect,it,vi} from "vitest";
import {cleanup,fireEvent,render,screen,waitFor,within} from "@testing-library/react";
import {WikiSectionLocator} from "./WikiSectionLocator";

afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();});
function Harness(){
 const content=useRef<HTMLDivElement>(null),root=useRef<HTMLElement>(null);
 return <section style={{position:"relative"}}><main ref={root} data-testid="reading-viewport"><div ref={content}><div className="chapter-guide"><h2>输入</h2><p>完整输入条件。</p><h3>补充条件</h3><p>不新增一级导航项。</p><h2>输出</h2><p>最后的小节较短。</p></div></div></main><WikiSectionLocator contentRef={content} scrollRef={root} zh headings={[{title:"输入",depth:2,headingIndex:0},{title:"补充条件",depth:3,headingIndex:1},{title:"输出",depth:2,headingIndex:2}]}/></section>;
}
it("tracks the final short section at the scroll limit and keeps keyboard navigation usable",async()=>{
 vi.stubGlobal("requestAnimationFrame",(callback:FrameRequestCallback)=>window.setTimeout(()=>callback(performance.now()),0));
 vi.stubGlobal("cancelAnimationFrame",(id:number)=>window.clearTimeout(id));
 render(<Harness/>);
 const root=screen.getByTestId("reading-viewport"),lastHeading=screen.getByRole("heading",{name:"输出"}),scroll=vi.fn();
 Object.defineProperties(root,{scrollHeight:{configurable:true,value:1000},clientHeight:{configurable:true,value:600},scrollTop:{configurable:true,value:400}});
 vi.spyOn(root,"getBoundingClientRect").mockReturnValue(new DOMRect(0,0,800,600));
 vi.spyOn(lastHeading,"getBoundingClientRect").mockReturnValue(new DOMRect(0,260,400,40));
 Object.defineProperty(lastHeading,"scrollIntoView",{value:scroll});
 const navigation=screen.getByRole("navigation",{name:"本章快捷导航"}),first=within(navigation).getByRole("button",{name:"输入"}),last=within(navigation).getByRole("button",{name:"输出"});
 fireEvent.scroll(root);
 await waitFor(()=>expect(last).toHaveAttribute("aria-current","location"));
 expect(within(navigation).queryByRole("button",{name:"补充条件"})).toBeNull();
 first.focus();fireEvent.keyDown(first,{key:"ArrowDown"});expect(last).toHaveFocus();
 fireEvent.keyDown(last,{key:"Home"});expect(first).toHaveFocus();
 fireEvent.keyDown(first,{key:"End"});expect(last).toHaveFocus();
 fireEvent.keyDown(last,{key:"Escape"});expect(lastHeading).toHaveFocus();expect(scroll).not.toHaveBeenCalled();
 vi.stubGlobal("matchMedia",()=>({matches:true}));
 fireEvent.click(last);expect(scroll).toHaveBeenCalledWith({block:"start",behavior:"instant"});
});
