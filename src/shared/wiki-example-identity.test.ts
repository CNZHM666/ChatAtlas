import {expect,it} from "vitest";
import {wikiExampleKey,wikiExampleStage,wikiExampleStanding} from "./wiki-example-identity";
it("coalesces formatting variants without merging different strings, operators or indentation-sensitive programs",()=>{
 const key=(text:string,language="ts")=>wikiExampleKey({text,language});
 expect(key('interface Result {\n  ok: boolean;\n}')).toBe(key('interface Result {\n ok: boolean;\n}'));
 expect(key('const x = "a b";')).not.toBe(key('const x = "ab";'));
 expect(key('x + +y')).not.toBe(key('x++y'));
 expect(key('return\nvalue','js')).not.toBe(key('return value','js'));
 expect(key('const x = `a\n  b`;')).not.toBe(key('const x = `a\n b`;'));
 expect(key('const re = /a b/;')).not.toBe(key('const re = /a  b/;'));
 expect(key('if ok:\n  run()','python')).not.toBe(key('if ok:\nrun()','python'));
 expect(key('root\n  child','text')).toBe(key('root\n child','text'));
 expect(key('root\n  child','text')).not.toBe(key('root\nchild','text'));
});

it("does not use a later confirmation to classify the whole example",()=>{
 const caption="*讨论中的原文表格 · AI 建议，未确认；你随后的决定优先：项目发起人确认 v2 仅使用美元*";
 expect(wikiExampleStage(caption)).toBe("");
 expect(wikiExampleStanding(caption)).toBe("discussion");
});
