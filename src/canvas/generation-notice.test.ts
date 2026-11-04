import {expect,it} from "vitest";
import {generationFailureReason} from "./generation-notice";

it("explains a connection that never opened instead of the generic failure",()=>{
 expect(generationFailureReason("Failed to fetch",undefined,true)).toMatch(/^连不上 AI 服务/u);
 expect(generationFailureReason("",`NETWORK_USAGE_UNKNOWN`,false)).toMatch(/^Could not reach the AI service/u);
 // Other English messages keep the generic fallback in Chinese.
 expect(generationFailureReason("Something else",undefined,true)).toBe("操作未完成，请重试。详细原因可在诊断信息中查看。");
});
