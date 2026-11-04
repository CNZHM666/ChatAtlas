import {useRef,useState} from "react";
import {afterEach,expect,it,vi} from "vitest";
import {cleanup,fireEvent,render,screen,waitFor,within} from "@testing-library/react";
import {PreviewChapterLocator} from "./PreviewChapterLocator";
afterEach(()=>{cleanup();vi.restoreAllMocks();});
it("tracks only rendered chapters when switching between changes and the full preview",async()=>{
 function Harness(){const root=useRef<HTMLDivElement>(null),[all,setAll]=useState(false);return <main><button onClick={()=>setAll(!all)}>查看全部</button><div ref={root}>{["第一章","第二章",...(all?["第三章"]:[])].map(title=><section className="wiki-chapter-preview" key={title}><header className="wiki-chapter-preview-heading"><h2>{title}</h2></header><h3>正文标题</h3></section>)}</div><PreviewChapterLocator contentRef={root} zh/></main>;}
 render(<Harness/>);const nav=await screen.findByRole("navigation",{name:"预览章节切换"});expect(within(nav).getAllByRole("button")).toHaveLength(2);expect(within(nav).queryByText("正文标题")).toBeNull();
 fireEvent.click(screen.getByRole("button",{name:"查看全部"}));await waitFor(()=>expect(within(nav).getAllByRole("button")).toHaveLength(3));
 const heading=screen.getByRole("heading",{name:"第三章"}),scroll=vi.fn();Object.defineProperty(heading,"scrollIntoView",{value:scroll});
 fireEvent.click(within(nav).getByRole("button",{name:"第三章"}));expect(scroll).toHaveBeenCalled();expect(heading).toHaveFocus();
 fireEvent.click(screen.getByRole("button",{name:"查看全部"}));await waitFor(()=>expect(within(nav).getAllByRole("button")).toHaveLength(2));
});
