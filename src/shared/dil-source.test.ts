import { describe, expect, it } from "vitest";
import { dilPayload, dilRanges, dilSummary } from "./dil-source";
import { messagePresentation } from "./message-ui";

const component = [
  '{@body const [sections,setSections]=DIL.useState(["summary","decisions"])} {@body const [depth,setDepth]=DIL.useState("standard")} {@body const options=[{id:"summary",title:"项目背景与目标",detail:"让 AI 快速了解这是一个什么项目"},{id:"decisions",title:"已确认技术决策",detail:"避免反复讨论已经确定的方案"}]} {@body const preview=()=>["# Atlas 项目上下文",`上下文长度：${depth==="short"?"精简":"标准"}`,...options.filter(o=>sections.includes(o.id)).map(o=>`## ${o.title}\\n${o.detail}`)].join("\\n\\n")}',
  "",
  "<col gap={12}>",
  '<title>选择要带走的信息</title>',
  "{#each options as opt}",
  "",
  "<checkbox lineThrough={false} checked={sections.includes(opt.id)} onChange={checked=>setSections(s=>checked?[...s,opt.id]:s.filter(x=>x!==opt.id))}>",
  "",
  "{opt.title} {opt.detail}",
  "",
  "</checkbox>",
  "",
  "{/each}",
  "",
  '<segmented-control value={depth} onChange={setDepth} label="上下文长度" />',
  "",
  "<caption>已选择 {sections.length} 个部分</caption>",
  "",
  "<button block disabled={sections.length===0} onClick={()=>GenUI.copy(preview())}>复制上下文示例</button>",
  "</col>",
].join("\n");
const message = `用户在 Atlas Dashboard 点击「用于 AI」，弹出一个简洁面板。\n\n${component}\n\n桌面扩展中，用户选择完后，可以有三个出口。`;

describe("ChatGPT component source", () => {
  it("finds exactly the component between the surrounding prose", () => {
    const [range] = dilRanges(message);
    expect(message.slice(range.start, range.end)).toBe(component);
  });

  it("summarizes the title, labelled options, captions and actions without running the script", () => {
    expect(dilSummary(component)).toEqual({
      title: "选择要带走的信息",
      items: ["项目背景与目标 — 让 AI 快速了解这是一个什么项目", "已确认技术决策 — 避免反复讨论已经确定的方案", "上下文长度", "已选择 … 个部分"],
      actions: ["复制上下文示例"],
    });
  });

  it("presents the prose as text and the component as one folded part", () => {
    const parts = messagePresentation(message, undefined);
    expect(parts.map(part => part.kind)).toEqual(["text", "ui", "text"]);
    expect(parts[1].kind === "ui" && dilPayload(parts[1].raw)).toBe(component);
  });

  it("leaves ordinary text, code examples and user messages alone", () => {
    expect(dilRanges("Use <text> tags and {braces} in prose.")).toEqual([]);
    expect(dilRanges("```\n{@body const a=DIL.useState(1)}\n<button>Go</button>\n```")).toEqual([]);
    expect(messagePresentation(message, undefined, true)).toEqual([{ kind: "text", text: message }]);
  });
});
