import {expect,it} from "vitest";
import {plainBlockLayout} from "./wiki-plain-block";

it("does not infer parallel terms or category headings from short lines",()=>{
 for(const text of ["Base URL\nAPI Key\nModel ID","我的零件\nESP32 ×1\nDHT22 ×1","VERIFIED\n或\nNEEDS_REVIEW 但允许继续","data/components/\nboards/\nsensors/","ESP32\nDHT22\nOLED\n\nButton\nLED\nPIR"])
  expect(plainBlockLayout(text)).toBeUndefined();
});

it("preserves explicit parameter and role/value relationships rather than alternating bullets",()=>{
 const palette=plainBlockLayout("App Background   #FAFAFA\nCanvas   #FCFCFC / #FFFFFF\nMuted   #71717A\nAccent   克制蓝紫")!;
 expect(palette.kind).toBe("table");expect(palette.markdown).toContain("| Canvas | `#FCFCFC / #FFFFFF` |");expect(palette.markdown).toContain("| Accent | 克制蓝紫 |");
 const roles=plainBlockLayout("Interpreter\n负责理解需求\nExecutor\n负责确定性执行")!;
 expect(roles.kind).toBe("table");expect(roles.markdown).toContain("| Interpreter | 负责理解需求 |");expect(roles.markdown).toContain("| Executor | 负责确定性执行 |");
});
it("keeps categories intact and leaves uncertain prose alone",()=>{
 const singleton=plainBlockLayout("输入：\nButton\n\n输出：\nLED\n\n驱动：\nRelay")!;
 expect(singleton.kind).toBe("table");expect(singleton.markdown).toContain("| 输入 | Button |");
 const grouped=plainBlockLayout("输入：\nButton\nPotentiometer\n\n输出：\nLED\nBuzzer")!;
 expect(grouped.kind).toBe("groups");expect(grouped.markdown).toBe("**输入：**\n\n- Button\n- Potentiometer\n\n**输出：**\n\n- LED\n- Buzzer");
 expect(plainBlockLayout("这是第一句解释。\n这是一句补充说明。\n\n这是第二段。\n另一句解释。")).toBeUndefined();
});
it("shows action labels and UI progress copy compactly without inventing functionality",()=>{
 expect(plainBlockLayout("Add component\nRun validation\nFit canvas\nToggle theme")?.markdown).toBe("Add component · Run validation · Fit canvas · Toggle theme");
 expect(plainBlockLayout("Step 1 / 5\nStep 2 / 5")?.markdown).toBe("进度文案示例：`Step 1 / 5` · `Step 2 / 5`");
 expect(plainBlockLayout("Step 1 / 5\nStep 2 / 5",false)?.markdown).toContain("Progress copy examples");
});
it("keeps every step and refuses to flatten branches",()=>{
 expect(plainBlockLayout("Input\n↓\nValidate\n↓\nCommit")?.markdown).toBe("Input → Validate → Commit");
 const steps=Array.from({length:8},(_,at)=>"Stage "+(at+1));
 const long=plainBlockLayout(steps.join("\n↓\n"))!;
 expect(long.kind).toBe("flow");expect(long.markdown).toBe(steps.join(" → "));
 expect(plainBlockLayout("Input\n↓\nValid → Commit\nInvalid → Return")).toBeUndefined();
 expect(plainBlockLayout("Input\n↓\n├ Yes\n↓\n└ No")).toBeUndefined();
 expect(plainBlockLayout("Input\n↓\nReview\n→\nCommit")).toBeUndefined();
});
