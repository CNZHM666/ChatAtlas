import {afterEach,expect,it,vi} from "vitest";
import {act,cleanup,fireEvent,render,screen} from "@testing-library/react";
import {PreviewContent} from "./PreviewContent";
afterEach(()=>{cleanup();vi.useRealTimers();vi.unstubAllGlobals();});
it("does not mount offscreen Markdown and cancels queued work when unmounted",()=>{
 vi.useFakeTimers();let notify:IntersectionObserverCallback=()=>{};
 const disconnect=vi.fn();
 vi.stubGlobal("IntersectionObserver",class {constructor(callback:IntersectionObserverCallback){notify=callback;}observe(){}disconnect=disconnect;});
 const build=vi.fn();function Expensive(){build();return <p>正文</p>;}
 const view=render(<PreviewContent raw="正文" zh><Expensive/></PreviewContent>);
 expect(build).not.toHaveBeenCalled();expect(screen.getByRole("status")).toBeVisible();
 act(()=>notify([{isIntersecting:true}] as IntersectionObserverEntry[],{} as IntersectionObserver));
 expect(build).not.toHaveBeenCalled();view.unmount();act(()=>vi.runAllTimers());expect(build).not.toHaveBeenCalled();
});
it("renders visible content after the shell and isolates failure with a raw-text recovery",()=>{
 vi.useFakeTimers();vi.stubGlobal("IntersectionObserver",undefined);
 const silence=(event:ErrorEvent)=>{if(event.message.includes("bad markup"))event.preventDefault();};window.addEventListener("error",silence);
 function Broken():never{throw new Error("bad markup");}
 render(<><PreviewContent raw="保留的原始正文" zh><Broken/></PreviewContent><PreviewContent raw="其他章节" zh><p>其他章节正常</p></PreviewContent></>);
 expect(screen.queryByText("其他章节正常")).toBeNull();
 act(()=>vi.runAllTimers());expect(screen.getByText("其他章节正常")).toBeVisible();expect(screen.getByRole("alert")).toHaveTextContent("草稿仍然保留");
 fireEvent.click(screen.getByText("查看原始正文"));expect(screen.getByText("保留的原始正文")).toBeVisible();window.removeEventListener("error",silence);
});

it("opens a preview immediately when its text button is clicked",()=>{
 vi.stubGlobal("IntersectionObserver",class {observe(){}disconnect(){}});
 render(<PreviewContent raw="章节草稿" zh><p>章节草稿</p></PreviewContent>);
 expect(screen.getByRole("status")).toHaveTextContent("正在准备预览");
 expect(screen.queryByText("章节草稿")).toBeNull();
 fireEvent.click(screen.getByRole("button",{name:"立即查看"}));
 expect(screen.getByText("章节草稿")).toBeVisible();
 expect(screen.queryByRole("status")).toBeNull();
});
