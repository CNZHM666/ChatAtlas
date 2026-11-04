import { expect, it } from "vitest";
import { runProjectLocalChecks } from "./project-local-checks";
import { projectTestCases, projectTestPhases, projectTestPlanMarkdown } from "./project-test-plan";

it("runs isolated local checks without certifying manual AI cases or changing existing storage",()=>{
 localStorage.setItem("untouched-project-marker","original");
 const results=runProjectLocalChecks();
 expect(results.filter(item=>!item.passed)).toEqual([]);
 expect(results).toHaveLength(19);
 expect(results.every(item=>item.durationMs>=0)).toBe(true);
 expect(localStorage.getItem("untouched-project-marker")).toBe("original");
});
it("provides unique staged procedures with prerequisites, actions and acceptance criteria",()=>{
 expect(projectTestCases).toHaveLength(48);
 expect(new Set(projectTestCases.map(item=>item.id)).size).toBe(projectTestCases.length);
 for(const phase of Object.keys(projectTestPhases))expect(projectTestCases.some(item=>item.phase===phase)).toBe(true);
 expect(projectTestCases.every(item=>item.steps.length>0&&item.expected.length>0&&item.setup[0])).toBe(true);
 expect(projectTestPlanMarkdown()).toContain("本地通过不代表真实 AI 阶段通过");
 expect(projectTestPlanMarkdown()).toContain("S09");
});
