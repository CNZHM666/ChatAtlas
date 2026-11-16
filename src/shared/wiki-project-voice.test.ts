import {expect,it} from "vitest";
import {wikiProjectVoice} from "./wiki-project-voice";
it("distinguishes the project author from target users without touching UI quotes or code",()=>{
 const body='你曾担心市场太小。用户认为硬件AI与自身专业相关。〔你〕\n\n用户点击节点后确认元件。“你今天想做什么？”\n\n```text\n你曾希望这样显示\n```';
 const result=wikiProjectVoice(body);
 expect(result).toContain('项目发起人曾担心');expect(result).toContain('项目发起人认为');expect(result).toContain('〔发起人〕');
 expect(result).toContain('用户点击节点');expect(result).toContain('“你今天想做什么？”');expect(result).toContain('```text\n你曾希望这样显示\n```');
 expect(wikiProjectVoice(result)).toBe(result);
});
it("gives generated flow labels an independent voice while preserving quoted and literal labels",()=>{
 const literal='```text\n你的 AI\n```',body='1. 你的 AI\n2. 生成方案\n\n“你的 AI”\n\n'+literal;
 const result=wikiProjectVoice(body);
 expect(result).toContain('1. 项目中的 AI');expect(result).toContain('“你的 AI”');expect(result).toContain(literal);
});
