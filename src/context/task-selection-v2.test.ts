import { expect, it } from "vitest";
import {boundaryEvidence,proposalEvidence} from "./boundary-evidence";

it("keeps the selected option and short approval without exporting the other option or a long unrelated reply",()=>{
 const content="背景介绍。".repeat(70)+"\n\n方案一：上传全部聊天。\n方案二：保留本地消息，不自动上传。\n方案三：只做云端索引。";
 expect(proposalEvidence(content,"保留本地消息，不自动上传。")).toBe("方案二：保留本地消息，不自动上传。");
 const raw="无关背景。".repeat(80)+"第一版先支持 ESP32，不做 PCB。因为需要先验证模块级方案。"+"其他示例。".repeat(80);
 const windows=boundaryEvidence("首版只支持 ESP32，不做 PCB",raw,raw);expect(windows.join("\n")).toContain("第一版先支持 ESP32，不做 PCB");expect(windows.join("\n")).toContain("因为需要先验证模块级方案");expect(windows.join("\n").length).toBeLessThan(180);expect(windows.every(text=>raw.includes(text))).toBe(true);
});
