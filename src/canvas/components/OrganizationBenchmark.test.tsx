import {afterEach,expect,it,vi} from "vitest";
import {cleanup,fireEvent,render,screen,waitFor} from "@testing-library/react";
import {OrganizationBenchmark} from "./OrganizationBenchmark";

afterEach(()=>{cleanup();vi.restoreAllMocks();});
const csv=(requests:number)=>`requests,input_tokens,output_tokens,failed_requests\n${requests},100,20,0\n`;
function upload(label:string,content:string){const file=new File([content],"metrics.csv",{type:"text/csv"});Object.defineProperty(file,"text",{value:async()=>content});fireEvent.change(screen.getByLabelText(label),{target:{files:[file]}});}
it("compares two local files directly and exports a result without running a model",async()=>{
 const click=vi.spyOn(HTMLAnchorElement.prototype,"click").mockImplementation(()=>undefined);vi.spyOn(URL,"createObjectURL").mockReturnValue("blob:test");vi.spyOn(URL,"revokeObjectURL").mockImplementation(()=>undefined);
 render(<OrganizationBenchmark zh/>);upload("优化前 CSV",csv(4));upload("优化后 CSV",csv(3));
 await waitFor(()=>expect(screen.getByRole("table")).toHaveTextContent("-1 (-25.0%)"));
 fireEvent.click(screen.getByRole("button",{name:"导出对比结果"}));expect(click).toHaveBeenCalledOnce();
 upload("优化后 CSV","invalid");await screen.findByRole("alert");expect(screen.queryByRole("table")).toBeNull();
});
it("shows readable English errors for unsupported files",async()=>{
 render(<OrganizationBenchmark zh={false}/>);upload("Before CSV","bad");expect(await screen.findByRole("alert")).toHaveTextContent("valid analysis CSV");
});
