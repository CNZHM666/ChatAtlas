import {expect,it} from "vitest";
import {createWikiRepairBudget} from "./wiki-repair-budget";

it("limits one logical window to four repairs while unrelated windows keep their own allowance",()=>{
 const budget=createWikiRepairBudget(),first=budget.window(false),second=budget.window(false);
 for(let index=0;index<4;index++)expect(first.reserve(1600)).toBeTypeOf("function");
 expect(first.reserve(1600)).toBeUndefined();expect(second.reserve(1600)).toBeTypeOf("function");expect(budget.count).toBe(5);
});

it("caps all local windows together and reserves a separate bounded pool for final reconciliation",()=>{
 const budget=createWikiRepairBudget();
 for(let index=0;index<30;index++)expect(budget.window(false).reserve(800)).toBeTypeOf("function");
 expect(budget.window(false).reserve(800)).toBeUndefined();
 for(let index=0;index<4;index++)expect(budget.window(true).reserve(1600)).toBeTypeOf("function");
 expect(budget.window(true).reserve(1600)).toBeUndefined();expect(budget.count).toBe(34);expect(budget.tokens).toBe(30400);
});

it("reserves concurrent output ceilings immediately and enforces each pool's token cap",()=>{
 const budget=createWikiRepairBudget();
 for(let index=0;index<4;index++)expect(budget.window(false).reserve(6000)).toBeTypeOf("function");
 expect(budget.window(false).reserve(1600)).toBeUndefined();expect(budget.window(true).reserve(3200)).toBeTypeOf("function");
 expect(budget.tokens).toBe(27200);
});

it("refunds validated cache progress once to both the window and its pool",()=>{
 const budget=createWikiRepairBudget(),window=budget.window(false);
 const credit=window.reserve(1600)!;credit();credit();expect(budget.count).toBe(0);expect(budget.tokens).toBe(0);
 for(let index=0;index<4;index++)expect(window.reserve(1600)).toBeTypeOf("function");
 expect(window.reserve(1600)).toBeUndefined();expect(budget.count).toBe(4);expect(budget.tokens).toBe(6400);
});
