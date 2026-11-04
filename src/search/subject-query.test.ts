import {expect,it} from "vitest";
import {subjectQueryVariants} from "./subject-query";
import {memoryQueryVariants} from "./memory-query";

it("shares bilingual vocabulary between recall and task selection without changing quoted queries",()=>{
 expect(subjectQueryVariants("继续开发 photo recognition")).toContain("继续开发 视觉识别");
 expect(subjectQueryVariants('查找 "photo recognition"')).toEqual(['查找 "photo recognition"']);
 expect(subjectQueryVariants("photo recognitionBackend")).toEqual(["photo recognitionBackend"]);
 expect(subjectQueryVariants("图像入口",[["图像入口","visual intake"]])).toContain("visual intake");
});
it("keeps query expansion bounded and avoids expanding a shorter name inside a longer subject",()=>{
 const variants=memoryQueryVariants("之前为什么暂时不做实时采购比价");
 expect(variants.length).toBeLessThanOrEqual(8);expect(variants.some(value=>value.includes("price comparison"))).toBe(true);
 expect(variants.some(value=>value.includes("实时实时"))).toBe(false);
});
