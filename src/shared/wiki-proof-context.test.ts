import {expect,it} from "vitest";
import {wikiProofContext} from "./wiki-proof-context";
import {wikiScopeContent} from "./wiki-scope-content";

it("keeps historical headings and server-only prerequisites around a short credential quote",()=>{
 const source="## 历史代理方案\n\n只有经过服务器代理时：\n\n如果启用代理，密钥仅在单次请求内存中存在，不写入磁盘。\n\n## 客户端模式\n\n用户仍可在会话中使用自己的密钥。";
 const result=wikiProofContext(source,"密钥仅在单次请求内存中存在");
 expect(result.text).toBe("## 历史代理方案\n\n只有经过服务器代理时：\n\n如果启用代理，密钥仅在单次请求内存中存在，不写入磁盘。");
 expect(wikiProofContext("很长的前提".repeat(1000)+"密钥只能在内存中。","密钥只能在内存中。",100)).toEqual({omitted:true});
});

it("renders the whole material and its full scoped conditions without exposing internal inventory JSON",()=>{
 const context="如果经过代理，Key 仅在该请求内存中存在。";
 const body="密钥的运行边界。\n\nSOURCE DETAIL INVENTORY:\n"+JSON.stringify({details:[{kind:"constraint"}],originals:{q:{text:"Key 仅在该请求内存中存在",context}}});
 expect(wikiScopeContent(body)).toBe("密钥的运行边界。\n\n"+context);
 const code="```ts\nif (proxy) useKey();\n```";expect(wikiScopeContent(code)).toBe(code);
});
