import { expect, it } from "vitest";
import type { FocusSection } from "./focus-session";
import type { WikiClaim } from "./wiki-claims";
import { wikiChapterEdition } from "./wiki-reading-edition";
import { wikiEditorialCleanup, withoutSettledOpeningQuestions, withoutWikiAuditWarnings } from "./wiki-editorial-cleanup";
import { wikiStateGraphs, wikiStateGraphMarkdown } from "./wiki-state-graph";

const claim=(text:string,holder:WikiClaim["holder"]="decided"):WikiClaim=>({
  text,holder,quote:text,evidenceIds:["ref"],unitIds:["u"],userDecided:holder==="decided",verification:"supported",
});
const chapter=(body:string,claims:WikiClaim[]):FocusSection=>({
  id:"chapter",title:"Workflow",kind:"finding",transition:"",evidenceIds:["ref"],body,claims,
});

it("keeps exact approved technical details in handoff and discussions in the archive",()=>{
  const accepted=claim("Use intensity-select and flowType when consent is recorded.");
  const proposal=claim("The assistant proposes replacing flowType with actionType.","ai");
  const page=chapter("### Execution\n\n"+accepted.text+"\n\n"+proposal.text,[accepted,proposal]);
  expect(wikiChapterEdition(page,"handoff").body).toContain(accepted.text);
  expect(wikiChapterEdition(page,"handoff").body).not.toContain("actionType");
  expect(wikiChapterEdition(page,"archive")).toBe(page);
});

it("removes an empty heading and old warnings while preserving source code",()=>{
  const body=["### Spec","","Use 750rpx.","","### Empty","","### History","","以上数据为讨论中引用的外部信息，未独立核验。","","> 版本未定：旧卡片"].join("\n");
  expect(wikiEditorialCleanup(chapter(body,[]),new Map(),new Map(),true).body).not.toContain("### Empty");
  expect(withoutWikiAuditWarnings(body,false,true)).not.toContain("未独立核验");
  expect(withoutWikiAuditWarnings(body,false,true)).not.toContain("版本未定");
  expect(withoutWikiAuditWarnings(body,true,true)).toContain("未独立核验");
});

it("reconciles an opening only when all of its named decisions were answered", () => {
  const question = "目前关于是否直接提供比价购买链接以及初始形式是否为网站仍存在未决事项。";
  const answers = ["第一版是否包含元件比价推荐及购买链接？", "产品初始交付形式是否确定为 Web 网站？"];
  expect(withoutSettledOpeningQuestions("第一版面向学生。" + question, answers)).toBe("第一版面向学生。");
  expect(withoutSettledOpeningQuestions(question, answers.slice(0, 1))).toBe(question);
  expect(withoutSettledOpeningQuestions(question.replace("目前", "V2 "), answers)).toContain("V2 ");
  const pending = "发布计划聚焦于核心流程、V1 画布功能确认及 Alpha 验证准备。";
  const scope = ["V1 版本是否包含交互式 Hardware Canvas 画布？"];
  expect(withoutSettledOpeningQuestions(pending, scope)).toBe("发布计划聚焦于核心流程、Alpha 验证准备。");
  expect(withoutSettledOpeningQuestions(pending.replace("V1", "V2"), scope)).toContain("V2 画布功能确认");
});

it("deduplicates the same confirmed decision inside a paragraph and keeps its next claim", () => {
  const receipt = claim("产品初始形式：是，采用网站形式。");
  const prose = claim("产品初始形式确认为网站。");
  const condition = { ...claim("Demo 可以离线查看。", "ai"), unitIds: ["other"] };
  const page = chapter(receipt.text + "\n\n" + prose.text + condition.text, [receipt, prose, condition]);
  const cleaned = wikiEditorialCleanup(page, new Map([["u", "confirmed"]]), new Map(), true);
  expect(cleaned.body).toBe(receipt.text + "\n\n" + condition.text);
  expect(cleaned.claims?.map(item => item.text)).toEqual([receipt.text, condition.text]);
});

it("makes a state graph only for directly sourced guarded edges",()=>{
  const line="review → accepted (if all checks pass)";
  const good=claim(line), invented={...claim("review → denied (if one check fails)"),quote:line};
  const graphs=wikiStateGraphs(line+"\n\n"+invented.text,[good,invented]);
  expect(graphs).toHaveLength(1);
  expect(graphs[0]).toHaveLength(1);
  const markdown=wikiStateGraphMarkdown(graphs[0],false,()=> " [Source 1]");
  expect(markdown).toContain("flowchart TD");
  expect(markdown).toContain("if all checks pass");
  expect(markdown).toContain("[Source 1]");
  expect(markdown).not.toContain("denied");
  expect(wikiStateGraphs("review → accepted",[claim("review → accepted")])).toEqual([]);
  const upgrade={...claim("同一页面不会同时展示全部流程，且中度流程可升级为重度流程。","ai"),
    quote:"- 三种强度进入三个独立流程；\n- 中度流程可以升级为重度流程；"};
  expect(wikiStateGraphs(upgrade.text,[upgrade])[0]).toMatchObject([{from:"中度流程",to:"重度流程"}]);
});
