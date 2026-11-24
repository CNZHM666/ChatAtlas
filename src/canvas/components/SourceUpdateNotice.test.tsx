import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { projectSession } from "../../test/project-fixture";
import { SourceUpdateNotice } from "./SourceUpdateNotice";
afterEach(cleanup);
it("shows newly associated conversations without treating them as already analyzed or starting AI",()=>{
 const update=vi.fn(),session={...projectSession(),sidecarConversationIds:["new","new","source"]};
 render(<SourceUpdateNotice session={session} zh changes={[]} conversations={[]} onUpdate={update}/>);
 expect(screen.getByText("项目有新材料")).toBeVisible();expect(screen.getByText("1 条新关联对话待整理")).toBeVisible();expect(update).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole("button",{name:"选择材料"}));expect(update).toHaveBeenCalledOnce();expect(session.sourceConversationIds).toEqual(["source"]);
});
it("shows source details immediately without starting analysis", () => {
  const update = vi.fn();
  render(<SourceUpdateNotice zh overview changes={[{ conversationId: "c", added: 4, changed: 1, removed: 0, unknown: false, affectedChapterTitles: ["稳定条件"] }]} conversations={[]} onUpdate={update} />);
  expect(screen.getByRole("status")).toHaveTextContent("新增 4 条 · 修改 1 条");
  expect(screen.getAllByText(/修改 1 条/)).toHaveLength(1);
  expect(screen.getByText("涉及章节：稳定条件")).toBeVisible();
  expect(screen.queryByRole("button",{name:"明细"})).toBeNull();
  expect(screen.getByRole("button", { name: "关闭更新提醒" }).textContent).toBe("");
  expect(update).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "开始更新" })); expect(update).toHaveBeenCalledOnce();
});

it("remembers dismissal after reopening and shows different changes with the same count", () => {
  const session = { ...projectSession(), id: "workspace-notice-dismiss" };
  const key = `atlas-workspace-source-update:${session.id}`;
  const change = { conversationId: "source", added: 0, changed: 10, removed: 0, unknown: false, fingerprint: "first" };
  const onUpdate = vi.fn();
  const notice = (fingerprint: string) => <SourceUpdateNotice session={session} zh overview changes={[{ ...change, fingerprint }]} conversations={[]} onUpdate={onUpdate} />;
  localStorage.removeItem(key);
  try {
    const first = render(notice("first"));
    fireEvent.click(screen.getByRole("button", { name: "关闭更新提醒" }));
    expect(screen.queryByText("检测到改动")).toBeNull();
    first.unmount();

    const reopened = render(notice("first"));
    expect(screen.queryByRole("button", { name: "开始更新" })).toBeNull();
    reopened.rerender(notice("second"));
    expect(screen.getByText("修改 10 条")).toBeVisible();
    expect(onUpdate).not.toHaveBeenCalled();
  } finally {
    localStorage.removeItem(key);
  }
});

it("shows a saved decision and the affected Wiki section until the article catches up", () => {
  const session = projectSession();
  const section = session.sections[0];
  section.wikiDisplayTitle = "组件选型";
  section.claims = [{ text: "使用 Starter Kit", quote: "使用 Starter Kit", evidenceIds: [], unitIds: ["pick"] }];
  session.wikiKnowledge = { version: 1, generatedAt: 1, status: "complete", materials: 0, batches: [],
    draft: { version: 1, generatedAt: 2, status: "complete", chapters: [], report: {} },
    decisionsAt: 3, decisions: { pick: { at: 3, verdict: "confirmed" } } };
  const onUpdate = vi.fn();
  const view = render(<SourceUpdateNotice session={session} zh changes={[]} conversations={[]} overview onUpdate={onUpdate}/>);
  expect(screen.getByRole("status")).toHaveTextContent("已保存的决定待写入正文");
  expect(screen.getByText("涉及章节：组件选型")).toBeVisible();
  expect(onUpdate).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "开始更新" }));
  expect(onUpdate).toHaveBeenCalledOnce();
  const updated = { ...session, wikiKnowledge: { ...session.wikiKnowledge, decisionsAt: 2 } };
  view.rerender(<SourceUpdateNotice session={updated} zh changes={[]} conversations={[]} overview onUpdate={onUpdate}/>);
  expect(screen.queryByRole("status")).toBeNull();
});

it("leaves locally applied decisions out of the rewrite notice", () => {
  const session = projectSession();
  session.wikiKnowledge = { version: 1, generatedAt: 1, status: "complete", materials: 0, batches: [],
    draft: { version: 1, generatedAt: 2, status: "complete", chapters: [], report: {} },
    decisionsAt: 3, decisions: { pick: { at: 3, verdict: "confirmed" } },
    decisionArbitrations: { local: { choice: "pick", mode: "choose", at: 3, chapterId: session.sections[0].id, unitIds: ["pick"], locallyApplied: true } } };
  const onUpdate = vi.fn();
  render(<SourceUpdateNotice session={session} zh changes={[]} conversations={[]} overview onUpdate={onUpdate}/>);
  expect(screen.queryByRole("status")).toBeNull();
  expect(onUpdate).not.toHaveBeenCalled();
});

it("suppresses an older inline status reminder when the claimed text already has the saved status", () => {
  const session = projectSession(), text = "首版支持编辑画布。";
  const section = { ...session.sections[0], body: text,
    claims: [{ text, quote: text, evidenceIds: [], unitIds: ["pick"], holder: "decided" as const, holderMark: true, checked: true }] };
  session.sections = [section];
  session.wikiKnowledge = { version: 1, generatedAt: 1, status: "complete", materials: 0, batches: [],
    draft: { version: 1, generatedAt: 2, status: "complete", chapters: [], report: {} },
    decisionsAt: 3, decisions: { pick: { at: 3, verdict: "confirmed" } } };
  const notice = (value: typeof session) => <SourceUpdateNotice session={value} zh changes={[]} conversations={[]} overview onUpdate={vi.fn()}/>;
  const view = render(notice(session));
  expect(screen.queryByRole("status")).toBeNull();
  const pending = { ...session, wikiKnowledge: { ...session.wikiKnowledge, decisionArbitrations:
    { pick: { choice: "custom", mode: "custom" as const, at: 3, unitIds: ["pick"], chapterId: section.id, locallyApplied: false } } } };
  view.rerender(notice(pending));
  expect(screen.getByRole("status")).toHaveTextContent("已保存的决定待写入正文");
});
