import {afterEach,expect,it} from "vitest";
import {readUiFailures,recordUiFailure,installUiFailureCapture} from "./ui-failure";
afterEach(()=>sessionStorage.clear());
it("keeps bounded metadata without source text, secret-bearing messages or full URLs",()=>{
 const error=new TypeError("PRIVATE_DOCUMENT sk-secret https://provider.invalid?key=secret");
 error.stack='TypeError: PRIVATE_DOCUMENT sk-secret\n at render (chrome-extension://extension-id/assets/reader.js:18:9)';
 for(let i=0;i<30;i++)recordUiFailure(error,"preview-content");
 const rows=readUiFailures(),saved=JSON.stringify(rows);
 expect(rows).toHaveLength(20);expect(rows[0]).toMatchObject({scope:"preview-content",name:"TypeError",frames:["reader.js:18:9"]});
 expect(saved).not.toMatch(/PRIVATE_DOCUMENT|sk-secret|provider.invalid|extension-id/u);
});
it("captures unhandled failures and tolerates corrupt local diagnostic storage",()=>{
 sessionStorage.setItem("atlas-ui-failures-v1","broken");expect(readUiFailures()).toEqual([]);
 const stop=installUiFailureCapture();window.dispatchEvent(new ErrorEvent("error",{error:new RangeError("private")}));stop();
 expect(readUiFailures()[0]).toMatchObject({name:"RangeError",scope:"window",kind:"render"});
});
