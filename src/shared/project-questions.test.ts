import { expect, it } from "vitest";
import { projectSession } from "../test/project-fixture";
import { projectOpenQuestions, projectQuestionItems, projectQuestionKey } from "./project-state";
import { projectStateMarkdown } from "./project-state-markdown";
import { carryReviewNotes } from "../canvas/review-notes";

it("keeps a manual resolution across changed model IDs and reopens without inventing evidence", () => {
  const session = projectSession();
  session.projectState!.questions = [{ ...session.projectState!.constraints[0], id: "question:release", text: "发布范围？", status: "uncertain" }];
  session.brief = { summary: "", confirmed: [], turningPoints: [], openQuestions: ["发布范围？"] };
  session.projectMaintenance = { questions: { [projectQuestionKey("发布范围？")]: { text: "发布范围？", resolved: true, resolvedAt: 123, sources: session.evidence } } };
  const next = structuredClone(session); next.id = "new"; next.projectState!.questions![0].id = "new-question-id";
  Object.assign(next, carryReviewNotes(session, next, true));
  expect(projectOpenQuestions(next)).toEqual([]);
  expect(projectQuestionItems(next)).toHaveLength(1);
  expect(projectStateMarkdown(next, true)).toContain("用户标记解决");
  next.projectMaintenance!.questions![projectQuestionKey("发布范围？")].resolved = false;
  expect(projectOpenQuestions(next)).toEqual(["发布范围？"]);
  next.projectState!.questions![0].text = "新版本发布范围？";
  expect(projectOpenQuestions(next)).toContain("新版本发布范围？");
});

it("retains resolved legacy questions after AI omission and lets the user reopen an AI answer", () => {
  const session = projectSession(); session.projectMaintenance = { questions: { [projectQuestionKey("旧问题")]: { text: "旧问题", resolved: true, sources: session.evidence } } };
  expect(projectQuestionItems(session)[0]).toMatchObject({ text: "旧问题", resolved: true, sources: session.evidence });
  session.projectState!.questions = [{ ...session.projectState!.constraints[0], text: "已回答", status: "superseded" }];
  session.projectMaintenance.questions![projectQuestionKey("已回答")] = { text: "已回答", resolved: false };
  expect(projectOpenQuestions(session)).toEqual(["已回答"]);
});
